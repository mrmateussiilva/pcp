use crate::core::imaging::{load_image_with_meta, resize_rgb_simd, wait_until_stable, DPI_FALLBACK};
use chrono::{DateTime, Local};
use image::{DynamicImage, GenericImageView, RgbImage};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
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
    #[serde(default = "default_escala")]
    pub escala_pct: f64,
    #[serde(default = "default_qualidade")]
    pub qualidade_jpeg: u8,
}

fn default_escala() -> f64 {
    10.0
}

fn default_qualidade() -> u8 {
    85
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
    pub processando_lote: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParDuplicado {
    pub original: String,
    pub duplicada: String,
    pub caminho_original: String,
    pub caminho_duplicada: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VarreduraResultado {
    pub total_analisados: usize,
    pub duplicadas: Vec<ParDuplicado>,
    pub tempo_s: f64,
    pub movidas: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct BolsinhaItemInfo {
    pub stem: String,
    pub nome_arquivo: String,
    pub caminho_jpeg: String,
    pub tamanho_bytes: u64,
    pub modificado_str: String,
    pub largura: u32,
    pub altura: u32,
}

pub struct BolsinhasService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    varrendo: Arc<AtomicBool>,
    processando_lote: Arc<AtomicBool>,
    counters: Arc<Mutex<BolsinhasCounters>>,
}

impl BolsinhasService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            varrendo: Arc::new(AtomicBool::new(false)),
            processando_lote: Arc::new(AtomicBool::new(false)),
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
            processando_lote: self.processando_lote.load(Ordering::Relaxed),
        }
    }

    pub fn counters(&self) -> BolsinhasCounters {
        self.counters.lock().unwrap().clone()
    }

    pub fn reset_counters(&self) {
        let mut c = self.counters.lock().unwrap();
        *c = BolsinhasCounters::default();
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
        let st = BolsinhasStatus {
            monitorando: false,
            varrendo: self.varrendo.load(Ordering::Relaxed),
            processando_lote: self.processando_lote.load(Ordering::Relaxed),
        };
        let _ = app.emit("bolsinhas-status", st.clone());
        st
    }

    pub fn processar_lote_agora(
        &self,
        app: AppHandle,
        opcoes: BolsinhasOpcoes,
    ) -> Result<(), String> {
        if self.processando_lote.swap(true, Ordering::Relaxed) {
            return Err("Já existe um processamento em lote em andamento.".to_string());
        }

        let pasta = PathBuf::from(opcoes.pasta.trim());
        if !pasta.is_dir() {
            self.processando_lote.store(false, Ordering::Relaxed);
            return Err("Selecione uma pasta PARA FAZER válida.".to_string());
        }

        let _ = app.emit("bolsinhas-status", self.status());
        let counters = self.counters.clone();
        let proc_flag = self.processando_lote.clone();
        let app_clone = app.clone();

        thread::spawn(move || {
            let reg_lock = Mutex::new(());
            processar_pasta_tiffs(&app_clone, &pasta, &opcoes, &counters, &reg_lock);
            proc_flag.store(false, Ordering::Relaxed);
            let _ = app_clone.emit(
                "bolsinhas-status",
                BolsinhasStatus {
                    monitorando: false,
                    varrendo: false,
                    processando_lote: false,
                },
            );
        });

        Ok(())
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
            let res = executar_varredura(&app, &pasta, mover);
            let _ = app.emit("bolsinhas-varredura", res);
            varrendo_ref.store(false, Ordering::Relaxed);
            let _ = app.emit(
                "bolsinhas-status",
                BolsinhasStatus {
                    monitorando: false,
                    varrendo: false,
                    processando_lote: false,
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

fn processar_pasta_tiffs(
    app: &AppHandle,
    pasta: &Path,
    opcoes: &BolsinhasOpcoes,
    counters: &Arc<Mutex<BolsinhasCounters>>,
    reg_lock: &Mutex<()>,
) -> usize {
    let emit_log = |msg: &str| {
        let _ = app.emit("bolsinhas-log", msg.to_string());
    };

    let mut tiffs = Vec::new();
    if let Ok(entries) = fs::read_dir(pasta) {
        for e in entries.flatten() {
            let p = e.path();
            if is_tiff(&p) {
                tiffs.push(p);
            }
        }
    }
    tiffs.sort();

    if tiffs.is_empty() {
        return 0;
    }

    let qtd_total = tiffs.len();
    emit_log(&format!(
        "⚡ Encontrado(s) {qtd_total} arquivo(s) TIFF em {}. Processando...",
        pasta.display()
    ));

    let refs = pastas_referencia(pasta, opcoes);
    let registro = carregar_registro(pasta);

    let escala = opcoes.escala_pct.clamp(1.0, 100.0) / 100.0;
    let qualidade = opcoes.qualidade_jpeg.clamp(30, 100);

    let resultados: Vec<&'static str> = tiffs
        .par_iter()
        .map(|tiff_path| {
            let stem = tiff_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();

            // Aguarda o arquivo estabilizar no disco (caso esteja sendo gravado via rede)
            if !wait_until_stable(tiff_path, 0.3, 6.0) {
                emit_log(&format!("⏳ {stem}: aguardando escrita concluir..."));
                return "espera";
            }

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
                    emit_log(&format!(
                        "🗑 {stem}: já registrado sem alterações, TIFF removido."
                    ));
                    return "ja_feitas";
                }
            }

            // Abre TIFF em passada única
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
                (
                    LADO_MINIATURA,
                    ((h as f64 * LADO_MINIATURA as f64) / w.max(1) as f64)
                        .round()
                        .max(1.0) as u32,
                )
            } else {
                (
                    ((w as f64 * LADO_MINIATURA as f64) / h.max(1) as f64)
                        .round()
                        .max(1.0) as u32,
                    LADO_MINIATURA,
                )
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
                            emit_log(&format!(
                                "⛔ {stem}: arte repetida — movido para {PASTA_REPETIDAS}."
                            ));
                        }
                        if opcoes.som {
                            let _ = app
                                .notification()
                                .builder()
                                .title("Bolsinha repetida!")
                                .body(format!("{stem} já foi feita com a mesma arte."))
                                .show();
                        }
                        return "repetidas";
                    }
                }
            }

            // Caso C: gerar bolsinha JPEG com qualidade e escala configuradas
            let nw = ((w as f64) * escala).round().max(1.0) as u32;
            let nh = ((h as f64) * escala).round().max(1.0) as u32;
            let bolsinha_img = resize_rgb_simd(&rgb_src, nw, nh);
            let out_jpeg = pasta.join(format!("{stem}.jpeg"));

            let file = match File::create(&out_jpeg) {
                Ok(f) => f,
                Err(e) => {
                    emit_log(&format!("✘ Erro ao criar {stem}.jpeg: {e}"));
                    return "erros";
                }
            };
            let mut writer = BufWriter::with_capacity(256 * 1024, file);
            let mut encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, qualidade);
            if let Err(e) =
                encoder.encode(&bolsinha_img, nw, nh, image::ExtendedColorType::Rgb8)
            {
                emit_log(&format!("✘ Erro ao codificar JPEG {stem}: {e}"));
                return "erros";
            }

            let _ = fs::create_dir_all(&min_dir);
            if let Ok(min_file) = File::create(&min_path) {
                let mut min_writer = BufWriter::with_capacity(64 * 1024, min_file);
                let mut min_enc =
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut min_writer, 80);
                let _ = min_enc.encode(&nova_min.to_rgb8(), mw, mh, image::ExtendedColorType::Rgb8);
            }

            let _ = fs::remove_file(tiff_path);

            {
                let _g = reg_lock.lock().unwrap();
                registrar_bolsinha(pasta, &stem, tiff_mtime);
            }

            if ja_no_registro {
                emit_log(&format!("↻ {stem}: arte atualizada ({nw}×{nh}px @ {qualidade}%)."));
                "atualizadas"
            } else {
                emit_log(&format!("✔ {stem}: bolsinha gerada ({nw}×{nh}px @ {qualidade}%)."));
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
                "espera" => {}
                _ => c.erros += 1,
            }
        }
        let _ = app.emit("bolsinhas-counters", c.clone());
    }

    qtd_total
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

    emit_log(&format!("Watcher reativo iniciado em: {}", pasta.display()));
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let _watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default(),
    )
    .and_then(|mut w| {
        w.watch(&pasta, RecursiveMode::NonRecursive)?;
        Ok(w)
    })
    .ok();

    let reg_lock = Mutex::new(());

    // Varre arquivos presentes inicialmente
    processar_pasta_tiffs(&app, &pasta, &opcoes, &counters, &reg_lock);

    while !stop.load(Ordering::Relaxed) {
        // Aguarda eventos de arquivo de forma reativa; acorda no máximo a cada 1s
        match rx.recv_timeout(Duration::from_millis(1000)) {
            Ok(Ok(_event)) => {
                while rx.try_recv().is_ok() {}
                if !stop.load(Ordering::Relaxed) {
                    processar_pasta_tiffs(&app, &pasta, &opcoes, &counters, &reg_lock);
                }
            }
            Ok(Err(_)) | Err(_) => {
                // Timeout ou erro de notify: segue
            }
        }
    }

    emit_log("Watcher de bolsinhas parado.");
}

