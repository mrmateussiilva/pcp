use crate::core::consumo::{self, ConsumoResultado};
use std::path::PathBuf;

#[tauri::command]
pub async fn consumo_analisar(pasta: String) -> Result<ConsumoResultado, String> {
    let dir = PathBuf::from(pasta.trim());
    if !dir.is_dir() {
        return Err("Selecione uma pasta válida.".to_string());
    }
    tokio::task::spawn_blocking(move || consumo::analisar_pasta(&dir))
        .await
        .map_err(|e| format!("Erro interno: {e}"))?
}
