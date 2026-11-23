use crate::core::config::ConfigManager;
use crate::core::notepad_srv::{NotepadHistoricoItem, NotepadService, NotepadStatusPayload};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct NotepadConfigPayload {
    pub arquivo: String,
    pub auto_iniciar: bool,
    #[serde(default = "default_ws_port")]
    pub ws_port: u16,
    #[serde(default = "default_http_port")]
    pub http_port: u16,
}

fn default_ws_port() -> u16 {
    8765
}

fn default_http_port() -> u16 {
    8766
}

#[tauri::command]
pub fn notepad_get_config(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
) -> NotepadConfigPayload {
    let c = cfg.get();
    let sec = c.secoes.get("notepad");
    let default_path = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("dados"))
        .join("notes_state.json")
        .to_string_lossy()
        .into_owned();

    NotepadConfigPayload {
        arquivo: sec
            .and_then(|s| s.get("arquivo"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or(default_path),
        auto_iniciar: sec
            .and_then(|s| s.get("auto_iniciar"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        ws_port: sec
            .and_then(|s| s.get("ws_port"))
            .and_then(|v| v.as_u64())
            .unwrap_or(8765) as u16,
        http_port: sec
            .and_then(|s| s.get("http_port"))
            .and_then(|v| v.as_u64())
            .unwrap_or(8766) as u16,
    }
}

#[tauri::command]
pub fn notepad_save_config(
    cfg: State<'_, ConfigManager>,
    payload: NotepadConfigPayload,
) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert(
            "notepad".to_string(),
            json!({
                "arquivo": payload.arquivo.trim(),
                "auto_iniciar": payload.auto_iniciar,
                "ws_port": payload.ws_port,
                "http_port": payload.http_port
            }),
        );
    })?;
    Ok(())
}

#[tauri::command]
pub fn notepad_status(srv: State<'_, NotepadService>) -> NotepadStatusPayload {
    srv.status()
}

#[tauri::command]
pub async fn notepad_iniciar(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, NotepadService>,
    arquivo: String,
    auto_iniciar: bool,
    ws_port: Option<u16>,
    http_port: Option<u16>,
) -> Result<NotepadStatusPayload, String> {
    let ws = ws_port.unwrap_or(8765);
    let http = http_port.unwrap_or(8766);
    let _ = notepad_save_config(
        cfg,
        NotepadConfigPayload {
            arquivo: arquivo.clone(),
            auto_iniciar,
            ws_port: ws,
            http_port: http,
        },
    );
    srv.start(app, PathBuf::from(arquivo.trim()), ws, http)
        .await
}

#[tauri::command]
pub fn notepad_parar(
    app: AppHandle,
    srv: State<'_, NotepadService>,
) -> NotepadStatusPayload {
    srv.stop(&app)
}

#[tauri::command]
pub fn notepad_set_texto(srv: State<'_, NotepadService>, text: String) {
    srv.set_texto(text, "PCP Central".to_string());
}

#[tauri::command]
pub fn notepad_obter_historico(srv: State<'_, NotepadService>) -> Vec<NotepadHistoricoItem> {
    srv.obter_historico()
}

#[tauri::command]
pub fn notepad_restaurar_versao(
    srv: State<'_, NotepadService>,
    versao_id: u64,
) -> Result<(), String> {
    srv.restaurar_versao(versao_id)
}

#[tauri::command]
pub fn notepad_limpar_historico(srv: State<'_, NotepadService>) {
    srv.limpar_historico();
}
