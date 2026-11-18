use crate::core::config::ConfigManager;
use crate::core::zap_srv::{ZapMensagem, ZapService, ZapStatus};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct WhatsappConfigPayload {
    pub porta: u16,
    pub token: String,
    pub auto_iniciar: bool,
}

#[tauri::command]
pub fn whatsapp_get_config(cfg: State<'_, ConfigManager>) -> WhatsappConfigPayload {
    let c = cfg.get();
    let sec = c.secoes.get("whatsapp");

    let porta = sec
        .and_then(|s| s.get("porta"))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(5050) as u16;

    let token = sec
        .and_then(|s| s.get("token"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("EVO_TOKEN").ok())
        .unwrap_or_default();

    let auto_iniciar = sec
        .and_then(|s| s.get("auto_iniciar"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    WhatsappConfigPayload {
        porta,
        token,
        auto_iniciar,
    }
}

#[tauri::command]
pub fn whatsapp_save_config(
    cfg: State<'_, ConfigManager>,
    payload: WhatsappConfigPayload,
) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert(
            "whatsapp".to_string(),
            json!({
                "porta": payload.porta,
                "token": payload.token.trim(),
                "auto_iniciar": payload.auto_iniciar
            }),
        );
    })?;
    Ok(())
}

#[tauri::command]
pub fn whatsapp_status(srv: State<'_, ZapService>) -> ZapStatus {
    srv.status()
}

#[tauri::command]
pub fn whatsapp_historico(srv: State<'_, ZapService>) -> Vec<ZapMensagem> {
    srv.historico()
}

#[tauri::command]
pub fn whatsapp_limpar(srv: State<'_, ZapService>) {
    srv.limpar_historico();
}

#[tauri::command]
pub async fn whatsapp_iniciar(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ZapService>,
    porta: u16,
    token: String,
    auto_iniciar: bool,
) -> Result<ZapStatus, String> {
    let _ = whatsapp_save_config(
        cfg,
        WhatsappConfigPayload {
            porta,
            token: token.clone(),
            auto_iniciar,
        },
    );
    srv.start(app, porta, Some(token)).await
}

#[tauri::command]
pub fn whatsapp_parar(app: AppHandle, srv: State<'_, ZapService>) -> ZapStatus {
    srv.stop(&app)
}
