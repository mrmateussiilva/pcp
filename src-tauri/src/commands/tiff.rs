use crate::core::config::{pasta_do_dia, ConfigManager};
use crate::core::tiff_proc::{TiffConfig, TiffCounters, TiffLoteSummary, TiffService, TiffStatus};
use serde_json::json;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn tiff_pasta_inicial(cfg: State<'_, ConfigManager>) -> String {
    let c = cfg.get();
    let p = pasta_do_dia(&c, "CONF", None);
    if p.is_dir() {
        p.to_string_lossy().into_owned()
    } else {
        String::new()
    }
}

#[tauri::command]
pub fn tiff_get_config(
    cfg: State<'_, ConfigManager>,
    srv: State<'_, TiffService>,
) -> TiffConfig {
    let c = cfg.get();
    let sec = c.secoes.get("tiff");
    let dia_p = pasta_do_dia(&c, "CONF", None);
    let pasta = if dia_p.is_dir() {
        dia_p.to_string_lossy().into_owned()
    } else {
        sec.and_then(|s| s.get("pasta"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let def = srv.current_config();

    TiffConfig {
        pasta,
        pasta_saida: sec
            .and_then(|s| s.get("pasta_saida"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        target_width_cm: sec
            .and_then(|s| s.get("target_width_cm"))
            .and_then(|v| v.as_f64())
            .unwrap_or(def.target_width_cm),
        tolerancia_cm: sec
            .and_then(|s| s.get("tolerancia_cm"))
            .and_then(|v| v.as_f64())
            .unwrap_or(def.tolerancia_cm),
        pad_cm: sec
            .and_then(|s| s.get("pad_cm"))
            .and_then(|v| v.as_f64())
            .unwrap_or(def.pad_cm),
        borda_px: sec
            .and_then(|s| s.get("borda_px"))
            .and_then(|v| v.as_u64())
            .unwrap_or(def.borda_px as u64) as u32,
        add_name: sec
            .and_then(|s| s.get("add_name"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.add_name),
    }
}

#[tauri::command]
pub fn tiff_save_config(
    cfg: State<'_, ConfigManager>,
    srv: State<'_, TiffService>,
    config: TiffConfig,
) -> Result<(), String> {
    srv.set_config(config.clone());
    cfg.update(|c| {
        c.secoes.insert("tiff".to_string(), json!(config));
    })?;
    Ok(())
}

#[tauri::command]
pub fn tiff_status(srv: State<'_, TiffService>) -> TiffStatus {
    srv.status()
}

#[tauri::command]
pub fn tiff_counters(srv: State<'_, TiffService>) -> TiffCounters {
    srv.counters()
}

#[tauri::command]
pub fn tiff_set_add_name(srv: State<'_, TiffService>, add_name: bool) {
    srv.set_add_name(add_name);
}

#[tauri::command]
pub fn tiff_iniciar(
    app: AppHandle,
    srv: State<'_, TiffService>,
    config: TiffConfig,
) -> Result<TiffStatus, String> {
    srv.start(app, config)
}

#[tauri::command]
pub fn tiff_parar(app: AppHandle, srv: State<'_, TiffService>) -> TiffStatus {
    srv.stop(&app)
}

#[tauri::command]
pub async fn tiff_processar_lote(
    app: AppHandle,
    config: TiffConfig,
) -> Result<TiffLoteSummary, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let srv = app_clone.state::<TiffService>();
        srv.process_batch(&app_clone, &config)
    })
    .await
    .map_err(|e| format!("Falha no processamento em lote: {e}"))?
}
