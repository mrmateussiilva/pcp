use crate::core::imaging::{load_image_with_meta, resize_rgb_simd, DPI_FALLBACK};
use image::{DynamicImage, GenericImageView, ImageFormat, RgbImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const NOME_REGISTRO: &str = "registro_bolsinhas.txt";
const PASTA_REPETIDAS: &str = "REPETIDAS";
const PASTA_MINIATURAS: &str = "_miniaturas";
const PASTA_DUPLICADAS: &str = "DUPLICADAS";
const LADO_MINIATURA: u32 = 512;
const TOLERANCIA_REPETIDA: u8 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BolsinhasOpcoes {
    pub pasta: String,
    pub extras: Vec<String>,
    pub apagar_repetido: bool,
    pub som: bool,
    pub usar_pai: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct BolsinhasCounters {
    pub novas: usize,
    pub atualizadas: usize,
    pub repetidas: usize,
    pub ja_feitas: usize,
    pub erros: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BolsinhasStatus {
    pub monitorando: bool,
    pub varrendo: bool,
}

pub struct BolsinhasService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    varrendo: Arc<AtomicBool>,
    counters: Arc<Mutex<BolsinhasCounters>>,
}

impl BolsinhasService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            varrendo: Arc::new(AtomicBool::new(false)),
            counters: Arc::new(Mutex::new(BolsinhasCounters::default())),
        }
    }

    pub fn status(&self) -> BolsinhasStatus {
        let monitorando = self
            .stop_flag
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| !f.load(Ordering::Relaxed))
            .unwrap_or(false);
        BolsinhasStatus {
            monitorando,
            varrendo: self.varrendo.load(Ordering::Relaxed),
        }
    }

    pub fn counters(&self) -> BolsinhasCounters {
        self.counters.lock().unwrap().clone()
    }

    pub fn start(&self, app: AppHandle, opcoes: BolsinhasOpcoes) -> Result<BolsinhasStatus, String> {
        let pasta = PathBuf::from(opcoes.pasta.trim());
        if !pasta.is_dir() {
            return Err("Selecione uma pasta PARA FAZER válida.".to_string());
        }
        self.stop(&app);

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Some(stop.clone());

        let counters = self.counters.clone();
        let app_clone = app.clone();

        thread::spawn(move || {
            monitor_loop(app_clone, pasta, opcoes, stop, counters);
        });

        let st = self.status();
        let _ = app.emit("bolsinhas-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> BolsinhasStatus {
        if let Some(flag) = self.stop_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        let st = self.status();
        let _ = app.emit("bolsinhas-status", st.clone());
        st
    }

    pub fn varredura(&self, app: AppHandle, pasta: PathBuf, mover: bool) -> Result<(), String> {
        if !pasta.is_dir() {
            return Err("Selecione uma pasta válida para varredura.".to_string());
        }
        if self.varrendo.swap(true, Ordering::Relaxed) {
            return Err("Já existe uma varredura em andamento.".to_string());
        }
        let _ = app.emit("bolsinhas-status", self.status());
        let varrendo_ref = self.varrendo.clone();

        thread::spawn(move || {
            executar_varredura(&app, &pasta, mover);
            varrendo_ref.store(false, Ordering::Relaxed);
            let _ = app.emit(
                "bolsinhas-status",
                BolsinhasStatus {
                    monitorando: false,
                    varrendo: false,
                },
            );
        });

        Ok(())
    }
}

fn mtime_secs(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn is_tiff(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "tif" | "tiff"))
            .unwrap_or(false)
}

fn is_jpeg(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "jpg" | "jpeg"))
            .unwrap_or(false)
}

fn carregar_registro(pasta: &Path) -> HashMap<String, Option<f64>> {
    let mut map = HashMap::new();
    let reg_path = pasta.join(NOME_REGISTRO);
    if let Ok(txt) = fs::read_to_string(reg_path) {
        for line in txt.lines() {
            let l = line.trim();
            if l.is_empty() {
                continue;
            }
            if let Some((nome, ts_str)) = l.split_once('|') {
                let ts = ts_str.trim().parse::<f64>().ok();
                map.insert(nome.trim().to_string(), ts);
            } else {
                map.insert(l.to_string(), None);
            }
        }
    }
    map
}

fn registrar_bolsinha(pasta: &Path, stem: &str, mtime: f64) {
    let reg_path = pasta.join(NOME_REGISTRO);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(reg_path) {
        let _ = writeln!(f, "{stem}|{mtime:.3}");
    }
}

fn pastas_referencia(pasta: &Path, opcoes: &BolsinhasOpcoes) -> Vec<PathBuf> {
    let mut list = vec![pasta.to_path_buf()];
    if opcoes.usar_pai {
        if let Some(pai) = pasta.parent() {
            list.push(pai.to_path_buf());
        }
    }
    for extra in &opcoes.extras {
        let p = PathBuf::from(extra.trim());
        if !extra.trim().is_empty() && p.is_dir() {
            list.push(p);
        }
    }
    list
}

