use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::Path;
use std::time::Instant;
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

#[derive(Debug, Clone, Serialize)]
pub struct ConsumoResultado {
    pub arquivos_lidos: usize,
    pub arquivos_erro: usize,
    pub consumo_total_cm: f64,
    pub tempo_s: f64,
    pub por_categoria: HashMap<String, f64>,
    pub por_tecido: HashMap<String, f64>,
    pub itens: Vec<ConsumoItem>,
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

    let unit = decoder
        .get_tag_u32(Tag::ResolutionUnit)
        .unwrap_or(2);
    let mut dpi_x = ler_resolucao(&mut decoder, Tag::XResolution).unwrap_or(72.0);
    let mut dpi_y = ler_resolucao(&mut decoder, Tag::YResolution).unwrap_or(72.0);
    if unit == 3 {
        // pixels/cm -> pixels/inch
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

    Ok(ConsumoResultado {
        arquivos_lidos,
        arquivos_erro,
        consumo_total_cm,
        tempo_s: inicio.elapsed().as_secs_f64(),
        por_categoria,
        por_tecido,
        itens,
    })
}
