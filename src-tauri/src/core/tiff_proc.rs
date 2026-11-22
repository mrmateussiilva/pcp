use crate::core::global_log::{fingerprint, GlobalLog};
use crate::core::imaging::{
    blit_rgb_fast, cm_to_px, draw_text_rgb, image_to_base64_png_thumb, load_image_with_meta,
    load_system_font_bytes, measure_text_px, px_to_cm, rotate270_rgb_fast, save_image_with_meta,
    wait_until_stable, DPI_FALLBACK,
};
use chrono::Local;
use image::{DynamicImage, Rgb, RgbImage};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const TEXT_LEFT_CM: f64 = 0.3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiffConfig {
    pub pasta: String,
    pub pasta_saida: String,
    pub target_width_cm: f64,
    pub tolerancia_cm: f64,
    pub pad_cm: f64,
    pub borda_px: u32,
    pub add_name: bool,
}

impl Default for TiffConfig {
    fn default() -> Self {
        Self {
            pasta: String::new(),
            pasta_saida: String::new(),
            target_width_cm: 155.0,
            tolerancia_cm: 1.5,
            pad_cm: 1.0,
            borda_px: 1,
            add_name: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TiffCounters {
    pub ok: usize,
    pub skip: usize,
    pub err: usize,
    pub tot: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TiffDebugItem {
    pub name: String,
    pub client: String,
    pub mode: String,
    pub dpi: f64,
    pub icc: bool,
    pub rotated: bool,
    pub name_added: bool,
    pub width_px: u32,
    pub height_px: u32,
    pub width_cm: f64,
    pub height_cm: f64,
    pub output: String,
    pub thumb_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TiffStatus {
    pub monitorando: bool,
    pub pasta: String,
    pub config: TiffConfig,
}

#[derive(Debug, Clone, Serialize)]
pub struct TiffLoteSummary {
    pub processados: usize,
    pub duplicados: usize,
    pub erros: usize,
    pub total: usize,
}

pub struct TiffService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    config: Arc<Mutex<TiffConfig>>,
    counters: Arc<Mutex<TiffCounters>>,
    global_log: Arc<GlobalLog>,
}

impl TiffService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            config: Arc::new(Mutex::new(TiffConfig::default())),
            counters: Arc::new(Mutex::new(TiffCounters {
                ok: 0,
                skip: 0,
                err: 0,
                tot: 0,
            })),
            global_log: Arc::new(GlobalLog::new()),
        }
    }

    pub fn current_config(&self) -> TiffConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn set_config(&self, cfg: TiffConfig) {
        *self.config.lock().unwrap() = cfg;
    }

    pub fn set_add_name(&self, val: bool) {
        self.config.lock().unwrap().add_name = val;
    }

    pub fn status(&self) -> TiffStatus {
        let rodando = self
            .stop_flag
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| !f.load(Ordering::Relaxed))
            .unwrap_or(false);
        let cfg = self.config.lock().unwrap().clone();
        TiffStatus {
            monitorando: rodando,
            pasta: cfg.pasta.clone(),
            config: cfg,
        }
    }

    pub fn counters(&self) -> TiffCounters {
        self.counters.lock().unwrap().clone()
    }

