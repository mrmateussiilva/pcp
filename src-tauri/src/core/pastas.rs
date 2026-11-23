use crate::core::config::{nome_do_dia, AppConfig};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PastaStatus {
    pub caminho: String,
    pub nome_relativo: String,
    pub categoria: String,
    pub existe: bool,
    pub qtd_arquivos: usize,
    pub tamanho_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseDriveStatus {
    pub caminho: String,
    pub existe: bool,
    pub gravavel: bool,
    pub erro: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PastasDiaResumo {
    pub base: String,
    pub base_status: BaseDriveStatus,
    pub data_formatada: String,
    pub pasta_raiz_dia: String,
    pub pasta_totens_dia: String,
    pub pastas: Vec<PastaStatus>,
    pub total_pastas: usize,
    pub total_criadas: usize,
    pub total_arquivos: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Varre arquivos diretos e de 1º nível de subpastas para contagem e tamanho
fn scan_dir_stats(p: &Path) -> (usize, u64) {
    let mut qtd = 0;
    let mut tam = 0;
    if let Ok(entries) = fs::read_dir(p) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    qtd += 1;
                    tam += meta.len();
                } else if meta.is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.flatten() {
                            if let Ok(sub_meta) = sub_entry.metadata() {
                                if sub_meta.is_file() {
                                    qtd += 1;
                                    tam += sub_meta.len();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (qtd, tam)
}

/// Testa conectividade e permissão de escrita do drive base
pub fn verificar_base(caminho_base: &str) -> BaseDriveStatus {
    let p = Path::new(caminho_base);
    if !p.exists() {
        return BaseDriveStatus {
            caminho: caminho_base.to_string(),
            existe: false,
            gravavel: false,
            erro: Some("Caminho não encontrado ou unidade desconectada".into()),
        };
    }

    if !p.is_dir() {
        return BaseDriveStatus {
            caminho: caminho_base.to_string(),
            existe: true,
            gravavel: false,
            erro: Some("O caminho especificado não é um diretório".into()),
        };
    }

    let teste = p.join(".pcp_write_check.tmp");
    match fs::write(&teste, b"pcp") {
        Ok(_) => {
            let _ = fs::remove_file(&teste);
            BaseDriveStatus {
                caminho: caminho_base.to_string(),
                existe: true,
                gravavel: true,
                erro: None,
            }
        }
        Err(e) => BaseDriveStatus {
            caminho: caminho_base.to_string(),
            existe: true,
            gravavel: false,
            erro: Some(format!("Sem permissão de escrita: {e}")),
        },
    }
}

pub fn destinos(cfg: &AppConfig, dia: Option<NaiveDate>) -> Vec<(String, String, PathBuf)> {
    let base = PathBuf::from(&cfg.base);
    let nome = nome_do_dia(dia);
    let raiz_dia = join_subpath(&base, &nome);

    let mut lista: Vec<(String, String, PathBuf)> = cfg
        .subpastas
        .iter()
        .map(|sub| {
            (
                "PRODUÇÃO".to_string(),
                sub.clone(),
                join_subpath(&raiz_dia, sub),
            )
        })
        .collect();

    let totens_base = join_subpath(&base, &cfg.totens);
    let raiz_totens = join_subpath(&totens_base, &nome);
    for sub in &cfg.subpastas_totens {
        lista.push((
            "TOTENS".to_string(),
            format!("TOTENS / {}", sub),
            join_subpath(&raiz_totens, sub),
        ));
    }

    lista
}

pub fn obter_resumo(cfg: &AppConfig, dia: Option<NaiveDate>) -> PastasDiaResumo {
    let base = PathBuf::from(&cfg.base);
    let nome = nome_do_dia(dia);
    let raiz_dia = join_subpath(&base, &nome);
    let totens_base = join_subpath(&base, &cfg.totens);
    let raiz_totens = join_subpath(&totens_base, &nome);

    let base_status = verificar_base(&cfg.base);

    let mut pastas = Vec::new();
    let mut total_arquivos = 0;
    let mut total_bytes = 0;
    let mut total_criadas = 0;

    for (cat, nome_rel, caminho_buf) in destinos(cfg, dia) {
        let existe = caminho_buf.is_dir();
        let (qtd, bytes) = if existe {
            total_criadas += 1;
            let (q, b) = scan_dir_stats(&caminho_buf);
            total_arquivos += q;
            total_bytes += b;
            (q, b)
        } else {
            (0, 0)
        };

        pastas.push(PastaStatus {
            caminho: caminho_buf.to_string_lossy().into_owned(),
            nome_relativo: nome_rel,
            categoria: cat,
            existe,
            qtd_arquivos: qtd,
            tamanho_bytes: bytes,
        });
    }

    let total_pastas = pastas.len();

    PastasDiaResumo {
        base: cfg.base.clone(),
        base_status,
        data_formatada: nome,
        pasta_raiz_dia: raiz_dia.to_string_lossy().into_owned(),
        pasta_totens_dia: raiz_totens.to_string_lossy().into_owned(),
        pastas,
        total_pastas,
        total_criadas,
        total_arquivos,
        total_bytes,
    }
}

pub fn listar_destinos(cfg: &AppConfig, dia: Option<NaiveDate>) -> Vec<PastaStatus> {
    obter_resumo(cfg, dia).pastas
}

pub fn criar_pasta_individual(caminho: &str) -> Result<(), String> {
    let p = Path::new(caminho);
    fs::create_dir_all(p).map_err(|e| format!("Falha ao criar pasta '{caminho}': {e}"))
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

    for (_, _, pasta) in destinos(cfg, dia) {
        let caminho = pasta.to_string_lossy().into_owned();
        match fs::create_dir_all(&pasta) {
            Ok(_) => ok.push(caminho),
            Err(e) => falhas.push((caminho, e.to_string())),
        }
    }

    Ok(CriarResultado { ok, falhas })
}
