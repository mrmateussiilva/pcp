mod commands;
mod core;

use core::bolsinhas::BolsinhasService;
use core::calandragem_srv::CalandragemService;
use core::config::ConfigManager;
use core::consumo::ConsumoService;
use core::cortador::CortadorService;
use core::notepad_srv::NotepadService;
use core::pastas;
use core::shopee::ShopeeService;
use core::tiff_proc::TiffService;
use core::zap_srv::ZapService;
use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Deve ser o primeiro plugin: impede uma 2ª instância (que disputaria
        // portas do Notepad/WhatsApp/Calandragem e os watchers de pasta) e
        // traz a janela existente para frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dados_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("dados"));

            let cfg_mgr = ConfigManager::new(dados_dir.clone());
            let cfg_inicial = cfg_mgr.get();
            app.manage(cfg_mgr);
            app.manage(NotepadService::new());
            app.manage(ZapService::new());
            app.manage(TiffService::new());
            app.manage(BolsinhasService::new());
            app.manage(CortadorService::new());
            app.manage(ShopeeService::new());
            app.manage(CalandragemService::new());
            let consumo_srv = ConsumoService::new();
            if let Some(sec) = cfg_inicial.secoes.get("consumo") {
                if let Ok(c) = serde_json::from_value::<core::consumo::ConsumoConfig>(sec.clone()) {
                    consumo_srv.set_config(c);
                }
            }
            app.manage(consumo_srv);

            if cfg_inicial.criar_ao_abrir {
                let cfg_clone = cfg_inicial.clone();
                std::thread::spawn(move || {
                    let _ = pastas::criar(&cfg_clone, None);
                });
            }

            // Auto-iniciar Notepad (padrão: true)
            let notepad_sec = cfg_inicial.secoes.get("notepad");
            let notepad_auto = notepad_sec
                .and_then(|s| s.get("auto_iniciar"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if notepad_auto {
                let arquivo = notepad_sec
                    .and_then(|s| s.get("arquivo"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| dados_dir.join("notes_state.json"));
                let ws_port = notepad_sec
                    .and_then(|s| s.get("ws_port"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(8765) as u16;
                let http_port = notepad_sec
                    .and_then(|s| s.get("http_port"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(8766) as u16;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let srv = handle.state::<NotepadService>();
                    let _ = srv.start(handle.clone(), arquivo, ws_port, http_port).await;
                });
            }

            // Auto-iniciar WhatsApp (se configurado)
            if let Some(zap_sec) = cfg_inicial.secoes.get("whatsapp") {
                if zap_sec.get("auto_iniciar").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let porta = zap_sec
                        .get("porta")
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                        })
                        .unwrap_or(5050) as u16;
                    let token = zap_sec
                        .get("token")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| std::env::var("EVO_TOKEN").ok());
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let srv = handle.state::<ZapService>();
                        let _ = srv.start(handle.clone(), porta, token).await;
                    });
                }
            }

            // Auto-iniciar Painel de Calandragem (padrão: true)
            let cal_sec = cfg_inicial.secoes.get("calandragem");
            let cal_auto = cal_sec
                .and_then(|s| s.get("auto_iniciar"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if cal_auto {
                let cal_porta = cal_sec
                    .and_then(|s| s.get("porta"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(8767) as u16;
                let ws_port = cfg_inicial
                    .secoes
                    .get("notepad")
                    .and_then(|s| s.get("ws_port"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(8765) as u16;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let srv = handle.state::<CalandragemService>();
                    let _ = srv.start(handle.clone(), cal_porta, ws_port).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pastas::get_config,
            commands::pastas::save_pastas_config,
            commands::pastas::listar_pastas_dia,
            commands::pastas::criar_pastas_dia,
            commands::pastas::pastas_obter_resumo,
            commands::pastas::criar_pasta_individual,
            commands::pastas::verificar_base_drive,
            commands::notepad::notepad_get_config,
            commands::notepad::notepad_save_config,
            commands::notepad::notepad_status,
            commands::notepad::notepad_iniciar,
            commands::notepad::notepad_parar,
            commands::notepad::notepad_set_texto,
            commands::notepad::notepad_obter_historico,
            commands::notepad::notepad_restaurar_versao,
            commands::notepad::notepad_limpar_historico,
            commands::whatsapp::whatsapp_get_config,
            commands::whatsapp::whatsapp_save_config,
            commands::whatsapp::whatsapp_status,
            commands::whatsapp::whatsapp_historico,
            commands::whatsapp::whatsapp_limpar,
            commands::whatsapp::whatsapp_iniciar,
            commands::whatsapp::whatsapp_parar,
            commands::whatsapp::whatsapp_injetar_teste,
            commands::consumo::consumo_analisar,
            commands::consumo::consumo_get_pasta,
            commands::consumo::consumo_get_config,
            commands::consumo::consumo_save_config,
            commands::consumo::consumo_status,
            commands::consumo::consumo_resultado_atual,
            commands::consumo::consumo_iniciar_monitor,
            commands::consumo::consumo_parar_monitor,
            commands::tiff::tiff_pasta_inicial,
            commands::tiff::tiff_get_config,
            commands::tiff::tiff_save_config,
            commands::tiff::tiff_status,
            commands::tiff::tiff_counters,
            commands::tiff::tiff_set_add_name,
            commands::tiff::tiff_iniciar,
            commands::tiff::tiff_parar,
            commands::tiff::tiff_processar_lote,
            commands::bolsinhas::bolsinhas_get_config,
            commands::bolsinhas::bolsinhas_save_config,
            commands::bolsinhas::bolsinhas_status,
            commands::bolsinhas::bolsinhas_counters,
            commands::bolsinhas::bolsinhas_reset_counters,
            commands::bolsinhas::bolsinhas_iniciar,
            commands::bolsinhas::bolsinhas_parar,
            commands::bolsinhas::bolsinhas_processar_lote,
            commands::bolsinhas::bolsinhas_varredura,
            commands::bolsinhas::bolsinhas_listar_recentes,
            commands::bolsinhas::bolsinhas_carregar_miniatura,
            commands::cortador::cortador_get_config,
            commands::cortador::cortador_save_config,
            commands::cortador::cortador_rodando,
            commands::cortador::cortador_executar_auto,
            commands::cortador::cortador_executar_medidas,
            commands::cortador::cortador_cancelar,
            commands::cortador::cortador_simular_auto,
            commands::cortador::cortador_simular_medidas,
            commands::shopee::shopee_get_config,
            commands::shopee::shopee_save_config,
            commands::shopee::shopee_status,
            commands::shopee::shopee_counters,
            commands::shopee::shopee_reset_counters,
            commands::shopee::shopee_iniciar,
            commands::shopee::shopee_parar,
            commands::shopee::shopee_executar_uma_vez,
            commands::shopee::shopee_obter_diagnostico,
            commands::shopee::shopee_listar_prontos,
            commands::shopee::shopee_carregar_miniatura,
            commands::calandragem::calandragem_get_config,
            commands::calandragem::calandragem_save_config,
            commands::calandragem::calandragem_status,
            commands::calandragem::calandragem_iniciar,
            commands::calandragem::calandragem_parar,
            commands::explorer::explorer_get_config,
            commands::explorer::explorer_save_config,
            commands::explorer::explorer_listar_raizes,
            commands::explorer::explorer_listar_dir,
            commands::explorer::explorer_criar_pasta,
            commands::explorer::explorer_renomear,
            commands::explorer::explorer_excluir,
            commands::explorer::explorer_copiar_ou_mover,
            commands::explorer::explorer_revelar_no_sistema,
            commands::explorer::explorer_inspecionar_imagem,
            commands::explorer::explorer_iniciar_monitoramento,
            commands::explorer::explorer_parar_monitoramento,
            commands::explorer::explorer_pasta_monitorada,
            commands::explorer::explorer_buscar_por_imagem,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
