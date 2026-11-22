use crate::core::config::{pasta_do_dia, ConfigManager};
use crate::core::cortador::{
    simular_auto, simular_medidas, CortadorAutoPayload, CortadorMedidasPayload, CortadorService,
    CortadorSimulacao,
};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn cortador_get_config(cfg: State<'_, ConfigManager>) -> Value {
    let c = cfg.get();
    let mut sec = c
        .secoes
        .get("cortador")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let dia_p = pasta_do_dia(&c, "PAINEL_CUT", None);
    if dia_p.is_dir() {
        let s = dia_p.to_string_lossy().into_owned();
        if let Some(obj) = sec.as_object_mut() {
            let auto = obj.entry("auto").or_insert_with(|| json!({}));
            if let Some(a) = auto.as_object_mut() {
                a.insert("pasta".to_string(), json!(s));
            }
            let med = obj.entry("medidas").or_insert_with(|| json!({}));
            if let Some(m) = med.as_object_mut() {
                m.insert("entrada".to_string(), json!(s));
            }
        }
    }
    sec
}

#[tauri::command]
pub fn cortador_save_config(cfg: State<'_, ConfigManager>, data: Value) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert("cortador".to_string(), data);
    })?;
    Ok(())
}

#[tauri::command]
pub fn cortador_rodando(srv: State<'_, CortadorService>) -> bool {
    srv.rodando()
}

#[tauri::command]
pub fn cortador_executar_auto(
    app: AppHandle,
    srv: State<'_, CortadorService>,
    payload: CortadorAutoPayload,
) -> Result<(), String> {
    srv.executar_auto(app, payload)
}

#[tauri::command]
pub fn cortador_executar_medidas(
    app: AppHandle,
    srv: State<'_, CortadorService>,
    payload: CortadorMedidasPayload,
) -> Result<(), String> {
    srv.executar_medidas(app, payload)
}

#[tauri::command]
pub fn cortador_cancelar(srv: State<'_, CortadorService>) {
    srv.cancelar();
}

#[tauri::command]
pub async fn cortador_simular_auto(
    payload: CortadorAutoPayload,
) -> Result<CortadorSimulacao, String> {
    tokio::task::spawn_blocking(move || simular_auto(&payload))
        .await
        .map_err(|e| format!("Falha na simulação: {e}"))?
}

#[tauri::command]
pub async fn cortador_simular_medidas(
    payload: CortadorMedidasPayload,
) -> Result<CortadorSimulacao, String> {
    tokio::task::spawn_blocking(move || simular_medidas(&payload))
        .await
        .map_err(|e| format!("Falha na simulação: {e}"))?
}
