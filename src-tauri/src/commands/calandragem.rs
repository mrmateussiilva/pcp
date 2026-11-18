use crate::core::calandragem_srv::{CalandragemService, CalandragemStatus};
use crate::core::config::ConfigManager;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct CalandragemConfigPayload {
    pub porta: u16,
    pub auto_iniciar: bool,
}

#[tauri::command]
pub fn calandragem_get_config(cfg: State<'_, ConfigManager>) -> CalandragemConfigPayload {
    let c = cfg.get();
    let sec = c.secoes.get("calandragem");

    let porta = sec
        .and_then(|s| s.get("porta"))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(8767) as u16;

    let auto_iniciar = sec
        .and_then(|s| s.get("auto_iniciar"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    CalandragemConfigPayload {
        porta,
        auto_iniciar,
    }
}

#[tauri::command]
pub fn calandragem_save_config(
    cfg: State<'_, ConfigManager>,
    payload: CalandragemConfigPayload,
) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert(
            "calandragem".to_string(),
            json!({
                "porta": payload.porta,
                "auto_iniciar": payload.auto_iniciar
            }),
        );
    })?;
    Ok(())
}

#[tauri::command]
pub fn calandragem_status(srv: State<'_, CalandragemService>) -> CalandragemStatus {
    srv.status()
}

#[tauri::command]
pub async fn calandragem_iniciar(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, CalandragemService>,
    porta: u16,
    auto_iniciar: bool,
) -> Result<CalandragemStatus, String> {
    let ws_port = cfg
        .get()
        .secoes
        .get("notepad")
        .and_then(|s| s.get("ws_port"))
        .and_then(|v| v.as_u64())
        .unwrap_or(8765) as u16;

    let _ = calandragem_save_config(
        cfg,
        CalandragemConfigPayload {
            porta,
            auto_iniciar,
        },
    );
    srv.start(app, porta, ws_port).await
}

#[tauri::command]
pub fn calandragem_parar(
    app: AppHandle,
    srv: State<'_, CalandragemService>,
) -> CalandragemStatus {
    srv.stop(&app)
}
