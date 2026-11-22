use crate::core::config::ConfigManager;
use crate::core::shopee::{
    carregar_miniatura_base64, listar_prontos, obter_diagnostico, ShopeeCounters,
    ShopeeDiagnostico, ShopeeOpcoes, ShopeeProntoItem, ShopeeService, ShopeeStatus,
};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn shopee_get_config(cfg: State<'_, ConfigManager>) -> ShopeeOpcoes {
    let c = cfg.get();
    let sec = c.secoes.get("shopee");

    ShopeeOpcoes {
        pasta: sec
            .and_then(|s| s.get("pasta"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        tolerancia_min: sec
            .and_then(|s| s.get("tolerancia_min"))
            .and_then(|v| v.as_u64())
            .unwrap_or(2),
        pagina: sec
            .and_then(|s| s.get("pagina"))
            .and_then(|v| v.as_u64())
            .unwrap_or(2) as u32,
        dpi: sec
            .and_then(|s| s.get("dpi"))
            .and_then(|v| v.as_u64())
            .unwrap_or(200) as u32,
        margem: sec
            .and_then(|s| s.get("margem"))
            .and_then(|v| v.as_f64())
            .unwrap_or(20.0),
        espaco: sec
            .and_then(|s| s.get("espaco"))
            .and_then(|v| v.as_f64())
            .unwrap_or(8.0),
        layout: sec
            .and_then(|s| s.get("layout"))
            .and_then(|v| v.as_str())
            .unwrap_or("empilhado")
            .to_string(),
    }
}

#[tauri::command]
pub fn shopee_save_config(
    cfg: State<'_, ConfigManager>,
    opcoes: ShopeeOpcoes,
) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert("shopee".to_string(), json!(opcoes));
    })?;
    Ok(())
}

#[tauri::command]
pub fn shopee_status(srv: State<'_, ShopeeService>) -> ShopeeStatus {
    srv.status()
}

#[tauri::command]
pub fn shopee_counters(srv: State<'_, ShopeeService>) -> ShopeeCounters {
    srv.counters()
}

#[tauri::command]
pub fn shopee_reset_counters(srv: State<'_, ShopeeService>, app: AppHandle) {
    srv.reset_counters();
    let _ = app.emit("shopee-counters", srv.counters());
}

#[tauri::command]
pub fn shopee_iniciar(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ShopeeService>,
    opcoes: ShopeeOpcoes,
    refazer: bool,
) -> Result<ShopeeStatus, String> {
    let _ = shopee_save_config(cfg, opcoes.clone());
    srv.start(app, opcoes, refazer)
}

#[tauri::command]
pub fn shopee_parar(app: AppHandle, srv: State<'_, ShopeeService>) -> ShopeeStatus {
    srv.stop(&app)
}

#[tauri::command]
pub fn shopee_executar_uma_vez(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, ShopeeService>,
    opcoes: ShopeeOpcoes,
    refazer: bool,
) -> Result<(), String> {
    let _ = shopee_save_config(cfg, opcoes.clone());
    srv.executar_uma_vez(app, opcoes, refazer)
}

#[tauri::command]
pub async fn shopee_obter_diagnostico(
    pasta: String,
    tolerancia_min: Option<u64>,
) -> Result<ShopeeDiagnostico, String> {
    let p = PathBuf::from(pasta.trim());
    if !p.is_dir() {
        return Err("Pasta inválida.".to_string());
    }
    let tol = tolerancia_min.unwrap_or(2);
    tokio::task::spawn_blocking(move || obter_diagnostico(&p, tol))
        .await
        .map_err(|e| format!("Erro no diagnóstico: {e}"))?
}

#[tauri::command]
pub async fn shopee_listar_prontos(
    pasta: String,
    limite: Option<usize>,
) -> Result<Vec<ShopeeProntoItem>, String> {
    let p = PathBuf::from(pasta.trim());
    if !p.is_dir() {
        return Ok(Vec::new());
    }
    let lim = limite.unwrap_or(48);
    tokio::task::spawn_blocking(move || listar_prontos(&p, lim))
        .await
        .map_err(|e| format!("Erro ao listar prontos: {e}"))
}

#[tauri::command]
pub async fn shopee_carregar_miniatura(caminho: String) -> Result<String, String> {
    let p = PathBuf::from(caminho.trim());
    tokio::task::spawn_blocking(move || carregar_miniatura_base64(&p))
        .await
        .map_err(|e| format!("Erro ao gerar miniatura: {e}"))?
}
