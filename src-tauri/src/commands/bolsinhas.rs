use crate::core::bolsinhas::{
    carregar_miniatura_base64, listar_recentes, BolsinhaItemInfo, BolsinhasCounters,
    BolsinhasOpcoes, BolsinhasService, BolsinhasStatus,
};
use crate::core::config::{pasta_do_dia, ConfigManager};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn bolsinhas_get_config(cfg: State<'_, ConfigManager>) -> BolsinhasOpcoes {
    let c = cfg.get();
    let sec = c.secoes.get("bolsinhas");
    let dia_p = pasta_do_dia(&c, "BOLSINHAS/PARA FAZER", None);
    let pasta = if dia_p.is_dir() {
        dia_p.to_string_lossy().into_owned()
    } else {
        sec.and_then(|s| s.get("pasta"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let extras = sec
        .and_then(|s| s.get("extras"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    BolsinhasOpcoes {
        pasta,
        extras,
        apagar_repetido: sec
            .and_then(|s| s.get("apagar_repetido"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        som: sec
            .and_then(|s| s.get("som"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        usar_pai: sec
            .and_then(|s| s.get("usar_pai"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        escala_pct: sec
            .and_then(|s| s.get("escala_pct"))
            .and_then(|v| v.as_f64())
            .unwrap_or(10.0),
        qualidade_jpeg: sec
            .and_then(|s| s.get("qualidade_jpeg"))
            .and_then(|v| v.as_u64())
            .unwrap_or(85) as u8,
    }
}

#[tauri::command]
pub fn bolsinhas_save_config(
    cfg: State<'_, ConfigManager>,
    opcoes: BolsinhasOpcoes,
) -> Result<(), String> {
    cfg.update(|c| {
        c.secoes.insert("bolsinhas".to_string(), json!(opcoes));
    })?;
    Ok(())
}

#[tauri::command]
pub fn bolsinhas_status(srv: State<'_, BolsinhasService>) -> BolsinhasStatus {
    srv.status()
}

#[tauri::command]
pub fn bolsinhas_counters(srv: State<'_, BolsinhasService>) -> BolsinhasCounters {
    srv.counters()
}

#[tauri::command]
pub fn bolsinhas_reset_counters(srv: State<'_, BolsinhasService>, app: AppHandle) {
    srv.reset_counters();
    let _ = app.emit("bolsinhas-counters", srv.counters());
}

#[tauri::command]
pub fn bolsinhas_iniciar(
    app: AppHandle,
    cfg: State<'_, ConfigManager>,
    srv: State<'_, BolsinhasService>,
    opcoes: BolsinhasOpcoes,
) -> Result<BolsinhasStatus, String> {
    let _ = bolsinhas_save_config(cfg, opcoes.clone());
    srv.start(app, opcoes)
}

#[tauri::command]
pub fn bolsinhas_parar(app: AppHandle, srv: State<'_, BolsinhasService>) -> BolsinhasStatus {
    srv.stop(&app)
}

#[tauri::command]
pub fn bolsinhas_processar_lote(
    app: AppHandle,
    srv: State<'_, BolsinhasService>,
    opcoes: BolsinhasOpcoes,
) -> Result<(), String> {
    srv.processar_lote_agora(app, opcoes)
}

#[tauri::command]
pub fn bolsinhas_varredura(
    app: AppHandle,
    srv: State<'_, BolsinhasService>,
    pasta: String,
    mover: bool,
) -> Result<(), String> {
    srv.varredura(app, PathBuf::from(pasta.trim()), mover)
}

#[tauri::command]
pub async fn bolsinhas_listar_recentes(
    pasta: String,
    limite: Option<usize>,
) -> Result<Vec<BolsinhaItemInfo>, String> {
    let p = PathBuf::from(pasta.trim());
    if !p.is_dir() {
        return Ok(Vec::new());
    }
    let lim = limite.unwrap_or(48);
    tokio::task::spawn_blocking(move || listar_recentes(&p, lim))
        .await
        .map_err(|e| format!("Erro ao listar recentes: {e}"))
}

#[tauri::command]
pub async fn bolsinhas_carregar_miniatura(caminho: String) -> Result<String, String> {
    let p = PathBuf::from(caminho.trim());
    tokio::task::spawn_blocking(move || carregar_miniatura_base64(&p))
        .await
        .map_err(|e| format!("Erro ao ler miniatura: {e}"))?
}