    pub fn start(&self, app: AppHandle, config: TiffConfig) -> Result<TiffStatus, String> {
        let folder = PathBuf::from(config.pasta.trim());
        if !folder.is_dir() {
            return Err("Selecione uma pasta válida para monitorar.".to_string());
        }
        self.stop(&app);

        *self.config.lock().unwrap() = config;

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Some(stop.clone());

        let config_ref = self.config.clone();
        let counters_ref = self.counters.clone();
        let glog = self.global_log.clone();
        let app_clone = app.clone();
        let folder_clone = folder.clone();

        thread::spawn(move || {
            run_monitor(app_clone, folder_clone, stop, config_ref, counters_ref, glog);
        });

        let st = self.status();
        let _ = app.emit("tiff-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> TiffStatus {
        if let Some(flag) = self.stop_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        let cfg = self.config.lock().unwrap().clone();
        let st = TiffStatus {
            monitorando: false,
            pasta: cfg.pasta.clone(),
            config: cfg,
        };
        let _ = app.emit("tiff-status", st.clone());
        st
    }

    pub fn process_batch(
        &self,
        app: &AppHandle,
        cfg: &TiffConfig,
    ) -> Result<TiffLoteSummary, String> {
        let folder = PathBuf::from(cfg.pasta.trim());
        if !folder.is_dir() {
            return Err("Selecione uma pasta de entrada válida para processar.".to_string());
        }

        let emit_log = |msg: &str| {
            let _ = app.emit("tiff-log", msg.to_string());
        };

        let mut tiffs = Vec::new();
        if let Ok(entries) = fs::read_dir(&folder) {
            for e in entries.flatten() {
                let p = e.path();
                if is_tiff(&p) {
                    tiffs.push(p);
                }
            }
        }
        tiffs.sort();

        let total = tiffs.len();
        if total == 0 {
            emit_log(&format!("Nenhum arquivo TIFF encontrado em {}", folder.display()));
            return Ok(TiffLoteSummary {
                processados: 0,
                duplicados: 0,
                erros: 0,
                total: 0,
            });
        }

        emit_log(&format!(
            "▶ Iniciando lote manual: {total} arquivo(s) em {}",
            folder.display()
        ));

        let font_bytes = load_system_font_bytes();
        let mut lote_ok = 0usize;
        let mut lote_skip = 0usize;
        let mut lote_err = 0usize;

        for p in tiffs {
            let fname = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();

            if self.global_log.ja_processado(&p) {
                let fp_orig = fingerprint(&p).ok();
                let parent_up = if !cfg.pasta_saida.trim().is_empty() {
                    PathBuf::from(cfg.pasta_saida.trim())
                } else {
                    p.parent()
                        .and_then(|d| d.parent())
                        .map(|d| d.to_path_buf())
                        .unwrap_or_else(|| folder.clone())
                };
                let mut dest = parent_up.join(&fname);
                if dest.exists() {
                    let ts = Local::now().format("%Y%m%d_%H%M%S");
                    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
                    let ext = p.extension().unwrap_or_default().to_string_lossy();
                    dest = parent_up.join(format!("{stem}_duplicado_{ts}.{ext}"));
                }
                if let Err(e) = fs::rename(&p, &dest).or_else(|_| {
                    fs::copy(&p, &dest)?;
                    fs::remove_file(&p)
                }) {
                    emit_log(&format!("✘ Erro ao mover duplicado {fname}: {e}"));
                    lote_err += 1;
                } else {
                    emit_log(&format!("📦 Duplicado movido para: {}", dest.display()));
                    self.global_log.registrar(
                        "DUPLICADO",
                        &fname,
                        fp_orig,
                        None,
                        &folder.to_string_lossy(),
                        &dest.parent().unwrap_or(&parent_up).to_string_lossy(),
                        false,
                        &client_name_from_filename(&fname),
                        0.0,
                        0.0,
                        "Movido sem sobrescrever",
                    );
                    lote_skip += 1;
                }
                continue;
            }

            let fp_orig = fingerprint(&p).ok();
            match process_single_tiff(&p, cfg, font_bytes, &emit_log) {
                Ok(debug) => {
                    let out_path = PathBuf::from(&debug.output);
                    let fp_out = fingerprint(&out_path).ok();
                    let _ = fs::remove_file(&p);
                    self.global_log.registrar(
                        "PROCESSADO",
                        &fname,
                        fp_orig,
                        fp_out,
                        &folder.to_string_lossy(),
                        &out_path.parent().unwrap_or(&folder).to_string_lossy(),
                        debug.rotated,
                        &debug.client,
                        debug.width_cm,
                        debug.height_cm,
                        "",
                    );
                    let _ = app.emit("tiff-debug", debug);
                    lote_ok += 1;
                }
                Err(e) => {
                    emit_log(&format!("✘ Erro em {fname}: {e}"));
                    self.global_log.registrar(
                        "ERRO",
                        &fname,
                        fp_orig,
                        None,
                        &folder.to_string_lossy(),
                        "",
                        false,
                        &client_name_from_filename(&fname),
                        0.0,
                        0.0,
                        &e,
                    );
                    lote_err += 1;
                }
            }
        }

        let snap = {
            let mut c = self.counters.lock().unwrap();
            c.ok += lote_ok;
            c.skip += lote_skip;
            c.err += lote_err;
            c.tot += 1;
            c.clone()
        };
        let _ = app.emit("tiff-counters", snap);

        let _ = app
            .notification()
            .builder()
            .title("TIFF Processor — Lote Concluído")
            .body(format!(
                "Processados: {lote_ok} | Duplicados: {lote_skip} | Erros: {lote_err}"
            ))
            .show();

        Ok(TiffLoteSummary {
            processados: lote_ok,
            duplicados: lote_skip,
            erros: lote_err,
            total,
        })
    }
}

fn is_tiff(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "tif" | "tiff"))
            .unwrap_or(false)
}