fn buscar_bolsinha_existente(refs: &[PathBuf], stem: &str) -> Option<PathBuf> {
    for dir in refs {
        for ext in ["jpeg", "jpg", "JPEG", "JPG"] {
            let candidate = dir.join(format!("{stem}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn comparar_miniaturas_prontas(a: &RgbImage, b: &RgbImage) -> bool {
    let mut max_diff = 0u8;
    for (pa, pb) in a.pixels().zip(b.pixels()) {
        for c in 0..3 {
            let d = pa[c].abs_diff(pb[c]);
            if d > max_diff {
                max_diff = d;
                if max_diff > TOLERANCIA_REPETIDA {
                    return false;
                }
            }
        }
    }
    true
}

fn comparar_miniaturas(img_a: &DynamicImage, img_b: &DynamicImage) -> bool {
    let a = resize_rgb_simd(&img_a.to_rgb8(), LADO_MINIATURA, LADO_MINIATURA);
    let b = resize_rgb_simd(&img_b.to_rgb8(), LADO_MINIATURA, LADO_MINIATURA);
    comparar_miniaturas_prontas(&a, &b)
}

fn monitor_loop(
    app: AppHandle,
    pasta: PathBuf,
    opcoes: BolsinhasOpcoes,
    stop: Arc<AtomicBool>,
    counters: Arc<Mutex<BolsinhasCounters>>,
) {
    let emit_log = |msg: &str| {
        let _ = app.emit("bolsinhas-log", msg.to_string());
    };

    emit_log(&format!("Monitorando bolsinhas em: {}", pasta.display()));
    let reg_lock = Mutex::new(());

    while !stop.load(Ordering::Relaxed) {
        let mut tiffs = Vec::new();
        if let Ok(entries) = fs::read_dir(&pasta) {
            for e in entries.flatten() {
                let p = e.path();
                if is_tiff(&p) {
                    tiffs.push(p);
                }
            }
        }
        tiffs.sort();

        if !tiffs.is_empty() {
            let refs = pastas_referencia(&pasta, &opcoes);
            let registro = carregar_registro(&pasta);

            let resultados: Vec<&'static str> = tiffs
                .par_iter()
                .map(|tiff_path| {
                    let stem = tiff_path
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    let tiff_mtime = mtime_secs(tiff_path);

                    // Caso A: já existe bolsinha em dia ou registro sem mudança
                    if let Some(bolsinha) = buscar_bolsinha_existente(&refs, &stem) {
                        if mtime_secs(&bolsinha) >= tiff_mtime - 2.0 {
                            let _ = fs::remove_file(tiff_path);
                            emit_log(&format!("🗑 {stem}: bolsinha já feita, TIFF removido."));
                            return "ja_feitas";
                        }
                    }

                    let ja_no_registro = registro.contains_key(&stem);
                    if let Some(Some(reg_ts)) = registro.get(&stem) {
                        if (tiff_mtime - *reg_ts).abs() <= 2.0 {
                            let _ = fs::remove_file(tiff_path);
                            emit_log(&format!("🗑 {stem}: já registrado sem alterações, TIFF removido."));
                            return "ja_feitas";
                        }
                    }

                    // Abre TIFF em passada única (para gerar miniatura ou comparar arte)
                    let img = match load_image_with_meta(tiff_path, DPI_FALLBACK) {
                        Ok(m) => m.image,
                        Err(e) => {
                            emit_log(&format!("✘ Erro ao abrir {stem}: {e}"));
                            return "erros";
                        }
                    };

                    let min_dir = pasta.join(PASTA_MINIATURAS);
                    let min_path = min_dir.join(format!("{stem}.jpg"));
                    let (w, h) = img.dimensions();
                    let (mw, mh) = if w >= h {
                        (LADO_MINIATURA, ((h as f64 * LADO_MINIATURA as f64) / w.max(1) as f64).round().max(1.0) as u32)
                    } else {
                        (((w as f64 * LADO_MINIATURA as f64) / h.max(1) as f64).round().max(1.0) as u32, LADO_MINIATURA)
                    };
                    let rgb_src = img.to_rgb8();
                    let nova_min = DynamicImage::ImageRgb8(resize_rgb_simd(&rgb_src, mw, mh));

                    // Caso B: nome repetido -> comparar arte com miniatura anterior
                    if ja_no_registro && min_path.is_file() {
                        if let Ok(antiga) = image::open(&min_path) {
                            if comparar_miniaturas(&nova_min, &antiga) {
                                if opcoes.apagar_repetido {
                                    let _ = fs::remove_file(tiff_path);
                                    emit_log(&format!("⛔ {stem}: arte repetida — TIFF apagado."));
                                } else {
                                    let rep_dir = pasta.join(PASTA_REPETIDAS);
                                    let _ = fs::create_dir_all(&rep_dir);
                                    let dest = rep_dir.join(tiff_path.file_name().unwrap());
                                    let _ = fs::rename(tiff_path, &dest);
                                    emit_log(&format!("⛔ {stem}: arte repetida — movido para {PASTA_REPETIDAS}."));
                                }
                                let _ = app
                                    .notification()
                                    .builder()
                                    .title("Bolsinha repetida!")
                                    .body(format!("{stem} já foi feita com a mesma arte."))
                                    .show();
                                return "repetidas";
                            }
                        }
                    }

                    // Caso C: gerar bolsinha 10% (SIMD)
                    let nw = ((w as f64) * 0.10).round().max(1.0) as u32;
                    let nh = ((h as f64) * 0.10).round().max(1.0) as u32;
                    let bolsinha_img = resize_rgb_simd(&rgb_src, nw, nh);
                    let out_jpeg = pasta.join(format!("{stem}.jpeg"));

                    if let Err(e) = DynamicImage::ImageRgb8(bolsinha_img)
                        .save_with_format(&out_jpeg, ImageFormat::Jpeg)
                    {
                        emit_log(&format!("✘ Erro ao salvar {stem}.jpeg: {e}"));
                        return "erros";
                    }

                    let _ = fs::create_dir_all(&min_dir);
                    let _ = nova_min.to_rgb8().save_with_format(&min_path, ImageFormat::Jpeg);
                    let _ = fs::remove_file(tiff_path);

                    {
                        let _g = reg_lock.lock().unwrap();
                        registrar_bolsinha(&pasta, &stem, tiff_mtime);
                    }

                    if ja_no_registro {
                        emit_log(&format!("↻ {stem}: arte atualizada ({nw}x{nh}px)."));
                        "atualizadas"
                    } else {
                        emit_log(&format!("✔ {stem}: bolsinha gerada ({nw}x{nh}px)."));
                        "novas"
                    }
                })
                .collect();

            {
                let mut c = counters.lock().unwrap();
                for r in resultados {
                    match r {
                        "novas" => c.novas += 1,
                        "atualizadas" => c.atualizadas += 1,
                        "repetidas" => c.repetidas += 1,
                        "ja_feitas" => c.ja_feitas += 1,
                        _ => c.erros += 1,
                    }
                }
                let _ = app.emit("bolsinhas-counters", c.clone());
            }
        }

        thread::sleep(Duration::from_secs(3));
    }

    emit_log("Monitor de bolsinhas parado.");
}

fn executar_varredura(app: &AppHandle, pasta: &Path, mover: bool) {
    let emit_log = |msg: &str| {
        let _ = app.emit("bolsinhas-log", msg.to_string());
    };

    emit_log(&format!(
        "🔍 Iniciando varredura de duplicadas em: {}",
        pasta.display()
    ));

    let mut jpegs = Vec::new();
    if let Ok(entries) = fs::read_dir(pasta) {
        for e in entries.flatten() {
            let p = e.path();
            if is_jpeg(&p) {
                jpegs.push(p);
            }
        }
    }
    jpegs.sort();

    let thumbs: Vec<(PathBuf, RgbImage)> = jpegs
        .par_iter()
        .filter_map(|p| {
            image::open(p)
                .ok()
                .map(|img| (p.clone(), resize_rgb_simd(&img.to_rgb8(), LADO_MINIATURA, LADO_MINIATURA)))
        })
        .collect();

    let mut ja_marcadas: HashSet<usize> = HashSet::new();
    let mut duplicadas: Vec<(PathBuf, PathBuf)> = Vec::new();

    for i in 0..thumbs.len() {
        if ja_marcadas.contains(&i) {
            continue;
        }
        for j in (i + 1)..thumbs.len() {
            if ja_marcadas.contains(&j) {
                continue;
            }
            if comparar_miniaturas_prontas(&thumbs[i].1, &thumbs[j].1) {
                ja_marcadas.insert(j);
                duplicadas.push((thumbs[i].0.clone(), thumbs[j].0.clone()));
            }
        }
    }

    if duplicadas.is_empty() {
        emit_log("✔ Nenhuma bolsinha duplicada encontrada.");
        return;
    }

    emit_log(&format!(
        "⚠ Encontradas {} bolsinha(s) duplicada(s):",
        duplicadas.len()
    ));
    let dup_dir = pasta.join(PASTA_DUPLICADAS);
    if mover {
        let _ = fs::create_dir_all(&dup_dir);
    }

    for (orig, dup) in duplicadas {
        let n_orig = orig.file_name().unwrap_or_default().to_string_lossy();
        let n_dup = dup.file_name().unwrap_or_default().to_string_lossy();
        if mover {
            let dest = dup_dir.join(dup.file_name().unwrap());
            let _ = fs::rename(&dup, &dest);
            emit_log(&format!("  📦 {n_dup} (igual a {n_orig}) → movido p/ {PASTA_DUPLICADAS}"));
        } else {
            emit_log(&format!("  • {n_dup} (igual a {n_orig})"));
        }
    }
}
