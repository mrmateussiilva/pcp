use crate::core::config::{pasta_do_dia, ConfigManager};
use crate::core::tiff_proc::{TiffCounters, TiffService, TiffStatus};
use std::path::PathBuf;
use tauri::{AppHandle, State};

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
    pasta: String,
    add_name: bool,
) -> Result<TiffStatus, String> {
    srv.start(app, PathBuf::from(pasta.trim()), add_name)
}

#[tauri::command]
pub fn tiff_parar(app: AppHandle, srv: State<'_, TiffService>) -> TiffStatus {
    srv.stop(&app)
}
