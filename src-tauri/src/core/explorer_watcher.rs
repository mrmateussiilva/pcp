use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static WATCHER_ESTADO: OnceLock<Mutex<Option<WatcherControl>>> = OnceLock::new();

struct WatcherControl {
    pasta: String,
    stop: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NovoArquivoEvento {
    pub caminho: String,
    pub nome: String,
    pub pasta: String,
    pub extensao: String,
    pub tamanho_bytes: u64,
}

fn get_watcher_mutex() -> &'static Mutex<Option<WatcherControl>> {
    WATCHER_ESTADO.get_or_init(|| Mutex::new(None))
}

/// Inicia o monitoramento de uma pasta para alertar sobre novos arquivos salvos
pub fn iniciar_monitoramento(app: AppHandle, pasta: String) -> Result<String, String> {
    let p = PathBuf::from(&pasta);
    if !p.is_dir() {
        return Err("A pasta informada não existe ou é inválida.".to_string());
    }

    let mut lock = get_watcher_mutex().lock().unwrap();

    // Se já estiver monitorando esta mesma pasta, mantém
    if let Some(ref ctrl) = *lock {
        if ctrl.pasta == pasta && !ctrl.stop.load(Ordering::Relaxed) {
            return Ok(format!("Já monitorando: {pasta}"));
        }
        // Para a anterior
        ctrl.stop.store(true, Ordering::Relaxed);
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = Arc::clone(&stop);
    let pasta_clone = pasta.clone();
    let pasta_alvo = p.clone();

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let _watcher = match RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        ) {
            Ok(mut w) => {
                if let Err(_) = w.watch(&pasta_alvo, RecursiveMode::NonRecursive) {
                    return;
                }
                w
            }
            Err(_) => return,
        };

        // Cache de eventos recentes para debounce de gravação (500ms)
        let mut debounce_map: HashMap<PathBuf, Instant> = HashMap::new();

        while !stop_thread.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    let mut candidatos = Vec::new();
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for path in event.paths {
                                if path.is_file() {
                                    candidatos.push(path);
                                }
                            }
                        }
                        _ => {}
                    }

                    let agora = Instant::now();
                    for path in candidatos {
                        // Evita spam do mesmo arquivo que ainda está sendo salvo
                        if let Some(ultimo) = debounce_map.get(&path) {
                            if agora.duration_since(*ultimo) < Duration::from_millis(800) {
                                continue;
                            }
                        }
                        debounce_map.insert(path.clone(), agora);

                        // Limpa debounce map periodicamente
                        if debounce_map.len() > 100 {
                            debounce_map.retain(|_, v| agora.duration_since(*v) < Duration::from_secs(5));
                        }

                        let nome = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();

                        // Ignora arquivos temporários do Photoshop / Office / sistema
                        if nome.starts_with("~") || nome.starts_with(".") || nome.ends_with(".tmp") {
                            continue;
                        }

                        let ext = path
                            .extension()
                            .map(|e| e.to_string_lossy().to_lowercase())
                            .unwrap_or_default();

                        let meta = std::fs::metadata(&path).ok();
                        let tamanho_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);

                        let payload = NovoArquivoEvento {
                            caminho: path.to_string_lossy().to_string(),
                            nome,
                            pasta: pasta_clone.clone(),
                            extensao: ext,
                            tamanho_bytes,
                        };

                        let _ = app.emit("explorer://novo-arquivo", payload);
                    }
                }
                _ => {}
            }
        }
    });

    *lock = Some(WatcherControl {
        pasta: pasta.clone(),
        stop,
    });

    Ok(format!("Monitoramento iniciado em: {pasta}"))
}

/// Encerra o monitoramento ativo
pub fn parar_monitoramento() -> Result<String, String> {
    let mut lock = get_watcher_mutex().lock().unwrap();
    if let Some(ctrl) = lock.take() {
        ctrl.stop.store(true, Ordering::Relaxed);
        Ok(format!("Monitoramento encerrado para: {}", ctrl.pasta))
    } else {
        Ok("Nenhum monitoramento ativo no momento.".to_string())
    }
}

/// Retorna a pasta atualmente monitorada, se houver
pub fn pasta_monitorada() -> Option<String> {
    let lock = get_watcher_mutex().lock().unwrap();
    lock.as_ref().and_then(|c| {
        if !c.stop.load(Ordering::Relaxed) {
            Some(c.pasta.clone())
        } else {
            None
        }
    })
}
