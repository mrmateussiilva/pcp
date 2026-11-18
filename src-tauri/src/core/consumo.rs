use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tiff::decoder::{Decoder, Limits};
use tiff::tags::Tag;

const LARGURA_MIDIA_CM: f64 = 160.0;
const LIMITE_EMENDA_CM: f64 = 155.0;
const LARGURA_UTIL_CM: f64 = 150.0;

const TECIDOS_CONHECIDOS: &[&str] = &[
    "HELANCA",
    "OXFORD",
    "MICROFIBRA",
    "SARJA",
    "TACTEL",
    "LONA",
    "CETIM",
];

#[derive(Debug, Clone, Serialize)]
pub struct ConsumoItem {
    pub nome: String,
    pub consumo_cm: f64,
    pub categoria: String,
    pub tecido: String,
    pub obs: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ConsumoResultado {
    pub arquivos_lidos: usize,
    pub arquivos_erro: usize,
    pub consumo_total_cm: f64,
    pub tempo_s: f64,
    pub por_categoria: HashMap<String, f64>,
    pub por_tecido: HashMap<String, f64>,
    pub itens: Vec<ConsumoItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsumoStatus {
    pub monitorando: bool,
    pub pasta: String,
}

pub struct ConsumoService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    pasta: Mutex<String>,
    ultimo: Arc<Mutex<Option<ConsumoResultado>>>,
}

impl ConsumoService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            pasta: Mutex::new(String::new()),
            ultimo: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status(&self) -> ConsumoStatus {
        let monitorando = self
            .stop_flag
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| !f.load(Ordering::Relaxed))
            .unwrap_or(false);
        ConsumoStatus {
            monitorando,
            pasta: self.pasta.lock().unwrap().clone(),
        }
    }

    pub fn ultimo_resultado(&self) -> Option<ConsumoResultado> {
        self.ultimo.lock().unwrap().clone()
    }

    pub fn start(&self, app: AppHandle, pasta: PathBuf) -> Result<ConsumoStatus, String> {
        if !pasta.is_dir() {
            return Err("Selecione uma pasta válida para observar.".to_string());
        }
        self.stop(&app);

        *self.pasta.lock().unwrap() = pasta.to_string_lossy().into_owned();
        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Some(stop.clone());
        let ultimo = self.ultimo.clone();
        let app_clone = app.clone();

        thread::spawn(move || {
            watch_loop(app_clone, pasta, stop, ultimo);
        });

        let st = self.status();
        let _ = app.emit("consumo-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> ConsumoStatus {
        if let Some(flag) = self.stop_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        let st = ConsumoStatus {
            monitorando: false,
            pasta: self.pasta.lock().unwrap().clone(),
        };
        let _ = app.emit("consumo-status", st.clone());
        st
    }
}

fn descobrir_tecido(nome: &str) -> String {
    let upper = nome.to_uppercase();
    for t in TECIDOS_CONHECIDOS {
        if upper.contains(t) {
            return (*t).to_string();
        }
    }
    "NÃO IDENTIFICADO".to_string()
}

fn ler_resolucao(decoder: &mut Decoder<BufReader<File>>, tag: Tag) -> Option<f64> {
    if let Ok(val) = decoder.get_tag(tag) {
        match val {
            tiff::decoder::ifd::Value::Rational(n, d) if d > 0 => Some(n as f64 / d as f64),
            tiff::decoder::ifd::Value::SRational(n, d) if d > 0 => Some(n as f64 / d as f64),
            tiff::decoder::ifd::Value::Unsigned(v) if v > 0 => Some(v as f64),
            tiff::decoder::ifd::Value::Short(v) if v > 0 => Some(v as f64),
            _ => None,
        }
    } else {
        None
    }
}

fn extrair_dados_arquivo(path: &Path) -> ConsumoItem {
    let nome = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return ConsumoItem {
                nome,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!("Erro na leitura: {e}"),
            }
        }
    };

    let mut decoder = match Decoder::new(BufReader::new(file)) {
        Ok(d) => d.with_limits(Limits::unlimited()),
        Err(e) => {
            return ConsumoItem {
                nome,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!("Erro na leitura: {e}"),
            }
        }
    };

    let (largura_px, altura_px) = match decoder.dimensions() {
        Ok(dims) => dims,
        Err(e) => {
            return ConsumoItem {
                nome,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!("Erro na leitura: {e}"),
            }
        }
    };

    let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
    let mut dpi_x = ler_resolucao(&mut decoder, Tag::XResolution).unwrap_or(72.0);
    let mut dpi_y = ler_resolucao(&mut decoder, Tag::YResolution).unwrap_or(72.0);
    if unit == 3 {
        dpi_x *= 2.54;
        dpi_y *= 2.54;
    }
    if dpi_x <= 0.0 {
        dpi_x = 72.0;
    }
    if dpi_y <= 0.0 {
        dpi_y = 72.0;
    }

    let dim_1_cm = (largura_px as f64 / dpi_x) * 2.54;
    let dim_2_cm = (altura_px as f64 / dpi_y) * 2.54;

    let (maior, menor) = if dim_1_cm > dim_2_cm {
        (dim_1_cm, dim_2_cm)
    } else {
        (dim_2_cm, dim_1_cm)
    };

    let (consumo_cm, categoria, obs) =
        if dim_1_cm > LIMITE_EMENDA_CM && dim_2_cm > LIMITE_EMENDA_CM {
            let tiras = (maior / LARGURA_UTIL_CM).ceil();
            (
                tiras * menor,
                "Fatiado".to_string(),
                format!("Fatiado em {} tiras", tiras as u32),
            )
        } else if maior <= LARGURA_MIDIA_CM {
            (
                menor,
                "Encaixe Normal".to_string(),
                "Encaixe normal".to_string(),
            )
        } else if dim_1_cm <= LARGURA_MIDIA_CM {
            (
                dim_2_cm,
                "Girado".to_string(),
                "Girado (gasta altura)".to_string(),
            )
        } else if dim_2_cm <= LARGURA_MIDIA_CM {
            (
                dim_1_cm,
                "Girado".to_string(),
                "Girado (gasta largura)".to_string(),
            )
        } else {
            return ConsumoItem {
                nome,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!("ERRO: Maior que {LARGURA_MIDIA_CM}cm"),
            };
        };

    ConsumoItem {
        tecido: descobrir_tecido(&nome),
        nome,
        consumo_cm,
        categoria,
        obs,
    }
}