fn client_name_from_filename(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    stem.split(" - ")
        .next()
        .unwrap_or("")
        .trim()
        .to_uppercase()
}

fn run_monitor(
    app: AppHandle,
    folder: PathBuf,
    stop: Arc<AtomicBool>,
    config: Arc<Mutex<TiffConfig>>,
    counters: Arc<Mutex<TiffCounters>>,
    glog: Arc<GlobalLog>,
) {
    let emit_log = |msg: &str| {
        let _ = app.emit("tiff-log", msg.to_string());
    };

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let _watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .and_then(|mut w| {
        w.watch(&folder, RecursiveMode::NonRecursive)?;
        Ok(w)
    })
    .ok();

    let mut seen_in_progress: HashSet<PathBuf> = HashSet::new();
    let font_bytes = load_system_font_bytes();

    emit_log(&format!("Watcher iniciado para: {}", folder.display()));

    while !stop.load(Ordering::Relaxed) {
        // Drena eventos do watcher
        while rx.try_recv().is_ok() {}

        let cfg = config.lock().unwrap().clone();

        let mut tiffs = Vec::new();
        if let Ok(entries) = fs::read_dir(&folder) {
            for e in entries.flatten() {
                let p = e.path();
                if is_tiff(&p) {
                    tiffs.push(p);
                }
            }
        }
        tiffs.sort();

        let mut lote_ok = 0usize;
        let mut lote_skip = 0usize;
        let mut lote_err = 0usize;

        for p in tiffs {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            if seen_in_progress.contains(&p) {
                continue;
            }
            seen_in_progress.insert(p.clone());

            let fname = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();

            if !wait_until_stable(&p, 1.5, 300.0) {
                seen_in_progress.remove(&p);
                continue;
            }

            if glog.ja_processado(&p) {
                let fp_orig = fingerprint(&p).ok();
                let parent_up = if !cfg.pasta_saida.trim().is_empty() {
                    PathBuf::from(cfg.pasta_saida.trim())
                } else {
                    p.parent()
                        .and_then(|d| d.parent())
                        .map(|d| d.to_path_buf())
                        .unwrap_or_else(|| folder.clone())
                };
                let mut dest = parent_up.join(&fname);
                if dest.exists() {
                    let ts = Local::now().format("%Y%m%d_%H%M%S");
                    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
                    let ext = p.extension().unwrap_or_default().to_string_lossy();
                    dest = parent_up.join(format!("{stem}_duplicado_{ts}.{ext}"));
                }
                if let Err(e) = fs::rename(&p, &dest).or_else(|_| {
                    fs::copy(&p, &dest)?;
                    fs::remove_file(&p)
                }) {
                    emit_log(&format!("✘ Erro ao mover duplicado {fname}: {e}"));
                    lote_err += 1;
                } else {
                    emit_log(&format!("📦 Duplicado movido para: {}", dest.display()));
                    glog.registrar(
                        "DUPLICADO",
                        &fname,
                        fp_orig,
                        None,
                        &folder.to_string_lossy(),
                        &dest.parent().unwrap_or(&parent_up).to_string_lossy(),
                        false,
                        &client_name_from_filename(&fname),
                        0.0,
                        0.0,
                        "Movido sem sobrescrever",
                    );
                    lote_skip += 1;
                }
                seen_in_progress.remove(&p);
                continue;
            }

            let fp_orig = fingerprint(&p).ok();
            match process_single_tiff(&p, &cfg, font_bytes, &emit_log) {
                Ok(debug) => {
                    let out_path = PathBuf::from(&debug.output);
                    let fp_out = fingerprint(&out_path).ok();
                    let _ = fs::remove_file(&p);
                    glog.registrar(
                        "PROCESSADO",
                        &fname,
                        fp_orig,
                        fp_out,
                        &folder.to_string_lossy(),
                        &out_path.parent().unwrap_or(&folder).to_string_lossy(),
                        debug.rotated,
                        &debug.client,
                        debug.width_cm,
                        debug.height_cm,
                        "",
                    );
                    let _ = app.emit("tiff-debug", debug);
                    lote_ok += 1;
                }
                Err(e) => {
                    emit_log(&format!("✘ Erro em {fname}: {e}"));
                    glog.registrar(
                        "ERRO",
                        &fname,
                        fp_orig,
                        None,
                        &folder.to_string_lossy(),
                        "",
                        false,
                        &client_name_from_filename(&fname),
                        0.0,
                        0.0,
                        &e,
                    );
                    lote_err += 1;
                }
            }
            seen_in_progress.remove(&p);
        }

        if lote_ok + lote_skip + lote_err > 0 {
            let snap = {
                let mut c = counters.lock().unwrap();
                c.ok += lote_ok;
                c.skip += lote_skip;
                c.err += lote_err;
                c.tot += 1;
                c.clone()
            };
            let _ = app.emit("tiff-counters", snap);

            let _ = app
                .notification()
                .builder()
                .title("TIFF Processor — Lote concluído")
                .body(format!(
                    "Processados: {lote_ok} | Duplicados: {lote_skip} | Erros: {lote_err}"
                ))
                .show();
        }

        // Aguarda notificação do SO ou timeout de 2 segundos (reação quase imediata)
        let _ = rx.recv_timeout(Duration::from_secs(2));
    }

    emit_log("Watcher encerrado.");
}

