use crate::core::imaging::{px_to_cm, read_image_dimensions_and_dpi};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const TECIDOS_CONHECIDOS: &[&str] = &[
    "HELANCA LIGHT",
    "HELANQUINHA",
    "HELANCA",
    "OXFORD",
    "MICROFIBRA",
    "SARJA",
    "TACTEL",
    "LONA",
    "CETIM",
    "DRYFIT",
    "DRY FIT",
    "CANELADO",
    "NEOPRENE",
    "SUPLEX",
    "TRICOLINE",
    "CREPE",
    "MUSSELINE",
    "TULE",
    "MOLETON",
    "MOLETINHO",
    "VISCOSE",
    "SEDA",
    "LINHO",
    "BLACKOUT",
    "FELTRO",
    "CHIFFON",
    "VELUDO",
    "ORGANZA",
    "VOAL",
    "ADESIVO",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumoConfig {
    #[serde(default = "default_largura_midia")]
    pub largura_midia_cm: f64,
    #[serde(default = "default_limite_emenda")]
    pub limite_emenda_cm: f64,
    #[serde(default = "default_largura_util")]
    pub largura_util_cm: f64,
    #[serde(default = "default_margem_avaria")]
    pub margem_avaria_pct: f64,
    #[serde(default)]
    pub tecidos_extras: Vec<String>,
}

fn default_largura_midia() -> f64 {
    160.0
}
fn default_limite_emenda() -> f64 {
    155.0
}
fn default_largura_util() -> f64 {
    150.0
}
fn default_margem_avaria() -> f64 {
    0.0
}

impl Default for ConsumoConfig {
    fn default() -> Self {
        Self {
            largura_midia_cm: default_largura_midia(),
            limite_emenda_cm: default_limite_emenda(),
            largura_util_cm: default_largura_util(),
            margem_avaria_pct: default_margem_avaria(),
            tecidos_extras: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumoItem {
    pub nome: String,
    pub largura_cm: f64,
    pub altura_cm: f64,
    pub dpi: f64,
    pub quantidade: usize,
    pub consumo_unitario_cm: f64,
    pub consumo_cm: f64,
    pub categoria: String,
    pub tecido: String,
    pub obs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConsumoResultado {
    pub arquivos_lidos: usize,
    pub arquivos_erro: usize,
    pub consumo_total_cm: f64,
    pub consumo_com_avaria_cm: f64,
    pub tempo_s: f64,
    pub por_categoria: HashMap<String, f64>,
    pub por_tecido: HashMap<String, f64>,
    pub itens: Vec<ConsumoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumoStatus {
    pub monitorando: bool,
    pub pasta: String,
}

pub struct ConsumoService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    pasta: Mutex<String>,
    config: Arc<Mutex<ConsumoConfig>>,
    ultimo: Arc<Mutex<Option<ConsumoResultado>>>,
}

impl ConsumoService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            pasta: Mutex::new(String::new()),
            config: Arc::new(Mutex::new(ConsumoConfig::default())),
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

    pub fn pasta(&self) -> String {
        self.pasta.lock().unwrap().clone()
    }

    pub fn get_config(&self) -> ConsumoConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn set_config(&self, cfg: ConsumoConfig) {
        *self.config.lock().unwrap() = cfg;
    }

    pub fn ultimo_resultado(&self) -> Option<ConsumoResultado> {
        self.ultimo.lock().unwrap().clone()
    }

    pub fn recarregar_se_necessario(&self, app: &AppHandle) -> Result<(), String> {
        let p_str = self.pasta();
        if p_str.is_empty() {
            return Ok(());
        }
        let p = PathBuf::from(&p_str);
        if !p.is_dir() {
            return Ok(());
        }
        let cfg = self.get_config();
        let ultimo = self.ultimo.clone();
        let app_handle = app.clone();
        thread::spawn(move || {
            if let Ok(res) = analisar_pasta(&p, &cfg) {
                *ultimo.lock().unwrap() = Some(res.clone());
                let _ = app_handle.emit("consumo-atualizado", res);
            }
        });
        Ok(())
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
        let config_ref = self.config.clone();
        let app_clone = app.clone();

        thread::spawn(move || {
            watch_loop(app_clone, pasta, stop, config_ref, ultimo);
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

pub fn descobrir_tecido(nome: &str, extras: &[String]) -> String {
    let upper = nome.to_uppercase();

    // 1. Prioriza tecidos extras definidos pelo usuário
    for extra in extras {
        let ext_upper = extra.trim().to_uppercase();
        if !ext_upper.is_empty() && upper.contains(&ext_upper) {
            return ext_upper;
        }
    }

    // 2. Verifica tecidos padrão conhecidos
    for &t in TECIDOS_CONHECIDOS {
        if upper.contains(t) {
            return match t {
                "HELANCA LIGHT" | "HELANQUINHA" => "HELANCA".to_string(),
                "DRY FIT" => "DRYFIT".to_string(),
                "MOLETON" => "MOLETINHO".to_string(),
                other => other.to_string(),
            };
        }
    }

    "NÃO IDENTIFICADO".to_string()
}

pub fn extrair_quantidade(nome: &str) -> usize {
    static RE_QTD: OnceLock<Regex> = OnceLock::new();
    let re = RE_QTD.get_or_init(|| {
        // Ignora padrões de dimensão (ex: 200x150) através do negative lookahead (?!\s*\d)
        Regex::new(r"(?i)(?:^|[\s_(\[-])(?:(\d{1,3})\s*[xX](?!\s*\d)|[xX]\s*(\d{1,3})|(?:qtd|quant|copias|unidades)[\s.:_-]*(\d{1,3})|(\d{1,3})\s*(?:un|pcs|pçs))(?:[\s_)\]-]|$)").unwrap()
    });

    if let Some(caps) = re.captures(nome) {
        for i in 1..=4 {
            if let Some(m) = caps.get(i) {
                if let Ok(val) = m.as_str().parse::<usize>() {
                    if val > 0 && val <= 1000 {
                        return val;
                    }
                }
            }
        }
    }
    1
}

pub fn extrair_dados_arquivo(path: &Path, config: &ConsumoConfig) -> ConsumoItem {
    let nome = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let (largura_px, altura_px, dpi_x, dpi_y) = match read_image_dimensions_and_dpi(path, 72.0) {
        Ok(dims) => dims,
        Err(e) => {
            return ConsumoItem {
                nome,
                largura_cm: 0.0,
                altura_cm: 0.0,
                dpi: 72.0,
                quantidade: 1,
                consumo_unitario_cm: 0.0,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!("Erro na leitura: {e}"),
            };
        }
    };

    let dpi = if dpi_x > 0.0 { dpi_x } else { 72.0 };
    let dim_1_cm = px_to_cm(largura_px, dpi_x);
    let dim_2_cm = px_to_cm(altura_px, dpi_y);

    let (maior, menor) = if dim_1_cm > dim_2_cm {
        (dim_1_cm, dim_2_cm)
    } else {
        (dim_2_cm, dim_1_cm)
    };

    let (consumo_unit_cm, categoria, obs) =
        if dim_1_cm > config.limite_emenda_cm && dim_2_cm > config.limite_emenda_cm {
            let tiras = (maior / config.largura_util_cm).ceil().max(1.0);
            (
                tiras * menor,
                "Fatiado".to_string(),
                format!("Fatiado em {} tiras", tiras as u32),
            )
        } else if maior <= config.largura_midia_cm {
            (
                menor,
                "Encaixe Normal".to_string(),
                "Encaixe normal (aproveita largura)".to_string(),
            )
        } else if dim_1_cm <= config.largura_midia_cm {
            (
                dim_2_cm,
                "Girado".to_string(),
                "Girado (gasta altura)".to_string(),
            )
        } else if dim_2_cm <= config.largura_midia_cm {
            (
                dim_1_cm,
                "Girado".to_string(),
                "Girado (gasta largura)".to_string(),
            )
        } else {
            return ConsumoItem {
                nome,
                largura_cm: dim_1_cm,
                altura_cm: dim_2_cm,
                dpi,
                quantidade: 1,
                consumo_unitario_cm: 0.0,
                consumo_cm: 0.0,
                categoria: "Erro".to_string(),
                tecido: "Erro".to_string(),
                obs: format!(
                    "ERRO: Maior que {:.0}cm em ambas direções",
                    config.largura_midia_cm
                ),
            };
        };

    let quantidade = extrair_quantidade(&nome);
    let consumo_total_cm = consumo_unit_cm * (quantidade as f64);
    let tecido = descobrir_tecido(&nome, &config.tecidos_extras);

    ConsumoItem {
        nome,
        largura_cm: dim_1_cm,
        altura_cm: dim_2_cm,
        dpi,
        quantidade,
        consumo_unitario_cm: consumo_unit_cm,
        consumo_cm: consumo_total_cm,
        categoria,
        tecido,
        obs,
    }
}

fn montar_resultado(
    itens: Vec<ConsumoItem>,
    config: &ConsumoConfig,
    tempo_s: f64,
) -> ConsumoResultado {
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

    let margem = config.margem_avaria_pct.max(0.0) / 100.0;
    let consumo_com_avaria_cm = consumo_total_cm * (1.0 + margem);

    ConsumoResultado {
        arquivos_lidos,
        arquivos_erro,
        consumo_total_cm,
        consumo_com_avaria_cm,
        tempo_s,
        por_categoria,
        por_tecido,
        itens,
    }
}

pub fn analisar_pasta(diretorio: &Path, config: &ConsumoConfig) -> Result<ConsumoResultado, String> {
    let inicio = Instant::now();
    let entries = fs::read_dir(diretorio).map_err(|e| format!("Erro ao abrir pasta: {e}"))?;

    let mut arquivos = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                let low = ext.to_lowercase();
                if low == "tif" || low == "tiff" || low == "jpg" || low == "jpeg" || low == "png" {
                    arquivos.push(p);
                }
            }
        }
    }
    arquivos.sort();

    let itens: Vec<ConsumoItem> = arquivos
        .par_iter()
        .map(|p| extrair_dados_arquivo(p, config))
        .collect();

    Ok(montar_resultado(
        itens,
        config,
        inicio.elapsed().as_secs_f64(),
    ))
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
    config: Arc<Mutex<ConsumoConfig>>,
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

        let cur_cfg = config.lock().unwrap().clone();
        let inicio = Instant::now();
        let mut arquivos: Vec<(String, u64, u64, PathBuf)> = Vec::new();
        if let Ok(entries) = fs::read_dir(&pasta) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                        let low = ext.to_lowercase();
                        if low == "tif"
                            || low == "tiff"
                            || low == "jpg"
                            || low == "jpeg"
                            || low == "png"
                        {
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
                let cfg_clone = cur_cfg.clone();
                let novos: Vec<(String, u64, u64, ConsumoItem)> = para_ler
                    .par_iter()
                    .map(|(n, s, m, p)| (n.clone(), *s, *m, extrair_dados_arquivo(p, &cfg_clone)))
                    .collect();
                for (n, s, m, item) in novos {
                    cache.insert(n, (s, m, item));
                }
            }

            let itens: Vec<ConsumoItem> = arquivos
                .iter()
                .filter_map(|(n, _, _, _)| cache.get(n).map(|(_, _, it)| it.clone()))
                .collect();

            let res = montar_resultado(itens, &cur_cfg, inicio.elapsed().as_secs_f64());
            *ultimo.lock().unwrap() = Some(res.clone());
            let _ = app.emit("consumo-atualizado", res);
            ultima_lista_sig = nova_sig;
        }

        let _ = rx.recv_timeout(Duration::from_secs(2));
    }
}
