use crate::core::global_log::{fingerprint, GlobalLog};
use crate::core::imaging::{
    blit_rgb_fast, cm_to_px, draw_text_rgb, image_to_base64_png_thumb, load_image_with_meta,
    load_system_font_bytes, measure_text_px, px_to_cm, rotate270_rgb_fast, save_image_with_meta,
    wait_until_stable, DPI_FALLBACK,
};
use chrono::Local;
use image::{DynamicImage, Rgb, RgbImage};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const TARGET_WIDTH_CM: f64 = 155.0;
const PAD_CM: f64 = 1.0;
const BORDER_PX: u32 = 1;
const TEXT_LEFT_CM: f64 = 0.3;

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
    pub add_name: bool,
}

pub struct TiffService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    add_name: Arc<AtomicBool>,
    pasta: Mutex<String>,
    counters: Arc<Mutex<TiffCounters>>,
    global_log: Arc<GlobalLog>,
}

impl TiffService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            add_name: Arc::new(AtomicBool::new(true)),
            pasta: Mutex::new(String::new()),
            counters: Arc::new(Mutex::new(TiffCounters {
                ok: 0,
                skip: 0,
                err: 0,
                tot: 0,
            })),
            global_log: Arc::new(GlobalLog::new()),
        }
    }

    pub fn set_add_name(&self, val: bool) {
        self.add_name.store(val, Ordering::Relaxed);
    }

    pub fn status(&self) -> TiffStatus {
        let rodando = self
            .stop_flag
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| !f.load(Ordering::Relaxed))
            .unwrap_or(false);
        TiffStatus {
            monitorando: rodando,
            pasta: self.pasta.lock().unwrap().clone(),
            add_name: self.add_name.load(Ordering::Relaxed),
        }
    }

    pub fn counters(&self) -> TiffCounters {
        self.counters.lock().unwrap().clone()
    }

    pub fn start(&self, app: AppHandle, folder: PathBuf, add_name: bool) -> Result<TiffStatus, String> {
        if !folder.is_dir() {
            return Err("Selecione uma pasta válida para monitorar.".to_string());
        }
        self.stop(&app);

        self.add_name.store(add_name, Ordering::Relaxed);
        *self.pasta.lock().unwrap() = folder.to_string_lossy().into_owned();

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Some(stop.clone());

        let add_name_ref = self.add_name.clone();
        let counters_ref = self.counters.clone();
        let glog = self.global_log.clone();
        let app_clone = app.clone();
        let folder_clone = folder.clone();

        thread::spawn(move || {
            run_monitor(app_clone, folder_clone, stop, add_name_ref, counters_ref, glog);
        });

        let st = self.status();
        let _ = app.emit("tiff-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> TiffStatus {
        if let Some(flag) = self.stop_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        let st = TiffStatus {
            monitorando: false,
            pasta: self.pasta.lock().unwrap().clone(),
            add_name: self.add_name.load(Ordering::Relaxed),
        };
        let _ = app.emit("tiff-status", st.clone());
        st
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
    add_name: Arc<AtomicBool>,
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

    emit_log(&format!("Monitorando: {}", folder.display()));

    while !stop.load(Ordering::Relaxed) {
        // Drena eventos do watcher
        while rx.try_recv().is_ok() {}

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
                let parent_up = p.parent().and_then(|d| d.parent()).unwrap_or(&folder);
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
                        &dest.parent().unwrap_or(parent_up).to_string_lossy(),
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
            let usar_nome = add_name.load(Ordering::Relaxed);
            match process_single_tiff(&p, usar_nome, font_bytes, &emit_log) {
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

    emit_log("Monitoramento encerrado.");
}

fn process_single_tiff(
    path: &Path,
    add_name: bool,
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

    let target_px = cm_to_px(TARGET_WIDTH_CM, dpi) as i64;
    let w_is_155 = (img.width() as i64 - target_px).abs() <= 2;
    let h_is_155 = (img.height() as i64 - target_px).abs() <= 2;
    let mut rotated = false;

    let rgb = match img {
        DynamicImage::ImageRgb8(r) => r,
        other => other.to_rgb8(),
    };

    let processed_rgb = if w_is_155 {
        emit_log(&format!("  largura já é ~{TARGET_WIDTH_CM} cm — sem rotação"));
        rgb
    } else if h_is_155 {
        let rot = rotate270_rgb_fast(&rgb);
        rotated = true;
        emit_log(&format!(
            "  ↻ rotacionado 90° → {}x{}px ({:.2}x{:.2} cm)",
            rot.width(),
            rot.height(),
            px_to_cm(rot.width(), dpi),
            px_to_cm(rot.height(), dpi)
        ));
        rot
    } else {
        emit_log(&format!(
            "  ⚠ nenhum lado é ~{TARGET_WIDTH_CM} cm — sem rotação"
        ));
        rgb
    };

    let (w, h) = processed_rgb.dimensions();

    // Contorno 1px preto ao redor e padding inferior 1cm em UMA ÚNICA ALOCAÇÃO
    let bw = w + 2 * BORDER_PX;
    let pad_px = cm_to_px(PAD_CM, dpi);
    let total_h = h + 2 * BORDER_PX + pad_px;

    // Fundo branco completo
    let mut padded = RgbImage::from_pixel(bw, total_h, Rgb([255, 255, 255]));

    // Blit direto da imagem centralizada no offset (BORDER_PX, BORDER_PX)
    blit_rgb_fast(&mut padded, &processed_rgb, BORDER_PX, BORDER_PX);

    // Borda preta de 1px ao redor da área da arte + borda
    let black = Rgb([0, 0, 0]);
    let art_bottom = h + BORDER_PX;
    for x in 0..bw {
        padded.put_pixel(x, 0, black);
        padded.put_pixel(x, art_bottom, black);
    }
    for y in 0..=art_bottom {
        padded.put_pixel(0, y, black);
        padded.put_pixel(bw - 1, y, black);
    }

    if add_name && !client_name.is_empty() {
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

    let out_dir = path
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "Pasta pai inválida".to_string())?;
    let out_path = out_dir.join(&fname);

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
        name_added: add_name,
        width_px: final_dyn.width(),
        height_px: final_dyn.height(),
        width_cm: px_to_cm(final_dyn.width(), dpi),
        height_cm: px_to_cm(final_dyn.height(), dpi),
        output: out_path.to_string_lossy().into_owned(),
        thumb_base64,
    })
}
