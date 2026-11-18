use crate::core::config::{AppConfig, ConfigManager};
use crate::core::pastas::{self, CriarResultado, PastaStatus};
use chrono::NaiveDate;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct PastasConfigPayload {
    pub base: String,
    pub totens: String,
    pub subpastas: Vec<String>,
    pub subpastas_totens: Vec<String>,
    pub criar_ao_abrir: bool,
}

fn parse_data(data_iso: Option<String>) -> Result<Option<NaiveDate>, String> {
    match data_iso {
        Some(s) if !s.trim().is_empty() => NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|e| format!("Data inválida '{s}': {e}")),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, ConfigManager>) -> AppConfig {
    state.get()
}

#[tauri::command]
pub fn save_pastas_config(
    state: State<'_, ConfigManager>,
    payload: PastasConfigPayload,
) -> Result<AppConfig, String> {
    state.update(|cfg| {
        cfg.base = payload.base.trim().to_string();
        cfg.totens = payload.totens.trim().to_string();
        cfg.subpastas = payload
            .subpastas
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        cfg.subpastas_totens = payload
            .subpastas_totens
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        cfg.criar_ao_abrir = payload.criar_ao_abrir;
    })
}

#[tauri::command]
pub fn listar_pastas_dia(
    state: State<'_, ConfigManager>,
    data_iso: Option<String>,
) -> Result<Vec<PastaStatus>, String> {
    let dia = parse_data(data_iso)?;
    let cfg = state.get();
    Ok(pastas::listar_destinos(&cfg, dia))
}

#[tauri::command]
pub async fn criar_pastas_dia(
    state: State<'_, ConfigManager>,
    data_iso: Option<String>,
) -> Result<CriarResultado, String> {
    let dia = parse_data(data_iso)?;
    let cfg = state.get();
    tokio::task::spawn_blocking(move || pastas::criar(&cfg, dia))
        .await
        .map_err(|e| format!("Erro interno: {e}"))?
}
