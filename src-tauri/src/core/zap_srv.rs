use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

const MAX_MSGS: usize = 3000;

#[derive(Debug, Clone, Serialize)]
pub struct ZapMensagem {
    pub hora: String,
    pub grupo: String,
    pub autor: String,
    pub texto: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZapStatus {
    pub rodando: bool,
    pub porta: u16,
}

struct ZapInner {
    token: Option<String>,
    app: AppHandle,
}

pub struct ZapService {
    running: Mutex<Option<(u16, watch::Sender<bool>)>>,
    historico: Arc<Mutex<VecDeque<ZapMensagem>>>,
}

impl ZapService {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
            historico: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_MSGS))),
        }
    }

    pub async fn start(
        &self,
        app: AppHandle,
        porta: u16,
        token: Option<String>,
    ) -> Result<ZapStatus, String> {
        {
            let guard = self.running.lock().unwrap();
            if let Some((p, _)) = *guard {
                return Ok(ZapStatus {
                    rodando: true,
                    porta: p,
                });
            }
        }

        let listener = tokio::net::TcpListener::bind(("0.0.0.0", porta))
            .await
            .map_err(|e| {
                format!(
                    "Não foi possível ligar na porta {porta}: {e}. O messagen_zap.py antigo ainda está aberto?"
                )
            })?;

        let (stop_tx, mut stop_rx) = watch::channel(false);
        let historico_ref = self.historico.clone();

        let state = Arc::new(ZapInner {
            token: token.filter(|t| !t.trim().is_empty()),
            app: app.clone(),
        });

        // Sincroniza referência externa de histórico via callback direto no state:
        // para simplificar, usamos uma função que grava tanto no ZapService quanto emite evento.
        let router = Router::new()
            .route("/", get(|| async { "PCP Central — webhook ativo" }))
            .route("/webhook", post(move |st, body| handle_webhook(st, body, historico_ref.clone())))
            .with_state(state);

        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = stop_rx.changed().await;
                })
                .await;
        });

        *self.running.lock().unwrap() = Some((porta, stop_tx));
        let status = ZapStatus {
            rodando: true,
            porta,
        };
        let _ = app.emit("whatsapp-status", status.clone());
        Ok(status)
    }

    pub fn stop(&self, app: &AppHandle) -> ZapStatus {
        if let Some((_, stop_tx)) = self.running.lock().unwrap().take() {
            let _ = stop_tx.send(true);
        }
        let status = ZapStatus {
            rodando: false,
            porta: 0,
        };
        let _ = app.emit("whatsapp-status", status.clone());
        status
    }

    pub fn status(&self) -> ZapStatus {
        let guard = self.running.lock().unwrap();
        if let Some((porta, _)) = *guard {
            ZapStatus {
                rodando: true,
                porta,
            }
        } else {
            ZapStatus {
                rodando: false,
                porta: 0,
            }
        }
    }

    pub fn historico(&self) -> Vec<ZapMensagem> {
        self.historico.lock().unwrap().iter().cloned().collect()
    }

    pub fn limpar_historico(&self) {
        self.historico.lock().unwrap().clear();
    }
}

async fn handle_webhook(
    State(inner): State<Arc<ZapInner>>,
    Json(evento): Json<Value>,
    historico: Arc<Mutex<VecDeque<ZapMensagem>>>,
) -> StatusCode {
    if let Some(ref esperado) = inner.token {
        let recebido = evento
            .get("instanceToken")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if recebido != esperado {
            return StatusCode::FORBIDDEN;
        }
    }

    if evento.get("event").and_then(|v| v.as_str()) != Some("Message") {
        return StatusCode::OK;
    }

    let data = evento.get("data").unwrap_or(&Value::Null);
    let info = data.get("Info").unwrap_or(&Value::Null);

    let is_group = info.get("IsGroup").and_then(|v| v.as_bool()).unwrap_or(false);
    let is_from_me = info.get("IsFromMe").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_group || is_from_me {
        return StatusCode::OK;
    }

    let msg = data.get("Message").unwrap_or(&Value::Null);
    let texto = msg
        .get("conversation")
        .and_then(|v| v.as_str())
        .or_else(|| {
            msg.get("extendedTextMessage")
                .and_then(|e| e.get("text"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let media = info
                .get("MediaType")
                .and_then(|v| v.as_str())
                .or_else(|| info.get("Type").and_then(|v| v.as_str()))
                .unwrap_or("mídia");
            format!("[{media}]")
        });

    let grupo = data
        .get("groupData")
        .and_then(|g| g.get("Name"))
        .and_then(|v| v.as_str())
        .or_else(|| info.get("Chat").and_then(|v| v.as_str()))
        .unwrap_or("Desconhecido")
        .to_string();

    let autor = info
        .get("PushName")
        .and_then(|v| v.as_str())
        .unwrap_or("Desconhecido")
        .to_string();

    let ts = info
        .get("Timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let hora = ts.get(11..19).unwrap_or(ts).to_string();

    let item = ZapMensagem {
        hora,
        grupo,
        autor,
        texto,
    };

    {
        let mut h = historico.lock().unwrap();
        if h.len() >= MAX_MSGS {
            h.pop_front();
        }
        h.push_back(item.clone());
    }
    let _ = inner.app.emit("whatsapp-mensagem", item);

    StatusCode::OK
}