pub fn executar_varredura(app: &AppHandle, pasta: &Path, mover: bool) -> VarreduraResultado {
    let emit_log = |msg: &str| {
        let _ = app.emit("bolsinhas-log", msg.to_string());
    };

    let inicio = Instant::now();
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
            image::open(p).ok().map(|img| {
                (
                    p.clone(),
                    resize_rgb_simd(&img.to_rgb8(), LADO_MINIATURA, LADO_MINIATURA),
                )
            })
        })
        .collect();

    let mut ja_marcadas: HashSet<usize> = HashSet::new();
    let mut duplicadas: Vec<ParDuplicado> = Vec::new();

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
                let orig = &thumbs[i].0;
                let dup = &thumbs[j].0;
                duplicadas.push(ParDuplicado {
                    original: orig
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    duplicada: dup
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    caminho_original: orig.to_string_lossy().into_owned(),
                    caminho_duplicada: dup.to_string_lossy().into_owned(),
                });
            }
        }
    }

    let dup_dir = pasta.join(PASTA_DUPLICADAS);
    if mover && !duplicadas.is_empty() {
        let _ = fs::create_dir_all(&dup_dir);
        for d in &duplicadas {
            let src = PathBuf::from(&d.caminho_duplicada);
            if src.is_file() {
                let dest = dup_dir.join(src.file_name().unwrap());
                let _ = fs::rename(&src, &dest);
                emit_log(&format!(
                    "  📦 {} (igual a {}) → movido para {PASTA_DUPLICADAS}",
                    d.duplicada, d.original
                ));
            }
        }
    }

    let tempo_s = inicio.elapsed().as_secs_f64();
    if duplicadas.is_empty() {
        emit_log(&format!(
            "✔ Varredura concluída em {tempo_s:.2}s: nenhuma duplicada encontrada entre {} bolsinhas.",
            thumbs.len()
        ));
    } else {
        emit_log(&format!(
            "⚠ Varredura concluída em {tempo_s:.2}s: {} par(es) de duplicada(s) encontrado(s).",
            duplicadas.len()
        ));
    }

    VarreduraResultado {
        total_analisados: thumbs.len(),
        duplicadas,
        tempo_s,
        movidas: mover,
    }
}

