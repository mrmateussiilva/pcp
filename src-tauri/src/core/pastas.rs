use crate::core::config::{nome_do_dia, AppConfig};
use chrono::NaiveDate;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct PastaStatus {
    pub caminho: String,
    pub existe: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CriarResultado {
    pub ok: Vec<String>,
    pub falhas: Vec<(String, String)>,
}

fn join_subpath(base: &Path, sub: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for part in sub.split(['/', '\\']).filter(|s| !s.is_empty()) {
        p.push(part);
    }
    p
}

pub fn destinos(cfg: &AppConfig, dia: Option<NaiveDate>) -> Vec<PathBuf> {
    let base = PathBuf::from(&cfg.base);
    let nome = nome_do_dia(dia);

    let mut lista: Vec<PathBuf> = cfg
        .subpastas
        .iter()
        .map(|sub| join_subpath(&base.join(&nome), sub))
        .collect();

    let totens = base.join(&cfg.totens).join(&nome);
    for sub in &cfg.subpastas_totens {
        lista.push(join_subpath(&totens, sub));
    }

    lista
}

pub fn listar_destinos(cfg: &AppConfig, dia: Option<NaiveDate>) -> Vec<PastaStatus> {
    destinos(cfg, dia)
        .into_iter()
        .map(|p| {
            let existe = p.is_dir();
            PastaStatus {
                caminho: p.to_string_lossy().into_owned(),
                existe,
            }
        })
        .collect()
}

pub fn criar(cfg: &AppConfig, dia: Option<NaiveDate>) -> Result<CriarResultado, String> {
    let base = Path::new(&cfg.base);
    if !base.exists() {
        return Err(format!(
            "Drive {} não encontrado. Verifique a conexão de rede.",
            cfg.base
        ));
    }

    let mut ok = Vec::new();
    let mut falhas = Vec::new();

    for pasta in destinos(cfg, dia) {
        let caminho = pasta.to_string_lossy().into_owned();
        match fs::create_dir_all(&pasta) {
            Ok(_) => ok.push(caminho),
            Err(e) => falhas.push((caminho, e.to_string())),
        }
    }

    Ok(CriarResultado { ok, falhas })
}