pub fn process_single_tiff(
    path: &Path,
    cfg: &TiffConfig,
    font_bytes: Option<&[u8]>,
    emit_log: &dyn Fn(&str),
) -> Result<TiffDebugItem, String> {
    let fname = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let client_name = client_name_from_filename(&fname);

    let meta = load_image_with_meta(path, DPI_FALLBACK)?;
    let dpi = meta.dpi_x;
    let img = meta.image;

    emit_log(&format!("[{fname}]"));
    emit_log(&format!(
        "  modo={} | DPI={:.1} | ICC={}",
        meta.color_mode,
        dpi,
        if meta.icc_profile.is_some() { "sim" } else { "não" }
    ));

    let w_cm = px_to_cm(img.width(), dpi);
    let h_cm = px_to_cm(img.height(), dpi);

    let target = cfg.target_width_cm;
    let tol = cfg.tolerancia_cm.max(0.1);

    let w_diff = (w_cm - target).abs();
    let h_diff = (h_cm - target).abs();

    let w_is_target = w_diff <= tol;
    let h_is_target = h_diff <= tol;
    let mut rotated = false;

    let rgb = match img {
        DynamicImage::ImageRgb8(r) => r,
        other => other.to_rgb8(),
    };

    let processed_rgb = if w_is_target {
        emit_log(&format!(
            "  largura já é ~{target:.1} cm ({w_cm:.2} cm, diff: {w_diff:.2} cm) — sem rotação"
        ));
        rgb
    } else if h_is_target {
        let rot = rotate270_rgb_fast(&rgb);
        rotated = true;
        let new_w_cm = px_to_cm(rot.width(), dpi);
        let new_h_cm = px_to_cm(rot.height(), dpi);
        emit_log(&format!(
            "  ↻ rotacionado 90° (altura era {h_cm:.2} cm) → nova dimensão: {new_w_cm:.2} × {new_h_cm:.2} cm"
        ));
        rot
    } else {
        emit_log(&format!(
            "  ⚠ nenhum lado está na faixa de {target:.1} ± {tol:.1} cm (L: {w_cm:.2} cm, A: {h_cm:.2} cm) — sem rotação"
        ));
        rgb
    };

    let (w, h) = processed_rgb.dimensions();

    let border_px = cfg.borda_px;
    let pad_px = cm_to_px(cfg.pad_cm.max(0.0), dpi);
    let bw = w + 2 * border_px;
    let total_h = h + 2 * border_px + pad_px;

    let mut padded = RgbImage::from_pixel(bw, total_h, Rgb([255, 255, 255]));

    blit_rgb_fast(&mut padded, &processed_rgb, border_px, border_px);

    if border_px > 0 {
        let black = Rgb([0, 0, 0]);
        let art_bottom = h + border_px;
        for x in 0..bw {
            for b in 0..border_px {
                padded.put_pixel(x, b, black);
                padded.put_pixel(x, art_bottom + b, black);
            }
        }
        for y in 0..=art_bottom + border_px.saturating_sub(1) {
            for b in 0..border_px {
                padded.put_pixel(b, y, black);
                padded.put_pixel(bw - 1 - b, y, black);
            }
        }
    }

    let art_bottom = h + border_px;
    if cfg.add_name && !client_name.is_empty() && pad_px > 0 {
        let font_size_px = cm_to_px(1.0, dpi) as f32;
        let text_h = font_bytes
            .map(|b| measure_text_px(b, &client_name, font_size_px).1)
            .unwrap_or(font_size_px as u32);
        let text_x = cm_to_px(TEXT_LEFT_CM, dpi) as i32;
        let text_y = (art_bottom + 1 + pad_px.saturating_sub(text_h) / 2) as i32;
        draw_text_rgb(
            &mut padded,
            font_bytes,
            &client_name,
            text_x,
            text_y,
            font_size_px,
            Rgb([0, 0, 0]),
        );
    }

    let out_path = if !cfg.pasta_saida.trim().is_empty() {
        let out_dir = PathBuf::from(cfg.pasta_saida.trim());
        if !out_dir.exists() {
            let _ = fs::create_dir_all(&out_dir);
        }
        out_dir.join(&fname)
    } else {
        let out_dir = path
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| "Pasta pai inválida".to_string())?;
        out_dir.join(&fname)
    };

    let final_dyn = DynamicImage::ImageRgb8(padded);
    save_image_with_meta(
        &final_dyn,
        &out_path,
        dpi,
        dpi,
        meta.icc_profile.as_deref(),
    )?;
    emit_log(&format!("  ✔ salvo em: {}", out_path.display()));

    let thumb_base64 = image_to_base64_png_thumb(&final_dyn, 160);

    Ok(TiffDebugItem {
        name: fname,
        client: client_name,
        mode: meta.color_mode,
        dpi,
        icc: meta.icc_profile.is_some(),
        rotated,
        name_added: cfg.add_name,
        width_px: final_dyn.width(),
        height_px: final_dyn.height(),
        width_cm: px_to_cm(final_dyn.width(), dpi),
        height_cm: px_to_cm(final_dyn.height(), dpi),
        output: out_path.to_string_lossy().into_owned(),
        thumb_base64,
    })
}
