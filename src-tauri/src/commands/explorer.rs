use crate::core::config::{pasta_do_dia, ConfigManager};
use crate::core::explorer::{
    self, ExplorerConfig, ExplorerListagem, ExplorerRaiz, ImagemPreviewInfo, OperacaoResultado,
};
use tauri::State;

#[tauri::command]
pub fn explorer_get_config(cfg_mgr: State<ConfigManager>) -> ExplorerConfig {
    let cfg = cfg_mgr.get();
    cfg.secoes
        .get("explorer")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn explorer_save_config(
    cfg_mgr: State<ConfigManager>,
    config: ExplorerConfig,
) -> Result<(), String> {
    let val = serde_json::to_value(&config).map_err(|e| e.to_string())?;
    cfg_mgr
        .update(|c| {
            c.secoes.insert("explorer".to_string(), val);
        })
        .map(|_| ())
}

#[tauri::command]
pub async fn explorer_listar_raizes(
    cfg_mgr: State<'_, ConfigManager>,
) -> Result<Vec<ExplorerRaiz>, String> {
    let cfg = cfg_mgr.get();
    let base = cfg.base.clone();
    let dia = pasta_do_dia(&cfg, "", None);
    tokio::task::spawn_blocking(move || explorer::listar_raizes(&base, &dia))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn explorer_listar_dir(
    caminho: String,
    mostrar_ocultos: bool,
) -> Result<ExplorerListagem, String> {
    tokio::task::spawn_blocking(move || explorer::listar_diretorio(&caminho, mostrar_ocultos))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn explorer_criar_pasta(pai: String, nome: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || explorer::criar_pasta(&pai, &nome))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn explorer_renomear(caminho: String, novo_nome: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || explorer::renomear_item(&caminho, &novo_nome))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn explorer_excluir(caminhos: Vec<String>) -> Result<OperacaoResultado, String> {
    tokio::task::spawn_blocking(move || explorer::excluir_itens(&caminhos))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn explorer_copiar_ou_mover(
    origens: Vec<String>,
    destino_dir: String,
    mover: bool,
) -> Result<OperacaoResultado, String> {
    tokio::task::spawn_blocking(move || {
        explorer::copiar_ou_mover_itens(&origens, &destino_dir, mover)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn explorer_revelar_no_sistema(caminho: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || explorer::revelar_no_sistema(&caminho))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn explorer_inspecionar_imagem(caminho: String) -> Result<ImagemPreviewInfo, String> {
    tokio::task::spawn_blocking(move || explorer::inspecionar_imagem(&caminho))
        .await
        .map_err(|e| e.to_string())?
}