pub fn listar_recentes(pasta: &Path, limite: usize) -> Vec<BolsinhaItemInfo> {
    let mut arquivos = Vec::new();
    if let Ok(entries) = fs::read_dir(pasta) {
        for e in entries.flatten() {
            let p = e.path();
            if is_jpeg(&p) {
                if let Ok(meta) = fs::metadata(&p) {
                    let ts = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    arquivos.push((p, meta.len(), ts));
                }
            }
        }
    }

    // Ordena do mais recente para o mais antigo
    arquivos.sort_by(|a, b| b.2.cmp(&a.2));

    arquivos
        .into_iter()
        .take(limite)
        .map(|(p, tamanho_bytes, ts)| {
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let nome_arquivo = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let (largura, altura) = image::image_dimensions(&p).unwrap_or((0, 0));
            let dt = DateTime::from_timestamp(ts as i64, 0)
                .map(|d| d.with_timezone(&Local).format("%d/%m %H:%M").to_string())
                .unwrap_or_else(|| "—".to_string());

            BolsinhaItemInfo {
                stem,
                nome_arquivo,
                caminho_jpeg: p.to_string_lossy().into_owned(),
                tamanho_bytes,
                modificado_str: dt,
                largura,
                altura,
            }
        })
        .collect()
}

pub fn carregar_miniatura_base64(caminho_jpeg: &Path) -> Result<String, String> {
    if !caminho_jpeg.is_file() {
        return Err("Arquivo não encontrado.".to_string());
    }

    let stem = caminho_jpeg
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let pasta = caminho_jpeg.parent().unwrap_or(Path::new(""));
    let min_path = pasta.join(PASTA_MINIATURAS).join(format!("{stem}.jpg"));

    let target_path = if min_path.is_file() {
        &min_path
    } else {
        caminho_jpeg
    };

    let bytes = fs::read(target_path).map_err(|e| format!("Erro ao ler arquivo: {e}"))?;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let b64 = STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}
