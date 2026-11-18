use crate::core::notepad_srv::ip_local;
use axum::{response::Html, routing::get, Router};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

const CALANDRAGEM_HTML: &str = include_str!("../../assets/calandragem.html");

#[derive(Debug, Clone, Serialize)]
pub struct CalandragemStatus {
    pub rodando: bool,
    pub porta: u16,
    pub link: String,
}

pub struct CalandragemService {
    running: Mutex<Option<(u16, watch::Sender<bool>)>>,
}

impl CalandragemService {
    pub fn new() -> Self {
        Self {
            running: Mutex::new(None),
        }
    }

    pub async fn start(
        &self,
        app: AppHandle,
        porta: u16,
        notepad_ws_port: u16,
    ) -> Result<CalandragemStatus, String> {
        {
            let guard = self.running.lock().unwrap();
            if let Some((p, _)) = *guard {
                return Ok(CalandragemStatus {
                    rodando: true,
                    porta: p,
                    link: format!("http://{}:{p}", ip_local()),
                });
            }
        }

        let listener = tokio::net::TcpListener::bind(("0.0.0.0", porta))
            .await
            .map_err(|e| format!("Não foi possível ligar Calandragem na porta {porta}: {e}"))?;

        let (stop_tx, mut stop_rx) = watch::channel(false);
        let html_pronto = Arc::new(
            CALANDRAGEM_HTML.replace("__WS_PORT__", &notepad_ws_port.to_string()),
        );

        let router = Router::new()
            .route(
                "/",
                get({
                    let h = html_pronto.clone();
                    move || async move { Html((*h).clone()) }
                }),
            )
            .route(
                "/calandragem.html",
                get({
                    let h = html_pronto;
                    move || async move { Html((*h).clone()) }
                }),
            );

        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = stop_rx.changed().await;
                })
                .await;
        });

        *self.running.lock().unwrap() = Some((porta, stop_tx));
        let st = CalandragemStatus {
            rodando: true,
            porta,
            link: format!("http://{}:{porta}", ip_local()),
        };
        let _ = app.emit("calandragem-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> CalandragemStatus {
        if let Some((_, stop_tx)) = self.running.lock().unwrap().take() {
            let _ = stop_tx.send(true);
        }
        let st = CalandragemStatus {
            rodando: false,
            porta: 0,
            link: String::new(),
        };
        let _ = app.emit("calandragem-status", st.clone());
        st
    }

    pub fn status(&self) -> CalandragemStatus {
        let guard = self.running.lock().unwrap();
        if let Some((porta, _)) = *guard {
            CalandragemStatus {
                rodando: true,
                porta,
                link: format!("http://{}:{porta}", ip_local()),
            }
        } else {
            CalandragemStatus {
                rodando: false,
                porta: 0,
                link: String::new(),
            }
        }
    }
}
