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
const MAX_HISTORICO: usize = 40;
const NOTEPAD_HTML: &str = include_str!("../../assets/notepad.html");

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NotepadStateData {
    pub text: String,
    pub author: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotepadHistoricoItem {
    pub id: u64,
    pub text: String,
    pub author: String,
    pub updated_at: String,
    pub tamanho: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotepadStatusPayload {
    pub rodando: bool,
    pub http_ativo: bool,
    pub ws_port: u16,
    pub http_port: u16,
    pub link: String,
    pub ip_local: String,
    pub text: String,
    pub author: Option<String>,
    pub updated_at: Option<String>,
    pub clients: usize,
    pub total_revisoes: usize,
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
    history: Mutex<Vec<NotepadHistoricoItem>>,
    history_next_id: AtomicU64,
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
                let text_len = parsed.text.len();
                let initial_history = NotepadHistoricoItem {
                    id: self.history_next_id.fetch_add(1, Ordering::Relaxed),
                    text: parsed.text.clone(),
                    author: parsed.author.clone().unwrap_or_else(|| "inicial".into()),
                    updated_at: parsed
                        .updated_at
                        .clone()
                        .unwrap_or_else(|| Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()),
                    tamanho: text_len,
                };
                *self.data.lock().unwrap() = parsed;
                if text_len > 0 {
                    self.history.lock().unwrap().push(initial_history);
                }
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
        let total_revisoes = self.history.lock().unwrap().len();
        let ip = ip_local();
        NotepadStatusPayload {
            rodando,
            http_ativo,
            ws_port: self.ws_port,
            http_port: self.http_port,
            link: if http_ativo {
                format!("http://{}:{}", ip, self.http_port)
            } else {
                format!("ws://{}:{}", ip, self.ws_port)
            },
            ip_local: ip,
            text: data.text,
            author: data.author,
            updated_at: data.updated_at,
            clients,
            total_revisoes,
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

    fn registrar_historico(&self, text: &str, author: &str, updated_at: &str) {
        let mut hist = self.history.lock().unwrap();
        // Não duplica se o topo for idêntico
        if let Some(ultimo) = hist.last() {
            if ultimo.text == text {
                return;
            }
        }
        let item = NotepadHistoricoItem {
            id: self.history_next_id.fetch_add(1, Ordering::Relaxed),
            text: text.to_string(),
            author: author.to_string(),
            updated_at: updated_at.to_string(),
            tamanho: text.len(),
        };
        hist.push(item);
        if hist.len() > MAX_HISTORICO {
            hist.remove(0);
        }
    }

    fn update_text(&self, text: String, author: String) {
        let truncated_author: String = author.chars().take(60).collect();
        let updated_at = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();

        let snapshot = {
            let mut data = self.data.lock().unwrap();
            // Salva histórico da versão anterior se ela não estava vazia e mudou significativamente
            if !data.text.is_empty() && data.text != text {
                let ant_author = data.author.clone().unwrap_or_else(|| "anterior".into());
                let ant_updated = data
                    .updated_at
                    .clone()
                    .unwrap_or_else(|| updated_at.clone());
                self.registrar_historico(&data.text, &ant_author, &ant_updated);
            }

            data.text = text;
            data.author = Some(truncated_author);
            data.updated_at = Some(updated_at);
            data.clone()
        };

        let _ = self.save_atomico(&snapshot);
        self.broadcast_and_emit();
    }

    fn restaurar_versao(&self, versao_id: u64) -> Result<(), String> {
        let item_opt = {
            let hist = self.history.lock().unwrap();
            hist.iter().find(|i| i.id == versao_id).cloned()
        };

        match item_opt {
            Some(item) => {
                let autor = format!("Restaurado ({})", item.author);
                self.update_text(item.text, autor);
                Ok(())
            }
            None => Err(format!("Revisão ID {versao_id} não encontrada.")),
        }
    }

    fn obter_historico(&self) -> Vec<NotepadHistoricoItem> {
        self.history.lock().unwrap().clone()
    }

    fn limpar_historico(&self) {
        self.history.lock().unwrap().clear();
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
            history: Mutex::new(Vec::new()),
            history_next_id: AtomicU64::new(1),
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
                    "Não foi possível ligar o WebSocket na porta {ws_port}: {e}. A porta está em uso por outro processo?"
                )
            })?;

        let http_listener = tokio::net::TcpListener::bind(("0.0.0.0", http_port)).await.ok();
        *inner.http_ativo.lock().unwrap() = http_listener.is_some();

        let (stop_tx, stop_rx) = watch::channel(false);

        // Servidor WebSocket Axum
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

        // Servidor HTTP Axum servindo a interface web para navegadores na LAN
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
            ip_local: ip_local(),
            text: String::new(),
            author: None,
            updated_at: None,
            clients: 0,
            total_revisoes: 0,
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

    pub fn restaurar_versao(&self, versao_id: u64) -> Result<(), String> {
        let guard = self.running.lock().unwrap();
        if let Some((ref inner, _)) = *guard {
            inner.restaurar_versao(versao_id)
        } else {
            Err("Serviço de notepad não está em execução.".into())
        }
    }

    pub fn obter_historico(&self) -> Vec<NotepadHistoricoItem> {
        let guard = self.running.lock().unwrap();
        if let Some((ref inner, _)) = *guard {
            inner.obter_historico()
        } else {
            Vec::new()
        }
    }

    pub fn limpar_historico(&self) {
        let guard = self.running.lock().unwrap();
        if let Some((ref inner, _)) = *guard {
            inner.limpar_historico();
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
                ip_local: ip_local(),
                text: String::new(),
                author: None,
                updated_at: None,
                clients: 0,
                total_revisoes: 0,
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
