use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use chrono::Local;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch};

const MAX_TEXT_LEN: usize = 200_000;
const NOTEPAD_HTML: &str = include_str!("../../assets/notepad.html");

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotepadStateData {
    pub text: String,
    pub author: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotepadStatusPayload {
    pub rodando: bool,
    pub http_ativo: bool,
    pub ws_port: u16,
    pub http_port: u16,
    pub link: String,
    pub text: String,
    pub author: Option<String>,
    pub updated_at: Option<String>,
    pub clients: usize,
}

#[derive(Debug, Serialize)]
struct WsStateMessage<'a> {
    #[serde(rename = "type")]
    msg_type: &'a str,
    text: &'a str,
    author: &'a Option<String>,
    updated_at: &'a Option<String>,
    clients: usize,
}

#[derive(Debug, Deserialize)]
struct WsIncoming {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    text: Option<String>,
    author: Option<String>,
}

pub fn ip_local() -> String {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

struct Inner {
    state_file: PathBuf,
    data: Mutex<NotepadStateData>,
    clients: Mutex<HashMap<u64, mpsc::UnboundedSender<String>>>,
    next_id: AtomicU64,
    http_ativo: Mutex<bool>,
    app: AppHandle,
    ws_port: u16,
    http_port: u16,
}

impl Inner {
    fn load(&self) {
        if let Ok(raw) = fs::read_to_string(&self.state_file) {
            if let Ok(parsed) = serde_json::from_str::<NotepadStateData>(&raw) {
                *self.data.lock().unwrap() = parsed;
                return;
            }
        }
        let data = self.data.lock().unwrap().clone();
        let _ = self.save_atomico(&data);
    }

    fn save_atomico(&self, data: &NotepadStateData) -> Result<(), String> {
        if let Some(parent) = self.state_file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        let tmp = self.state_file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.state_file).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn status_payload(&self, rodando: bool) -> NotepadStatusPayload {
        let data = self.data.lock().unwrap().clone();
        let clients = self.clients.lock().unwrap().len();
        let http_ativo = *self.http_ativo.lock().unwrap();
        NotepadStatusPayload {
            rodando,
            http_ativo,
            ws_port: self.ws_port,
            http_port: self.http_port,
            link: if http_ativo {
                format!("http://{}:{}", ip_local(), self.http_port)
            } else {
                format!("ws://{}:{}", ip_local(), self.ws_port)
            },
            text: data.text,
            author: data.author,
            updated_at: data.updated_at,
            clients,
        }
    }

    fn build_ws_payload(&self) -> String {
        let data = self.data.lock().unwrap();
        let clients = self.clients.lock().unwrap().len();
        serde_json::to_string(&WsStateMessage {
            msg_type: "state",
            text: &data.text,
            author: &data.author,
            updated_at: &data.updated_at,
            clients,
        })
        .unwrap_or_default()
    }

    fn broadcast_and_emit(&self) {
        let payload = self.build_ws_payload();
        let mut dead = Vec::new();
        {
            let clients = self.clients.lock().unwrap();
            for (&id, tx) in clients.iter() {
                if tx.send(payload.clone()).is_err() {
                    dead.push(id);
                }
            }
        }
        if !dead.is_empty() {
            let mut clients = self.clients.lock().unwrap();
            for id in dead {
                clients.remove(&id);
            }
        }
        let _ = self.app.emit("notepad-estado", self.status_payload(true));
    }

    fn update_text(&self, text: String, author: String) {
        let truncated_author: String = author.chars().take(60).collect();
        let updated_at = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let snapshot = {
            let mut data = self.data.lock().unwrap();
            data.text = text;
            data.author = Some(truncated_author);
            data.updated_at = Some(updated_at);
            data.clone()
        };
        let _ = self.save_atomico(&snapshot);
        self.broadcast_and_emit();
    }
}

pub struct NotepadService {
    running: Mutex<Option<(Arc<Inner>, watch::Sender<bool>)>>,
}

impl NotepadService {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
        }
    }

    pub async fn start(
        &self,
        app: AppHandle,
        state_file: PathBuf,
        ws_port: u16,
        http_port: u16,
    ) -> Result<NotepadStatusPayload, String> {
        {
            let guard = self.running.lock().unwrap();
            if let Some((ref inner, _)) = *guard {
                return Ok(inner.status_payload(true));
            }
        }

        let inner = Arc::new(Inner {
            state_file,
            data: Mutex::new(NotepadStateData::default()),
            clients: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            http_ativo: Mutex::new(false),
            app: app.clone(),
            ws_port,
            http_port,
        });
        inner.load();

        let ws_listener = tokio::net::TcpListener::bind(("0.0.0.0", ws_port))
            .await
            .map_err(|e| {
                format!(
                    "Não foi possível ligar o WebSocket na porta {ws_port}: {e}. O ws_server.py antigo está aberto?"
                )
            })?;

        let http_listener = tokio::net::TcpListener::bind(("0.0.0.0", http_port)).await.ok();
        *inner.http_ativo.lock().unwrap() = http_listener.is_some();

        let (stop_tx, stop_rx) = watch::channel(false);

        // WebSocket server
        let ws_app = Router::new()
            .route("/", get(ws_handler))
            .with_state(inner.clone());
        let mut ws_stop = stop_rx.clone();
        tokio::spawn(async move {
            let _ = axum::serve(ws_listener, ws_app)
                .with_graceful_shutdown(async move {
                    let _ = ws_stop.changed().await;
                })
                .await;
        });

        // HTTP server (opcional caso a porta esteja ocupada)
        if let Some(listener) = http_listener {
            let html_pronto = Arc::new(NOTEPAD_HTML.replace("__WS_PORT__", &ws_port.to_string()));
            let http_app = Router::new()
                .route("/", get({
                    let h = html_pronto.clone();
                    move || async move { Html((*h).clone()) }
                }))
                .route("/notepad.html", get({
                    let h = html_pronto;
                    move || async move { Html((*h).clone()) }
                }));
            let mut http_stop = stop_rx;
            tokio::spawn(async move {
                let _ = axum::serve(listener, http_app)
                    .with_graceful_shutdown(async move {
                        let _ = http_stop.changed().await;
                    })
                    .await;
            });
        }

        let status = inner.status_payload(true);
        *self.running.lock().unwrap() = Some((inner, stop_tx));
        let _ = app.emit("notepad-estado", status.clone());
        Ok(status)
    }

    pub fn stop(&self, app: &AppHandle) -> NotepadStatusPayload {
        let prev = self.running.lock().unwrap().take();
        if let Some((inner, stop_tx)) = prev {
            let _ = stop_tx.send(true);
            let mut st = inner.status_payload(false);
            st.http_ativo = false;
            let _ = app.emit("notepad-estado", st.clone());
            return st;
        }
        let st = NotepadStatusPayload {
            rodando: false,
            http_ativo: false,
            ws_port: 8765,
            http_port: 8766,
            link: String::new(),
            text: String::new(),
            author: None,
            updated_at: None,
            clients: 0,
        };
        let _ = app.emit("notepad-estado", st.clone());
        st
    }

    pub fn set_texto(&self, text: String, author: String) {
        let guard = self.running.lock().unwrap();
        if let Some((ref inner, _)) = *guard {
            inner.update_text(text, author);
        }
    }

    pub fn status(&self) -> NotepadStatusPayload {
        let guard = self.running.lock().unwrap();
        if let Some((ref inner, _)) = *guard {
            inner.status_payload(true)
        } else {
            NotepadStatusPayload {
                rodando: false,
                http_ativo: false,
                ws_port: 8765,
                http_port: 8766,
                link: String::new(),
                text: String::new(),
                author: None,
                updated_at: None,
                clients: 0,
            }
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(inner): State<Arc<Inner>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, inner))
}

async fn handle_socket(socket: WebSocket, inner: Arc<Inner>) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let id = inner.next_id.fetch_add(1, Ordering::Relaxed);

    inner.clients.lock().unwrap().insert(id, tx.clone());
    inner.broadcast_and_emit();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(txt) = msg {
            if let Ok(req) = serde_json::from_str::<WsIncoming>(&txt) {
                match req.msg_type.as_deref() {
                    Some("get_state") => {
                        let _ = tx.send(inner.build_ws_payload());
                    }
                    Some("update") => {
                        let text = req.text.unwrap_or_default();
                        if text.chars().count() > MAX_TEXT_LEN {
                            let err = serde_json::json!({
                                "type": "error",
                                "message": format!("Texto excede o limite de {MAX_TEXT_LEN} caracteres.")
                            });
                            let _ = tx.send(err.to_string());
                        } else {
                            let author = req.author.unwrap_or_else(|| "desconhecido".to_string());
                            inner.update_text(text, author);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    inner.clients.lock().unwrap().remove(&id);
    send_task.abort();
    inner.broadcast_and_emit();
}
