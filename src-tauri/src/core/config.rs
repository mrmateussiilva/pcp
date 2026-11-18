use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_base")]
    pub base: String,
    #[serde(default = "default_totens")]
    pub totens: String,
    #[serde(default = "default_subpastas")]
    pub subpastas: Vec<String>,
    #[serde(default = "default_subpastas_totens")]
    pub subpastas_totens: Vec<String>,
    #[serde(default = "default_true")]
    pub criar_ao_abrir: bool,
    #[serde(flatten)]
    pub secoes: Map<String, Value>,
}

fn default_base() -> String {
    r"Z:\".to_string()
}

fn default_totens() -> String {
    "IMPRESSÃO DE TOTENS".to_string()
}

fn default_subpastas() -> Vec<String> {
    vec![
        "BOLSINHAS/PARA FAZER".to_string(),
        "PAINEL_CUT".to_string(),
        "CONF".to_string(),
        "APS".to_string(),
        "TEX".to_string(),
    ]
}

fn default_subpastas_totens() -> Vec<String> {
    vec!["otimizacoes".to_string()]
}

fn default_true() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            base: default_base(),
            totens: default_totens(),
            subpastas: default_subpastas(),
            subpastas_totens: default_subpastas_totens(),
            criar_ao_abrir: true,
            secoes: Map::new(),
        }
    }
}

pub struct ConfigManager {
    arquivo: PathBuf,
    cache: Mutex<AppConfig>,
}

impl ConfigManager {
    pub fn new(dados_dir: PathBuf) -> Self {
        let arquivo = dados_dir.join("config.json");
        let cfg = Self::carregar_do_disco(&arquivo);
        Self {
            arquivo,
            cache: Mutex::new(cfg),
        }
    }

    fn carregar_do_disco(arquivo: &Path) -> AppConfig {
        if let Ok(texto) = fs::read_to_string(arquivo) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&texto) {
                return cfg;
            }
        }
        AppConfig::default()
    }

    pub fn get(&self) -> AppConfig {
        self.cache.lock().expect("config mutex poisoned").clone()
    }

    pub fn update<F>(&self, f: F) -> Result<AppConfig, String>
    where
        F: FnOnce(&mut AppConfig),
    {
        let mut guard = self.cache.lock().map_err(|e| e.to_string())?;
        f(&mut guard);
        self.salvar_atomico(&guard)?;
        Ok(guard.clone())
    }

    fn salvar_atomico(&self, cfg: &AppConfig) -> Result<(), String> {
        if let Some(parent) = self.arquivo.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar pasta de config: {e}"))?;
        }
        let json = serde_json::to_string_pretty(cfg)
            .map_err(|e| format!("Erro ao serializar config: {e}"))?;

        let tmp = self.arquivo.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("Erro ao gravar config temporário: {e}"))?;
        fs::rename(&tmp, &self.arquivo)
            .map_err(|e| format!("Erro ao substituir config.json: {e}"))?;
        Ok(())
    }
}

pub fn nome_do_dia(dia: Option<NaiveDate>) -> String {
    let d = dia.unwrap_or_else(|| Local::now().date_naive());
    d.format("%d %m %Y").to_string()
}

pub fn pasta_do_dia(cfg: &AppConfig, sub: &str, dia: Option<NaiveDate>) -> PathBuf {
    let mut p = PathBuf::from(&cfg.base).join(nome_do_dia(dia));
    if !sub.is_empty() {
        for part in sub.split(['/', '\\']).filter(|s| !s.is_empty()) {
            p.push(part);
        }
    }
    p
}
