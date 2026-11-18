use crate::core::bolsinhas::{
    BolsinhasCounters, BolsinhasOpcoes, BolsinhasService, BolsinhasStatus,
};
use crate::core::config::{pasta_do_dia, ConfigManager};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, State};

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
pub fn bolsinhas_varredura(
    app: AppHandle,
    srv: State<'_, BolsinhasService>,
    pasta: String,
    mover: bool,
) -> Result<(), String> {
    srv.varredura(app, PathBuf::from(pasta.trim()), mover)
}
