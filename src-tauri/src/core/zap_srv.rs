use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::net::UdpSocket;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

const MAX_MSGS: usize = 3000;
const MAX_SEEN_IDS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZapMensagem {
    pub id: String,
    pub hora: String,
    pub grupo: String,
    pub autor: String,
    pub texto: String,
    pub tipo_midia: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZapStatus {
    pub rodando: bool,
    pub porta: u16,
    pub link_webhook: String,
    pub total_mensagens: usize,
    pub total_grupos: usize,
    pub ultima_mensagem_hora: Option<String>,
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

struct ZapInner {
    token: Option<String>,
    app: AppHandle,
    historico: Arc<Mutex<VecDeque<ZapMensagem>>>,
    vistos: Arc<Mutex<HashSet<String>>>,
    ultima_hora: Arc<Mutex<Option<String>>>,
}

pub struct ZapService {
    running: Mutex<Option<(u16, watch::Sender<bool>)>>,
    historico: Arc<Mutex<VecDeque<ZapMensagem>>>,
    vistos: Arc<Mutex<HashSet<String>>>,
    ultima_hora: Arc<Mutex<Option<String>>>,
}

impl ZapService {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
            historico: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_MSGS))),
            vistos: Arc::new(Mutex::new(HashSet::with_capacity(MAX_SEEN_IDS))),
            ultima_hora: Arc::new(Mutex::new(None)),
        }
    }

    pub fn build_status(&self, rodando: bool, porta: u16) -> ZapStatus {
        let h = self.historico.lock().unwrap();
        let total_mensagens = h.len();
        let grupos_set: HashSet<&str> = h.iter().map(|m| m.grupo.as_str()).collect();
        let total_grupos = grupos_set.len();
        let ultima_mensagem_hora = self.ultima_hora.lock().unwrap().clone();

        let link_webhook = if rodando {
            format!("http://{}:{}/webhook", ip_local(), porta)
        } else {
            String::new()
        };

        ZapStatus {
            rodando,
            porta,
            link_webhook,
            total_mensagens,
            total_grupos,
            ultima_mensagem_hora,
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
                return Ok(self.build_status(true, p));
            }
        }

        let listener = tokio::net::TcpListener::bind(("0.0.0.0", porta))
            .await
            .map_err(|e| {
                format!(
                    "Não foi possível ligar na porta {porta}: {e}. A porta está em uso por outro processo?"
                )
            })?;

        let (stop_tx, mut stop_rx) = watch::channel(false);

        let inner = Arc::new(ZapInner {
            token: token.filter(|t| !t.trim().is_empty()),
            app: app.clone(),
            historico: self.historico.clone(),
            vistos: self.vistos.clone(),
            ultima_hora: self.ultima_hora.clone(),
        });

        let router = Router::new()
            .route("/", get(|| async { "PCP Central // WhatsApp Live Hook Ativo" }))
            .route("/webhook", post(handle_webhook))
            .with_state(inner);

        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = stop_rx.changed().await;
                })
                .await;
        });

        *self.running.lock().unwrap() = Some((porta, stop_tx));
        let status = self.build_status(true, porta);
        let _ = app.emit("whatsapp-status", status.clone());
        Ok(status)
    }

    pub fn stop(&self, app: &AppHandle) -> ZapStatus {
        if let Some((_, stop_tx)) = self.running.lock().unwrap().take() {
            let _ = stop_tx.send(true);
        }
        let status = self.build_status(false, 0);
        let _ = app.emit("whatsapp-status", status.clone());
        status
    }

    pub fn status(&self) -> ZapStatus {
        let guard = self.running.lock().unwrap();
        if let Some((porta, _)) = *guard {
            self.build_status(true, porta)
        } else {
            self.build_status(false, 0)
        }
    }

    pub fn historico(&self) -> Vec<ZapMensagem> {
        self.historico.lock().unwrap().iter().cloned().collect()
    }

    pub fn limpar_historico(&self) {
        self.historico.lock().unwrap().clear();
        self.vistos.lock().unwrap().clear();
        *self.ultima_hora.lock().unwrap() = None;
    }

    pub fn injetar_teste(&self, app: &AppHandle) -> ZapMensagem {
        let hora = Local::now().format("%H:%M:%S").to_string();
        let id = format!("test_{}", Local::now().timestamp_millis());
        let msg = ZapMensagem {
            id,
            hora: hora.clone(),
            grupo: "Estamparia - PCP Central (Teste)".to_string(),
            autor: "Operador Simulado".to_string(),
            texto: "PEDIDO #10492 - 15 un Bolsinha Estampada Concluída! Arte conferida.".to_string(),
            tipo_midia: "texto".to_string(),
        };

        {
            let mut h = self.historico.lock().unwrap();
            if h.len() >= MAX_MSGS {
                h.pop_front();
            }
            h.push_back(msg.clone());
            *self.ultima_hora.lock().unwrap() = Some(hora);
        }

        let _ = app.emit("whatsapp-mensagem", msg.clone());
        msg
    }
}

