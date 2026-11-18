use crate::core::config::ConfigManager;
use crate::core::consumo::{self, ConsumoResultado, ConsumoService, ConsumoStatus};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn consumo_analisar(pasta: String) -> Result<ConsumoResultado, String> {
    let dir = PathBuf::from(pasta.trim());
    if !dir.is_dir() {
        return Err("Selecione uma pasta válida.".to_string());
    }
    tokio::task::spawn_blocking(move || consumo::analisar_pasta(&dir))
        .await
        .map_err(|e| format!("Erro interno: {e}"))?
}

#[tauri::command]
pub fn consumo_get_pasta(cfg: State<'_, ConfigManager>) -> String {
    cfg.get()
        .secoes
        .get("consumo")
        .and_then(|s| s.get("pasta"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
pub fn consumo_status(srv: State<'_, ConsumoService>) -> ConsumoStatus {
    srv.status()
}

#[tauri::command]
pub fn consumo_resultado_atual(srv: State<'_, ConsumoService>) -> Option<ConsumoResultado> {
    srv.ultimo_resultado()
}

#[tauri::command]
pub fn consumo_iniciar_monitor(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ConsumoService>,
    pasta: String,
) -> Result<ConsumoStatus, String> {
    let p = PathBuf::from(pasta.trim());
    if !p.is_dir() {
        return Err("Selecione uma pasta válida.".to_string());
    }
    let _ = cfg.update(|c| {
        c.secoes.insert("consumo".to_string(), json!({ "pasta": pasta.trim() }));
    });
    srv.start(app, p)
}

#[tauri::command]
pub fn consumo_parar_monitor(
    app: AppHandle,
    srv: State<'_, ConsumoService>,
) -> ConsumoStatus {
    srv.stop(&app)
}
