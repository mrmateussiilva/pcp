use crate::core::config::ConfigManager;
use crate::core::consumo::{self, ConsumoConfig, ConsumoResultado, ConsumoService, ConsumoStatus};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn consumo_analisar(
    srv: State<'_, ConsumoService>,
    pasta: String,
) -> Result<ConsumoResultado, String> {
    let dir = PathBuf::from(pasta.trim());
    if !dir.is_dir() {
        return Err("Selecione uma pasta válida.".to_string());
    }
    let cfg = srv.get_config();
    tokio::task::spawn_blocking(move || consumo::analisar_pasta(&dir, &cfg))
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
pub fn consumo_get_config(
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ConsumoService>,
) -> ConsumoConfig {
    if let Some(sec) = cfg.get().secoes.get("consumo") {
        if let Ok(c) = serde_json::from_value::<ConsumoConfig>(sec.clone()) {
            srv.set_config(c.clone());
            return c;
        }
    }
    srv.get_config()
}

#[tauri::command]
pub fn consumo_save_config(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ConsumoService>,
    config: ConsumoConfig,
) -> Result<(), String> {
    srv.set_config(config.clone());
    let pasta = srv.pasta();
    let val = serde_json::to_value(&config).map_err(|e| e.to_string())?;
    let _ = cfg.update(|c| {
        let mut map = match val {
            serde_json::Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };
        if !pasta.is_empty() {
            map.insert("pasta".to_string(), serde_json::Value::String(pasta));
        }
        c.secoes.insert("consumo".to_string(), serde_json::Value::Object(map));
    });

    let _ = srv.recarregar_se_necessario(&app);
    Ok(())
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
    let pasta_str = pasta.trim().to_string();
    let _ = cfg.update(|c| {
        let entry = c
            .secoes
            .entry("consumo".to_string())
            .or_insert_with(|| json!({}));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("pasta".to_string(), json!(pasta_str));
        }
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