async fn handle_webhook(
    State(inner): State<Arc<ZapInner>>,
    Json(evento): Json<Value>,
) -> StatusCode {
    // Validação de Token de Autenticação se configurado
    if let Some(ref esperado) = inner.token {
        let recebido = evento
            .get("instanceToken")
            .or_else(|| evento.get("token"))
            .or_else(|| evento.get("apikey"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if recebido != esperado {
            return StatusCode::FORBIDDEN;
        }
    }

    // Suporta 'Message' (formato custom) ou 'messages.upsert' / 'messages' (formato Evolution API)
    let event_name = evento
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !event_name.eq_ignore_ascii_case("Message")
        && !event_name.eq_ignore_ascii_case("messages.upsert")
        && !event_name.eq_ignore_ascii_case("messages")
    {
        return StatusCode::OK;
    }

    let data = evento.get("data").unwrap_or(&evento);
    let info = data.get("Info").unwrap_or(&Value::Null);
    let key = data.get("key").unwrap_or(&Value::Null);

    // Identifica se é mensagem de grupo
    let is_group = info.get("IsGroup").and_then(|v| v.as_bool()).unwrap_or_else(|| {
        key.get("remoteJid")
            .and_then(|v| v.as_str())
            .map(|s| s.ends_with("@g.us"))
            .unwrap_or(false)
    });

    // Ignora mensagens enviadas por mim
    let is_from_me = info.get("IsFromMe").and_then(|v| v.as_bool()).unwrap_or_else(|| {
        key.get("fromMe").and_then(|v| v.as_bool()).unwrap_or(false)
    });

    if !is_group || is_from_me {
        return StatusCode::OK;
    }

    // Identificador único para deduplicação
    let id_msg = info
        .get("Id")
        .and_then(|v| v.as_str())
        .or_else(|| key.get("id").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    if !id_msg.is_empty() {
        let mut vistos = inner.vistos.lock().unwrap();
        if vistos.contains(&id_msg) {
            return StatusCode::OK;
        }
        if vistos.len() >= MAX_SEEN_IDS {
            vistos.clear();
        }
        vistos.insert(id_msg.clone());
    }

    // Extração de Conteúdo e Mídia
    let msg = data.get("Message").or_else(|| data.get("message")).unwrap_or(&Value::Null);

    let (texto, tipo_midia) = if let Some(conv) = msg.get("conversation").and_then(|v| v.as_str()) {
        (conv.to_string(), "texto".to_string())
    } else if let Some(ext) = msg.get("extendedTextMessage").and_then(|e| e.get("text")).and_then(|v| v.as_str()) {
        (ext.to_string(), "texto".to_string())
    } else if let Some(img) = msg.get("imageMessage") {
        let caption = img.get("caption").and_then(|v| v.as_str()).unwrap_or("");
        if caption.is_empty() {
            ("[FOTO]".to_string(), "imagem".to_string())
        } else {
            (format!("[FOTO] {}", caption), "imagem".to_string())
        }
    } else if let Some(doc) = msg.get("documentMessage") {
        let title = doc.get("title").or_else(|| doc.get("fileName")).and_then(|v| v.as_str()).unwrap_or("documento");
        let caption = doc.get("caption").and_then(|v| v.as_str()).unwrap_or("");
        if caption.is_empty() {
            (format!("[DOC: {}]", title), "documento".to_string())
        } else {
            (format!("[DOC: {}] {}", title, caption), "documento".to_string())
        }
    } else if msg.get("audioMessage").is_some() {
        ("[ÁUDIO]".to_string(), "audio".to_string())
    } else if msg.get("stickerMessage").is_some() {
        ("[STICKER]".to_string(), "sticker".to_string())
    } else {
        let media = info
            .get("MediaType")
            .and_then(|v| v.as_str())
            .or_else(|| info.get("Type").and_then(|v| v.as_str()))
            .unwrap_or("mídia");
        (format!("[{media}]"), "mídia".to_string())
    };

    // Extração do Nome do Grupo
    let grupo = data
        .get("groupData")
        .and_then(|g| g.get("Name"))
        .and_then(|v| v.as_str())
        .or_else(|| info.get("Chat").and_then(|v| v.as_str()))
        .or_else(|| key.get("remoteJid").and_then(|v| v.as_str()))
        .unwrap_or("Grupo Desconhecido")
        .to_string();

    // Extração do Nome do Autor
    let autor = info
        .get("PushName")
        .and_then(|v| v.as_str())
        .or_else(|| data.get("pushName").and_then(|v| v.as_str()))
        .unwrap_or("Contato")
        .to_string();

    // Timestamp
    let hora = if let Some(ts_str) = info.get("Timestamp").and_then(|v| v.as_str()) {
        ts_str.get(11..19).unwrap_or(ts_str).to_string()
    } else {
        Local::now().format("%H:%M:%S").to_string()
    };

    let item = ZapMensagem {
        id: if id_msg.is_empty() { format!("gen_{}", Local::now().timestamp_millis()) } else { id_msg },
        hora: hora.clone(),
        grupo,
        autor,
        texto,
        tipo_midia,
    };

    {
        let mut h = inner.historico.lock().unwrap();
        if h.len() >= MAX_MSGS {
            h.pop_front();
        }
        h.push_back(item.clone());
        *inner.ultima_hora.lock().unwrap() = Some(hora);
    }

    let _ = inner.app.emit("whatsapp-mensagem", item);

    StatusCode::OK
}
