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

#[tauri::command]
pub async fn explorer_iniciar_monitoramento(
    app: tauri::AppHandle,
    pasta: String,
) -> Result<String, String> {
    crate::core::explorer_watcher::iniciar_monitoramento(app, pasta)
}

#[tauri::command]
pub async fn explorer_parar_monitoramento() -> Result<String, String> {
    crate::core::explorer_watcher::parar_monitoramento()
}

#[tauri::command]
pub async fn explorer_pasta_monitorada() -> Result<Option<String>, String> {
    Ok(crate::core::explorer_watcher::pasta_monitorada())
}

#[tauri::command]
pub async fn explorer_buscar_por_imagem(
    referencia: String,
    caminhos: Vec<String>,
) -> Result<Vec<crate::core::explorer_search::SimilaridadeResultado>, String> {
    tokio::task::spawn_blocking(move || {
        use crate::core::explorer_search::{
            calcular_similaridade, carregar_imagem_referencia, extrair_fingerprint,
            SimilaridadeResultado,
        };

        let ref_img = carregar_imagem_referencia(&referencia)?;
        let ref_fp = extrair_fingerprint(&ref_img)
            .ok_or("Não foi possível extrair características da imagem de referência.")?;

        let mut resultados = Vec::new();

        for caminho in caminhos {
            // Tenta obter via inspecionar_imagem (que já usa cache no SSD local)
            let img_alvo_res = explorer::inspecionar_imagem(&caminho);
            if let Ok(info) = img_alvo_res {
                if let Some(ref data_url) = info.miniatura_data_url {
                    if let Ok(thumb_img) = carregar_imagem_referencia(data_url) {
                        if let Some(thumb_fp) = extrair_fingerprint(&thumb_img) {
                            let score = calcular_similaridade(&ref_fp, &thumb_fp);
                            resultados.push(SimilaridadeResultado { caminho, score });
                            continue;
                        }
                    }
                }
            }

            // Fallback direto
            if let Ok(dyn_img) = image::open(&caminho) {
                if let Some(alvo_fp) = extrair_fingerprint(&dyn_img) {
                    let score = calcular_similaridade(&ref_fp, &alvo_fp);
                    resultados.push(SimilaridadeResultado { caminho, score });
                }
            }
        }

        // Ordena pela maior similaridade primeiro
        resultados.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        Ok(resultados)
    })
    .await
    .map_err(|e| e.to_string())?
}