fn montar_resultado(itens: Vec<ConsumoItem>, tempo_s: f64) -> ConsumoResultado {
    let mut arquivos_lidos = 0usize;
    let mut arquivos_erro = 0usize;
    let mut consumo_total_cm = 0.0f64;
    let mut por_categoria: HashMap<String, f64> = HashMap::from([
        ("Encaixe Normal".to_string(), 0.0),
        ("Girado".to_string(), 0.0),
        ("Fatiado".to_string(), 0.0),
    ]);
    let mut por_tecido: HashMap<String, f64> = HashMap::new();

    for item in &itens {
        if item.categoria == "Erro" {
            arquivos_erro += 1;
        } else {
            arquivos_lidos += 1;
            consumo_total_cm += item.consumo_cm;
            *por_categoria.entry(item.categoria.clone()).or_insert(0.0) += item.consumo_cm;
            *por_tecido.entry(item.tecido.clone()).or_insert(0.0) += item.consumo_cm;
        }
    }

    ConsumoResultado {
        arquivos_lidos,
        arquivos_erro,
        consumo_total_cm,
        tempo_s,
        por_categoria,
        por_tecido,
        itens,
    }
}

pub fn analisar_pasta(diretorio: &Path) -> Result<ConsumoResultado, String> {
    let inicio = Instant::now();
    let entries = fs::read_dir(diretorio).map_err(|e| format!("Erro ao abrir pasta: {e}"))?;

    let mut arquivos = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                let low = ext.to_lowercase();
                if low == "tif" || low == "tiff" {
                    arquivos.push(p);
                }
            }
        }
    }
    arquivos.sort();

    let itens: Vec<ConsumoItem> = arquivos
        .par_iter()
        .map(|p| extrair_dados_arquivo(p))
        .collect();

    Ok(montar_resultado(itens, inicio.elapsed().as_secs_f64()))
}

fn file_sig(p: &Path) -> (u64, u64) {
    fs::metadata(p)
        .map(|m| {
            let ms = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            (m.len(), ms)
        })
        .unwrap_or((0, 0))
}

fn watch_loop(
    app: AppHandle,
    pasta: PathBuf,
    stop: Arc<AtomicBool>,
    ultimo: Arc<Mutex<Option<ConsumoResultado>>>,
) {
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

    let mut cache: HashMap<String, (u64, u64, ConsumoItem)> = HashMap::new();
    let mut ultima_lista_sig: Vec<(String, u64, u64)> = Vec::new();

    while !stop.load(Ordering::Relaxed) {
        while rx.try_recv().is_ok() {}

        let inicio = Instant::now();
        let mut arquivos: Vec<(String, u64, u64, PathBuf)> = Vec::new();
        if let Ok(entries) = fs::read_dir(&pasta) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                        let low = ext.to_lowercase();
                        if low == "tif" || low == "tiff" {
                            let nome = p
                                .file_name()
                                .map(|s| s.to_string_lossy().into_owned())
                                .unwrap_or_default();
                            let (sz, mt) = file_sig(&p);
                            arquivos.push((nome, sz, mt, p));
                        }
                    }
                }
            }
        }
        arquivos.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

        let nova_sig: Vec<(String, u64, u64)> = arquivos
            .iter()
            .map(|(n, s, m, _)| (n.clone(), *s, *m))
            .collect();

        if nova_sig != ultima_lista_sig || ultimo.lock().unwrap().is_none() {
            let para_ler: Vec<(String, u64, u64, PathBuf)> = arquivos
                .iter()
                .filter(|(n, s, m, _)| {
                    cache
                        .get(n)
                        .map(|(cs, cm, _)| cs != s || cm != m)
                        .unwrap_or(true)
                })
                .cloned()
                .collect();

            if !para_ler.is_empty() {
                let novos: Vec<(String, u64, u64, ConsumoItem)> = para_ler
                    .par_iter()
                    .map(|(n, s, m, p)| (n.clone(), *s, *m, extrair_dados_arquivo(p)))
                    .collect();
                for (n, s, m, item) in novos {
                    cache.insert(n, (s, m, item));
                }
            }

            let itens: Vec<ConsumoItem> = arquivos
                .iter()
                .filter_map(|(n, _, _, _)| cache.get(n).map(|(_, _, it)| it.clone()))
                .collect();

            let res = montar_resultado(itens, inicio.elapsed().as_secs_f64());
            *ultimo.lock().unwrap() = Some(res.clone());
            let _ = app.emit("consumo-atualizado", res);
            ultima_lista_sig = nova_sig;
        }

        thread::sleep(Duration::from_secs(2));
    }
}
