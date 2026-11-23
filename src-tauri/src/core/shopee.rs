use crate::core::imaging::{blit_rgb_fast, resize_rgb_simd, wait_until_stable};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeDelta, Timelike};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, RgbImage};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
#[cfg(windows)]
use windows::core::HSTRING;
#[cfg(windows)]
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
#[cfg(windows)]
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
#[cfg(windows)]
use windows::Storage::StorageFile;

const PASTA_SAIDA: &str = "PRONTOS";
const REGISTRO: &str = "_gerados.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShopeeOpcoes {
    pub pasta: String,
    #[serde(default = "default_tol")]
    pub tolerancia_min: u64,
    #[serde(default = "default_pag")]
    pub pagina: u32,
    #[serde(default = "default_dpi")]
    pub dpi: u32,
    #[serde(default = "default_margem")]
    pub margem: f64,
    #[serde(default = "default_espaco")]
    pub espaco: f64,
    #[serde(default = "default_layout")]
    pub layout: String,
}

fn default_tol() -> u64 {
    2
}
fn default_pag() -> u32 {
    2
}
fn default_dpi() -> u32 {
    200
}
fn default_margem() -> f64 {
    20.0
}
fn default_espaco() -> f64 {
    8.0
}
fn default_layout() -> String {
    "empilhado".to_string()
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ShopeeCounters {
    pub geradas: usize,
    pub refeitas: usize,
    pub erros: usize,
    pub sem_imagem: usize,
    pub sobrando: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShopeeStatus {
    pub monitorando: bool,
    pub executando: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FichaPareamentoInfo {
    pub pdf_nome: String,
    pub pdf_hora: String,
    pub imagens_pareadas: Vec<String>,
    pub status: String,
    pub destino_jpeg: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShopeeDiagnostico {
    pub total_pdfs: usize,
    pub total_imagens: usize,
    pub pareados: Vec<FichaPareamentoInfo>,
    pub sem_imagem: Vec<String>,
    pub sobrando: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShopeeProntoItem {
    pub nome_arquivo: String,
    pub caminho_jpeg: String,
    pub tamanho_bytes: u64,
    pub modificado_str: String,
    pub largura: u32,
    pub altura: u32,
}

pub struct ShopeeService {
    stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    executando: Arc<AtomicBool>,
    counters: Arc<Mutex<ShopeeCounters>>,
}

impl ShopeeService {
    pub fn new() -> Self {
        Self {
            stop_flag: Mutex::new(None),
            executando: Arc::new(AtomicBool::new(false)),
            counters: Arc::new(Mutex::new(ShopeeCounters::default())),
        }
    }

    pub fn status(&self) -> ShopeeStatus {
        let monitorando = self
            .stop_flag
            .lock()
            .unwrap()
            .as_ref()
            .map(|f| !f.load(Ordering::Relaxed))
            .unwrap_or(false);
        ShopeeStatus {
            monitorando,
            executando: self.executando.load(Ordering::Relaxed),
        }
    }

    pub fn counters(&self) -> ShopeeCounters {
        self.counters.lock().unwrap().clone()
    }

    pub fn reset_counters(&self) {
        let mut c = self.counters.lock().unwrap();
        *c = ShopeeCounters::default();
    }

    pub fn start(
        &self,
        app: AppHandle,
        opcoes: ShopeeOpcoes,
        refazer: bool,
    ) -> Result<ShopeeStatus, String> {
        let pasta = PathBuf::from(opcoes.pasta.trim());
        if !pasta.is_dir() {
            return Err("Selecione uma pasta válida com as fichas da Shopee.".to_string());
        }
        self.stop(&app);

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.lock().unwrap() = Some(stop.clone());
        let counters = self.counters.clone();
        let app_clone = app.clone();

        thread::spawn(move || {
            run_loop(app_clone, pasta, opcoes, refazer, false, stop, counters);
        });

        let st = self.status();
        let _ = app.emit("shopee-status", st.clone());
        Ok(st)
    }

    pub fn stop(&self, app: &AppHandle) -> ShopeeStatus {
        if let Some(flag) = self.stop_flag.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        let st = self.status();
        let _ = app.emit("shopee-status", st.clone());
        st
    }

    pub fn executar_uma_vez(
        &self,
        app: AppHandle,
        opcoes: ShopeeOpcoes,
        refazer: bool,
    ) -> Result<(), String> {
        let pasta = PathBuf::from(opcoes.pasta.trim());
        if !pasta.is_dir() {
            return Err("Selecione uma pasta válida com as fichas da Shopee.".to_string());
        }
        if self.executando.swap(true, Ordering::Relaxed) {
            return Err("Já existe uma execução em andamento.".to_string());
        }
        let _ = app.emit("shopee-status", self.status());
        let exec_ref = self.executando.clone();
        let counters = self.counters.clone();
        let dummy_stop = Arc::new(AtomicBool::new(false));

        thread::spawn(move || {
            run_loop(
                app.clone(),
                pasta,
                opcoes,
                refazer,
                true,
                dummy_stop,
                counters,
            );
            exec_ref.store(false, Ordering::Relaxed);
            let _ = app.emit(
                "shopee-status",
                ShopeeStatus {
                    monitorando: false,
                    executando: false,
                },
            );
        });

        Ok(())
    }
}

static RE_PDF_12: OnceLock<Regex> = OnceLock::new();
static RE_PDF_10: OnceLock<Regex> = OnceLock::new();
static RE_IMG_A: OnceLock<Regex> = OnceLock::new();
static RE_IMG_B: OnceLock<Regex> = OnceLock::new();
static RE_COPY_SUFFIX: OnceLock<Regex> = OnceLock::new();

fn file_mtime_naive(arq: &Path) -> Option<NaiveDateTime> {
    fs::metadata(arq)
        .ok()?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| {
            DateTime::from_timestamp(d.as_secs() as i64, 0)
                .map(|dt| dt.with_timezone(&Local).naive_local())
        })
}

fn file_mtime_ms(arq: &Path) -> u64 {
    fs::metadata(arq)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn strip_copy_suffix(stem: &str) -> &str {
    let re = RE_COPY_SUFFIX.get_or_init(|| Regex::new(r"\s*\(\d+\)\s*$").unwrap());
    if let Some(m) = re.find(stem) {
        &stem[..m.start()]
    } else {
        stem.trim()
    }
}

/// Extrai data/hora do nome do PDF suportando:
/// - `DDMMYYYYHHMM` (ex: `231120260705.pdf` -> 23/11/2026 07:05)
/// - `HHMMDDMMYYYY` (ex: `070723112026.pdf` -> 23/11/2026 07:07)
/// - `YYYYMMDDHHMM` (ex: `202611230705.pdf` -> 23/11/2026 07:05)
/// - `DDMMHHMMYYYY` (ex: `231107052026.pdf` -> 23/11/2026 07:05)
/// - Variantes de 10 dígitos com ano de 2 dígitos (`DDMMYYHHMM` e `HHMMDDMMYY`)
pub fn parse_pdf_stem_datetime(stem_raw: &str, ref_date: NaiveDate) -> Option<NaiveDateTime> {
    let clean = strip_copy_suffix(stem_raw);

    let re12 = RE_PDF_12.get_or_init(|| {
        Regex::new(
            r"(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})",
        )
        .unwrap()
    });

    if let Some(caps) = re12.captures(clean) {
        let p0: u32 = caps[1].parse().ok()?;
        let p1: u32 = caps[2].parse().ok()?;
        let p2: u32 = caps[3].parse().ok()?;
        let p3: u32 = caps[4].parse().ok()?;
        let p4: u32 = caps[5].parse().ok()?;
        let p5: u32 = caps[6].parse().ok()?;

        let mut candidatos: Vec<(u8, NaiveDateTime)> = Vec::new();

        // 1) DDMMYYYYHHMM (padrão principal: 231120260705)
        let y_mid = (p2 * 100 + p3) as i32;
        if (2020..=2035).contains(&y_mid) {
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_mid, p1, p0).and_then(|d| d.and_hms_opt(p4, p5, 0))
            {
                candidatos.push((0, dt));
            }
        }

        // 2) HHMMDDMMYYYY (padrão invertido comum no grupo: 070723112026 -> 07:07 23/11/2026)
        let y_end = (p4 * 100 + p5) as i32;
        if (2020..=2035).contains(&y_end) {
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_end, p3, p2).and_then(|d| d.and_hms_opt(p0, p1, 0))
            {
                candidatos.push((1, dt));
            }
            // 3) DDMMHHMMYYYY
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_end, p1, p0).and_then(|d| d.and_hms_opt(p2, p3, 0))
            {
                candidatos.push((3, dt));
            }
        }

        // 4) YYYYMMDDHHMM (202611230705)
        let y_start = (p0 * 100 + p1) as i32;
        if (2020..=2035).contains(&y_start) {
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_start, p2, p3).and_then(|d| d.and_hms_opt(p4, p5, 0))
            {
                candidatos.push((2, dt));
            }
        }

        if !candidatos.is_empty() {
            candidatos.sort_by_key(|(prio, dt)| {
                let diff_days = (dt.date() - ref_date).num_days().abs();
                (diff_days, *prio)
            });
            return Some(candidatos[0].1);
        }
    }

    // Variantes de 10 dígitos (ano com 2 dígitos, ex: 2311260705 ou 0707231126)
    let re10 = RE_PDF_10.get_or_init(|| {
        Regex::new(r"^(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})[-_.\s]?(\d{2})$")
            .unwrap()
    });
    if let Some(caps) = re10.captures(clean) {
        let p0: u32 = caps[1].parse().ok()?;
        let p1: u32 = caps[2].parse().ok()?;
        let p2: u32 = caps[3].parse().ok()?;
        let p3: u32 = caps[4].parse().ok()?;
        let p4: u32 = caps[5].parse().ok()?;

        let mut candidatos: Vec<(u8, NaiveDateTime)> = Vec::new();
        let y_mid = 2000 + p2 as i32;
        if (2020..=2035).contains(&y_mid) {
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_mid, p1, p0).and_then(|d| d.and_hms_opt(p3, p4, 0))
            {
                candidatos.push((0, dt));
            }
        }
        let y_end = 2000 + p4 as i32;
        if (2020..=2035).contains(&y_end) {
            if let Some(dt) =
                NaiveDate::from_ymd_opt(y_end, p3, p2).and_then(|d| d.and_hms_opt(p0, p1, 0))
            {
                candidatos.push((1, dt));
            }
        }
        if !candidatos.is_empty() {
            candidatos.sort_by_key(|(prio, dt)| {
                let diff_days = (dt.date() - ref_date).num_days().abs();
                (diff_days, *prio)
            });
            return Some(candidatos[0].1);
        }
    }

    None
}

fn chave_pdf(arq: &Path) -> Option<NaiveDateTime> {
    let stem = arq.file_stem()?.to_str()?;
    let mtime = file_mtime_naive(arq);
    let ref_date = mtime
        .map(|dt| dt.date())
        .unwrap_or_else(|| Local::now().date_naive());

    if let Some(dt) = parse_pdf_stem_datetime(stem, ref_date) {
        return Some(dt);
    }

    // Fallback: data de modificação do PDF no disco (truncada para o minuto)
    mtime.and_then(|dt| {
        dt.date()
            .and_hms_opt(dt.time().hour(), dt.time().minute(), 0)
    })
}

pub fn parse_img_stem_datetime(stem_raw: &str, ref_date: NaiveDate) -> Option<NaiveDateTime> {
    // Formato WhatsApp padrão (ex: "WhatsApp Image 2026-11-22 at 15.30.25" ou com "(1)")
    let re_a = RE_IMG_A.get_or_init(|| {
        Regex::new(r"(\d{4})-(\d{2})-(\d{2})[ _a-zA-Z]+(\d{1,2})[.:_-](\d{2})[.:_-](\d{2})")
            .unwrap()
    });
    if let Some(caps) = re_a.captures(stem_raw) {
        let y: i32 = caps[1].parse().ok()?;
        let m: u32 = caps[2].parse().ok()?;
        let d: u32 = caps[3].parse().ok()?;
        let hh: u32 = caps[4].parse().ok()?;
        let mm: u32 = caps[5].parse().ok()?;
        let ss: u32 = caps[6].parse().ok()?;
        if let Some(dt) =
            NaiveDate::from_ymd_opt(y, m, d).and_then(|date| date.and_hms_opt(hh, mm, ss))
        {
            return Some(dt);
        }
    }

    // Formato compacto (ex: "20261122_153025" ou "IMG_20261122_153025")
    let re_b = RE_IMG_B.get_or_init(|| {
        Regex::new(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})").unwrap()
    });
    if let Some(caps) = re_b.captures(stem_raw) {
        let y: i32 = caps[1].parse().ok()?;
        let m: u32 = caps[2].parse().ok()?;
        let d: u32 = caps[3].parse().ok()?;
        let hh: u32 = caps[4].parse().ok()?;
        let mm: u32 = caps[5].parse().ok()?;
        let ss: u32 = caps[6].parse().ok()?;
        if let Some(dt) =
            NaiveDate::from_ymd_opt(y, m, d).and_then(|date| date.and_hms_opt(hh, mm, ss))
        {
            return Some(dt);
        }
    }

    // Caso a imagem tenha sido renomeada no padrão DDMMYYYYHHMM ou HHMMDDMMYYYY
    parse_pdf_stem_datetime(stem_raw, ref_date)
}

fn chave_img(arq: &Path) -> Option<NaiveDateTime> {
    let stem = arq.file_stem()?.to_str()?;
    let mtime = file_mtime_naive(arq);
    let ref_date = mtime
        .map(|dt| dt.date())
        .unwrap_or_else(|| Local::now().date_naive());

    if let Some(dt) = parse_img_stem_datetime(stem, ref_date) {
        return Some(dt);
    }

    mtime
}

/// Distância bruta em segundos entre o horário da foto e o minuto `[hora_pdf, hora_pdf + 59s]`.
fn distancia_secs(hora_img: NaiveDateTime, hora_pdf: NaiveDateTime) -> i64 {
    if hora_img < hora_pdf {
        (hora_pdf - hora_img).num_seconds()
    } else {
        let fim = hora_pdf + TimeDelta::seconds(59);
        if hora_img > fim {
            (hora_img - fim).num_seconds()
        } else {
            0
        }
    }
}

/// Custo direcional para o pareamento ótimo (DP):
/// No fluxo do grupo do WhatsApp, o PDF é enviado primeiro e a(s) foto(s) logo em seguida
/// (mesmo minuto ou nos minutos seguintes). Fotos anteriores ao minuto do PDF recebem
/// penalidade direcional para evitar que um PDF novo "roube" a foto do PDF do minuto anterior.
fn custo_pareamento_direcional(hora_img: NaiveDateTime, hora_pdf: NaiveDateTime) -> i64 {
    if hora_img < hora_pdf {
        let antes = (hora_pdf - hora_img).num_seconds();
        120 + antes * 4
    } else {
        let fim = hora_pdf + TimeDelta::seconds(59);
        if hora_img <= fim {
            (hora_img - hora_pdf).num_seconds() / 2
        } else {
            30 + (hora_img - fim).num_seconds()
        }
    }
}

/// Chave de ordenação natural para nomes de arquivos (ex: `(1)` < `(2)` < `(10)`).
fn natural_sort_key(p: &Path) -> (String, u32) {
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let re = RE_COPY_SUFFIX.get_or_init(|| Regex::new(r"\s*\(\d+\)\s*$").unwrap());
    if let Some(m) = re.find(&stem) {
        let base = stem[..m.start()].to_string();
        let digits: u32 = stem[m.start()..]
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
        (base, digits)
    } else {
        (stem, 0)
    }
}

/// Pareamento monotônico ótimo via Programação Dinâmica:
/// - Prioridade 1: Maximizar a quantidade de PDFs que recebem ao menos 1 foto compatível
///   (impede que um PDF vizinho acumule 2 fotos e deixe outro PDF sem nenhuma).
/// - Prioridade 2: Maximizar a quantidade de fotos compatíveis atribuídas
///   (permite que um PDF receba 2, 3+ fotos quando pertencem ao mesmo pedido).
/// - Prioridade 3: Minimizar o custo direcional de horário entre cada foto e seu PDF.
pub fn parear_monotonic_dp(
    pdf_times: &[NaiveDateTime],
    img_times: &[NaiveDateTime],
    limite_secs: i64,
) -> (Vec<Vec<usize>>, Vec<usize>) {
    let k = pdf_times.len();
    let m = img_times.len();
    if k == 0 {
        return (Vec::new(), (0..m).collect());
    }
    if m == 0 {
        return (vec![Vec::new(); k], Vec::new());
    }

    const INF: i64 = i64::MAX / 4;
    const PENALIDADE_PDF_VAZIO: i64 = 1_000_000;
    const PENALIDADE_IMG_ORFA: i64 = 50_000;
    const CUSTO_FOTO_EXTRA: i64 = 300;

    let stride_i = 2;
    let stride_j = (m + 1) * stride_i;
    let total_states = (k + 1) * stride_j;

    let mut dp = vec![INF; total_states];
    let mut choice = vec![0u8; total_states];
    // choice: 1 = avança PDF (j+1, i, 0), 2 = atribui img i ao PDF j (j, i+1, 1), 3 = pula img i como órfã (j, i+1, has)

    let idx = |j: usize, i: usize, has: usize| -> usize { j * stride_j + i * stride_i + has };

    dp[idx(k, m, 0)] = 0;
    dp[idx(k, m, 1)] = 0;

    for i in (0..m).rev() {
        for has in 0..=1 {
            dp[idx(k, i, has)] = dp[idx(k, i + 1, 0)] + PENALIDADE_IMG_ORFA;
            choice[idx(k, i, has)] = 3;
        }
    }

    for j in (0..k).rev() {
        for i in (0..=m).rev() {
            // Calculamos has=1 primeiro pois has=0 pode transicionar para (j, i+1, 1), que já está resolvido
            for &has in &[1usize, 0usize] {
                let mut best_cost = INF;
                let mut best_act = 1u8;

                // Ação 1: Encerrar PDF j e ir para j + 1
                let pen_pdf = if has == 1 { 0 } else { PENALIDADE_PDF_VAZIO };
                let c1 = dp[idx(j + 1, i, 0)].saturating_add(pen_pdf);
                if c1 < best_cost {
                    best_cost = c1;
                    best_act = 1;
                }

                if i < m {
                    // Ação 2: Atribuir imagem i ao PDF j (se estiver dentro do limite de tolerância)
                    let dist = distancia_secs(img_times[i], pdf_times[j]);
                    if dist <= limite_secs {
                        let extra = if has == 1 { CUSTO_FOTO_EXTRA } else { 0 };
                        let c_pair = custo_pareamento_direcional(img_times[i], pdf_times[j]) + extra;
                        let c2 = dp[idx(j, i + 1, 1)].saturating_add(c_pair);
                        if c2 < best_cost {
                            best_cost = c2;
                            best_act = 2;
                        }
                    }

                    // Ação 3: Pular imagem i como órfã
                    let c3 = dp[idx(j, i + 1, has)].saturating_add(PENALIDADE_IMG_ORFA);
                    if c3 < best_cost {
                        best_cost = c3;
                        best_act = 3;
                    }
                }

                dp[idx(j, i, has)] = best_cost;
                choice[idx(j, i, has)] = best_act;
            }
        }
    }

    let mut atribuicoes: Vec<Vec<usize>> = vec![Vec::new(); k];
    let mut orfas: Vec<usize> = Vec::new();
    let mut j = 0usize;
    let mut i = 0usize;
    let mut has = 0usize;

    while j < k || i < m {
        if j == k {
            orfas.push(i);
            i += 1;
            continue;
        }
        match choice[idx(j, i, has)] {
            1 => {
                j += 1;
                has = 0;
            }
            2 => {
                atribuicoes[j].push(i);
                i += 1;
                has = 1;
            }
            _ => {
                orfas.push(i);
                i += 1;
            }
        }
    }

    (atribuicoes, orfas)
}

fn ler_pasta(
    pasta: &Path,
    tolerancia_min: u64,
) -> Result<
    (
        Vec<(NaiveDateTime, PathBuf)>,
        Vec<Vec<PathBuf>>,
        Vec<PathBuf>,
    ),
    String,
> {
    let entries: Vec<PathBuf> = fs::read_dir(pasta)
        .map_err(|e| format!("Erro ao ler pasta: {e}"))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();

    let mut pdfs_raw: Vec<(NaiveDateTime, u64, PathBuf)> = Vec::new();
    let mut soltas_raw: Vec<(NaiveDateTime, u64, PathBuf)> = Vec::new();

    for arq in entries {
        let ext = arq
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "pdf" {
            if let Some(chave) = chave_pdf(&arq) {
                pdfs_raw.push((chave, file_mtime_ms(&arq), arq));
            }
        } else if matches!(ext.as_str(), "jpeg" | "jpg" | "png") {
            if let Some(hora) = chave_img(&arq) {
                soltas_raw.push((hora, file_mtime_ms(&arq), arq));
            }
        }
    }

    pdfs_raw.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| natural_sort_key(&a.2).cmp(&natural_sort_key(&b.2)))
            .then_with(|| a.1.cmp(&b.1))
    });

    soltas_raw.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| natural_sort_key(&a.2).cmp(&natural_sort_key(&b.2)))
            .then_with(|| a.1.cmp(&b.1))
    });

    let pdf_times: Vec<NaiveDateTime> = pdfs_raw.iter().map(|(t, _, _)| *t).collect();
    let img_times: Vec<NaiveDateTime> = soltas_raw.iter().map(|(t, _, _)| *t).collect();
    let limite = (tolerancia_min.max(1) as i64) * 60;

    // 1ª Passada: pareamento monotônico ótimo dentro da tolerância configurada
    let (mut atrib_idx, mut orfas_idx) = parear_monotonic_dp(&pdf_times, &img_times, limite);

    // 2ª Passada (Fallback Inteligente para sobras):
    // Se sobraram PDFs sem imagem E fotos órfãs na pasta:
    // - Se só existe 1 PDF na pasta inteira e ele ficou sem foto, casa todas as fotos da pasta com ele.
    // - Caso contrário, tenta casar apenas os PDFs sem imagem restantes com as fotos órfãs restantes
    //   usando uma janela ampliada de mesmo turno (até 30 min, ou mesmo dia se sobrou exatamente 1 PDF e 1 foto).
    let pdfs_sem_img: Vec<usize> = (0..pdfs_raw.len())
        .filter(|&j| atrib_idx[j].is_empty())
        .collect();

    if !pdfs_sem_img.is_empty() && !orfas_idx.is_empty() {
        if pdfs_raw.len() == 1 {
            atrib_idx[0] = orfas_idx.clone();
            orfas_idx.clear();
        } else {
            let sub_pdf_times: Vec<NaiveDateTime> =
                pdfs_sem_img.iter().map(|&j| pdf_times[j]).collect();
            let sub_img_times: Vec<NaiveDateTime> =
                orfas_idx.iter().map(|&i| img_times[i]).collect();

            let janela_fallback = if pdfs_sem_img.len() == 1 && orfas_idx.len() == 1 {
                12 * 3600 // 1 PDF restante + 1 foto restante no mesmo dia: casa automaticamente
            } else {
                (tolerancia_min.max(30) as i64) * 60 // até 30 minutos para sobras isoladas
            };

            let (sub_atrib, sub_orfas) =
                parear_monotonic_dp(&sub_pdf_times, &sub_img_times, janela_fallback);

            for (sub_j, img_sub_list) in sub_atrib.into_iter().enumerate() {
                let real_pdf_j = pdfs_sem_img[sub_j];
                for sub_i in img_sub_list {
                    atrib_idx[real_pdf_j].push(orfas_idx[sub_i]);
                }
            }
            orfas_idx = sub_orfas.into_iter().map(|sub_i| orfas_idx[sub_i]).collect();
        }
    }

    let pdfs: Vec<(NaiveDateTime, PathBuf)> = pdfs_raw
        .into_iter()
        .map(|(t, _, p)| (t, p))
        .collect();

    let imagens_por_pdf: Vec<Vec<PathBuf>> = atrib_idx
        .into_iter()
        .map(|indices| {
            indices
                .into_iter()
                .map(|i| soltas_raw[i].2.clone())
                .collect()
        })
        .collect();

    let sobrando: Vec<PathBuf> = orfas_idx
        .into_iter()
        .map(|i| soltas_raw[i].2.clone())
        .collect();

    Ok((pdfs, imagens_por_pdf, sobrando))
}

fn assinatura(arquivos: &[PathBuf]) -> Result<Vec<(String, u64, u64)>, String> {
    let mut partes = Vec::with_capacity(arquivos.len());
    for a in arquivos {
        let meta = fs::metadata(a).map_err(|e| e.to_string())?;
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let nome = a
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        partes.push((nome, meta.len(), mtime_ms));
    }
    Ok(partes)
}

fn carregar_registro(caminho: &Path) -> HashMap<String, Vec<String>> {
    fs::read_to_string(caminho)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn salvar_registro(caminho: &Path, reg: &HashMap<String, Vec<String>>) {
    if let Ok(json) = serde_json::to_string_pretty(reg) {
        let tmp = caminho.with_extension("json.tmp");
        if fs::write(&tmp, json).is_ok() {
            let _ = fs::rename(&tmp, caminho);
        }
    }
}

#[cfg(windows)]
fn render_pdf_page(
    pdf_path: &Path,
    pagina_1based: u32,
    dpi: u32,
) -> Result<(RgbImage, f64, f64, String), String> {
    let abs_path = fs::canonicalize(pdf_path).unwrap_or_else(|_| pdf_path.to_path_buf());
    let path_str = abs_path.to_string_lossy();
    let clean_path = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str);

    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(clean_path))
        .map_err(|e| format!("Erro StorageFile: {e}"))?
        .join()
        .map_err(|e| format!("Erro ao abrir PDF: {e}"))?;

    let doc = PdfDocument::LoadFromFileAsync(&file)
        .map_err(|e| format!("Erro PdfDocument: {e}"))?
        .join()
        .map_err(|e| format!("Erro ao carregar PDF: {e}"))?;

    let count = doc.PageCount().map_err(|e| format!("Erro PageCount: {e}"))?;
    if count == 0 {
        return Err("PDF sem páginas.".to_string());
    }

    let mut idx = pagina_1based.saturating_sub(1);
    let mut aviso = String::new();
    if idx >= count {
        idx = count - 1;
        aviso = format!(" (ATENÇÃO: PDF só tem {count} página(s), usei a última)");
    }

    let page = doc.GetPage(idx).map_err(|e| format!("Erro GetPage: {e}"))?;
    let size = page.Size().map_err(|e| format!("Erro Page Size: {e}"))?;

    let w_pt = (size.Width as f64) * 72.0 / 96.0;
    let h_pt = (size.Height as f64) * 72.0 / 96.0;

    let dest_w = ((w_pt * dpi as f64) / 72.0).round().max(1.0) as u32;
    let dest_h = ((h_pt * dpi as f64) / 72.0).round().max(1.0) as u32;

    let opts = PdfPageRenderOptions::new().map_err(|e| format!("Erro RenderOptions: {e}"))?;
    opts.SetDestinationWidth(dest_w)
        .map_err(|e| format!("Erro SetDestinationWidth: {e}"))?;
    opts.SetDestinationHeight(dest_h)
        .map_err(|e| format!("Erro SetDestinationHeight: {e}"))?;

    let stream = InMemoryRandomAccessStream::new().map_err(|e| format!("Erro Stream: {e}"))?;
    page.RenderWithOptionsToStreamAsync(&stream, &opts)
        .map_err(|e| format!("Erro RenderAsync: {e}"))?
        .join()
        .map_err(|e| format!("Erro ao renderizar página PDF: {e}"))?;

    let stream_size = stream.Size().map_err(|e| format!("Erro Stream Size: {e}"))? as u32;
    let input_stream = stream
        .GetInputStreamAt(0)
        .map_err(|e| format!("Erro InputStream: {e}"))?;
    let reader = DataReader::CreateDataReader(&input_stream)
        .map_err(|e| format!("Erro DataReader: {e}"))?;
    reader
        .LoadAsync(stream_size)
        .map_err(|e| format!("Erro LoadAsync: {e}"))?
        .join()
        .map_err(|e| format!("Erro leitura bytes PDF: {e}"))?;

    let mut bytes = vec![0u8; stream_size as usize];
    reader
        .ReadBytes(&mut bytes)
        .map_err(|e| format!("Erro ReadBytes: {e}"))?;

    let rgb = image::load_from_memory(&bytes)
        .map_err(|e| format!("Erro ao decodificar página renderizada: {e}"))?
        .to_rgb8();

    Ok((rgb, w_pt, h_pt, aviso))
}

#[cfg(not(windows))]
fn render_pdf_page(
    pdf_path: &Path,
    pagina_1based: u32,
    dpi: u32,
) -> Result<(RgbImage, f64, f64, String), String> {
    use std::process::Command;

    let pag = pagina_1based.max(1).to_string();
    let dpi_str = dpi.to_string();
    let out = Command::new("pdftoppm")
        .args(["-png", "-r", &dpi_str, "-f", &pag, "-l", &pag])
        .arg(pdf_path)
        .output()
        .map_err(|e| {
            format!("Renderização de PDF no Linux requer 'pdftoppm' (poppler-utils): {e}")
        })?;

    if !out.status.success() || out.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "Erro ao renderizar página {pag} do PDF via pdftoppm: {}",
            stderr.trim()
        ));
    }

    let rgb = image::load_from_memory(&out.stdout)
        .map_err(|e| format!("Erro ao decodificar PNG do pdftoppm: {e}"))?
        .to_rgb8();

    let (w, h) = rgb.dimensions();
    let w_pt = (w as f64) * 72.0 / (dpi as f64);
    let h_pt = (h as f64) * 72.0 / (dpi as f64);

    Ok((rgb, w_pt, h_pt, String::new()))
}

fn fim_do_conteudo_px(img: &RgbImage) -> u32 {
    let (w, h) = img.dimensions();
    let raw = img.as_raw();
    let stride = (w as usize) * 3;
    for y in (0..h).rev() {
        let row = &raw[(y as usize) * stride..(y as usize + 1) * stride];
        for px in row.chunks_exact(3) {
            let lum = (px[0] as u32 * 299 + px[1] as u32 * 587 + px[2] as u32 * 114) / 1000;
            if lum < 200 {
                return y + 1;
            }
        }
    }
    0
}

fn montar(
    pdf: &Path,
    imagens: &[PathBuf],
    destino: &Path,
    opcoes: &ShopeeOpcoes,
) -> Result<String, String> {
    let (mut page_rgb, _w_pt, _h_pt, aviso) = render_pdf_page(pdf, opcoes.pagina, opcoes.dpi)?;
    let (pw, ph) = page_rgb.dimensions();

    let scale = opcoes.dpi as f64 / 72.0;
    let margem_px = opcoes.margem * scale;
    let espaco_px = opcoes.espaco * scale;

    let topo = fim_do_conteudo_px(&page_rgb) as f64 + espaco_px;
    let x0_area = margem_px;
    let x1_area = (pw as f64) - margem_px;
    let y0_area = topo;
    let y1_area = (ph as f64) - margem_px;

    let area_w = x1_area - x0_area;
    let area_h = y1_area - y0_area;

    if area_h < 60.0 * scale || area_w <= 10.0 {
        return Err("não há espaço em branco suficiente na página".to_string());
    }

    let n = imagens.len() as f64;
    let lado_a_lado = opcoes.layout == "lado_a_lado";

    for (i, img_path) in imagens.iter().enumerate() {
        let img = image::ImageReader::open(img_path)
            .map_err(|e| format!("Erro ao abrir imagem: {e}"))?
            .with_guessed_format()
            .map_err(|e| format!("Formato inválido: {e}"))?
            .decode()
            .map_err(|e| format!("Erro ao decodificar imagem: {e}"))?;
        let (iw, ih) = img.dimensions();
        if iw == 0 || ih == 0 {
            continue;
        }

        let (bx0, by0, bw, bh) = if lado_a_lado {
            let w = (area_w - espaco_px * (n - 1.0)) / n;
            let x0 = x0_area + (i as f64) * (w + espaco_px);
            (x0, y0_area, w, area_h)
        } else {
            let h = (area_h - espaco_px * (n - 1.0)) / n;
            let y1 = y1_area - (i as f64) * (h + espaco_px);
            (x0_area, y1 - h, area_w, h)
        };

        let fator = (bw / iw as f64).min(bh / ih as f64);
        let tw = ((iw as f64) * fator).round().max(1.0) as u32;
        let th = ((ih as f64) * fator).round().max(1.0) as u32;
        let dest_x = (bx0 + (bw - tw as f64) / 2.0).round().max(0.0) as u32;
        let dest_y = ((by0 + bh) - th as f64).round().max(0.0) as u32;

        let resized = resize_rgb_simd(&img.to_rgb8(), tw, th);
        blit_rgb_fast(&mut page_rgb, &resized, dest_x, dest_y);
    }

    let out_file =
        File::create(destino).map_err(|e| format!("Erro ao criar JPEG de saída: {e}"))?;
    let mut writer = BufWriter::with_capacity(256 * 1024, out_file);
    let mut enc = JpegEncoder::new_with_quality(&mut writer, 95);
    enc.encode_image(&page_rgb)
        .map_err(|e| format!("Erro ao gravar JPEG: {e}"))?;

    Ok(aviso)
}

fn processar_fichas_passo(
    app: &AppHandle,
    pasta: &Path,
    saida: &Path,
    arq_registro: &Path,
    opcoes: &ShopeeOpcoes,
    uma_vez: bool,
    registro: &mut HashMap<String, Vec<String>>,
    vistos: &mut HashMap<String, Vec<(String, u64, u64)>>,
    falhas: &mut HashMap<String, Vec<(String, u64, u64)>>,
    counters: &Arc<Mutex<ShopeeCounters>>,
) -> usize {
    let emit_log = |msg: &str| {
        let _ = app.emit("shopee-log", msg.to_string());
    };

    let Ok((pdfs, imagens, sobrando)) = ler_pasta(pasta, opcoes.tolerancia_min) else {
        return 0;
    };

    let mut pendentes = 0usize;
    let mut sem_imagem_nomes = Vec::new();

    for (idx, (_chave, pdf)) in pdfs.iter().enumerate() {
        let imgs = imagens.get(idx).cloned().unwrap_or_default();
        if imgs.is_empty() {
            sem_imagem_nomes.push(
                pdf.file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            );
            continue;
        }

        let pdf_name = pdf
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let pdf_stem = pdf
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let destino = saida.join(format!("{pdf_stem}.jpg"));

        let nomes: Vec<String> = imgs
            .iter()
            .map(|i| {
                i.file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default()
            })
            .collect();

        if destino.exists() && registro.get(&pdf_name) == Some(&nomes) {
            continue;
        }

        // Aguarda estabilizar PDF e imagens
        if !wait_until_stable(pdf, 0.2, 3.0) {
            pendentes += 1;
            continue;
        }
        for img_p in &imgs {
            if !wait_until_stable(img_p, 0.2, 3.0) {
                pendentes += 1;
                continue;
            }
        }

        let mut todos = vec![pdf.clone()];
        todos.extend(imgs.iter().cloned());
        let Ok(sig) = assinatura(&todos) else {
            continue;
        };

        if falhas.get(&pdf_name) == Some(&sig) {
            continue;
        }

        if !uma_vez && vistos.get(&pdf_name) != Some(&sig) {
            vistos.insert(pdf_name, sig);
            pendentes += 1;
            continue;
        }

        let ja_existia = registro.contains_key(&pdf_name);
        let refeita_txt = if ja_existia {
            " (refeita: imagens atualizadas)"
        } else {
            ""
        };

        match montar(pdf, &imgs, &destino, opcoes) {
            Ok(aviso) => {
                registro.insert(pdf_name.clone(), nomes);
                salvar_registro(arq_registro, registro);
                emit_log(&format!(
                    "✔ {pdf_name} + {} imagem(ns){aviso}{refeita_txt}",
                    imgs.len()
                ));
                let mut c = counters.lock().unwrap();
                if ja_existia {
                    c.refeitas += 1;
                } else {
                    c.geradas += 1;
                }
            }
            Err(e) => {
                falhas.insert(pdf_name.clone(), sig);
                emit_log(&format!("✘ ERRO {pdf_name}: {e}"));
                counters.lock().unwrap().erros += 1;
            }
        }
    }

    {
        let mut c = counters.lock().unwrap();
        c.sem_imagem = sem_imagem_nomes.len();
        c.sobrando = sobrando.len();
        let _ = app.emit("shopee-counters", c.clone());
    }

    if uma_vez && pendentes == 0 {
        if !sem_imagem_nomes.is_empty() {
            emit_log("⚠ Fichas SEM imagem pareada (aguardando fotos):");
            for n in sem_imagem_nomes {
                emit_log(&format!("  • {n}"));
            }
        }
        if !sobrando.is_empty() {
            emit_log("⚠ Fotos SEM ficha correspondente (órfãs):");
            for s in sobrando {
                emit_log(&format!(
                    "  • {}",
                    s.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
        }
        emit_log("🎉 Processamento concluído.");
    }

    pendentes
}

fn run_loop(
    app: AppHandle,
    pasta: PathBuf,
    opcoes: ShopeeOpcoes,
    refazer: bool,
    uma_vez: bool,
    stop: Arc<AtomicBool>,
    counters: Arc<Mutex<ShopeeCounters>>,
) {
    let emit_log = |msg: &str| {
        let _ = app.emit("shopee-log", msg.to_string());
    };

    let saida = pasta.join(PASTA_SAIDA);
    if let Err(e) = fs::create_dir_all(&saida) {
        emit_log(&format!("✘ Erro ao criar pasta {PASTA_SAIDA}: {e}"));
        return;
    }
    let arq_registro = saida.join(REGISTRO);

    let mut registro = if refazer {
        let empty = HashMap::new();
        salvar_registro(&arq_registro, &empty);
        emit_log("↻ Cache zerado: refazendo todas as fichas da pasta.");
        empty
    } else {
        carregar_registro(&arq_registro)
    };

    if !uma_vez {
        emit_log(&format!(
            "Watcher reativo Shopee ativo em: {}",
            pasta.display()
        ));
    }

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let _watcher = if !uma_vez {
        RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        )
        .and_then(|mut w| {
            w.watch(&pasta, RecursiveMode::NonRecursive)?;
            Ok(w)
        })
        .ok()
    } else {
        None
    };

    let mut vistos: HashMap<String, Vec<(String, u64, u64)>> = HashMap::new();
    let mut falhas: HashMap<String, Vec<(String, u64, u64)>> = HashMap::new();

    // Primeira passada imediata
    let pendentes = processar_fichas_passo(
        &app,
        &pasta,
        &saida,
        &arq_registro,
        &opcoes,
        uma_vez,
        &mut registro,
        &mut vistos,
        &mut falhas,
        &counters,
    );

    if uma_vez && pendentes == 0 {
        return;
    }

    while !stop.load(Ordering::Relaxed) {
        if let Some(_w) = &_watcher {
            // Reativo com notify
            match rx.recv_timeout(Duration::from_millis(1000)) {
                Ok(Ok(_)) => {
                    while rx.try_recv().is_ok() {}
                    if !stop.load(Ordering::Relaxed) {
                        processar_fichas_passo(
                            &app,
                            &pasta,
                            &saida,
                            &arq_registro,
                            &opcoes,
                            uma_vez,
                            &mut registro,
                            &mut vistos,
                            &mut falhas,
                            &counters,
                        );
                    }
                }
                Ok(Err(_)) | Err(_) => {
                    // Timeout normal
                }
            }
        } else {
            // Modo uma vez com pendentes
            thread::sleep(Duration::from_secs(1));
            let rem = processar_fichas_passo(
                &app,
                &pasta,
                &saida,
                &arq_registro,
                &opcoes,
                uma_vez,
                &mut registro,
                &mut vistos,
                &mut falhas,
                &counters,
            );
            if rem == 0 {
                break;
            }
        }
    }

    if !uma_vez {
        emit_log("Watcher de fichas Shopee parado.");
    }
}

pub fn obter_diagnostico(pasta: &Path, tolerancia_min: u64) -> Result<ShopeeDiagnostico, String> {
    let (pdfs, imagens, sobrando) = ler_pasta(pasta, tolerancia_min)?;
    let mut pareados = Vec::new();
    let mut sem_imagem = Vec::new();

    let saida = pasta.join(PASTA_SAIDA);

    for (idx, (hora, pdf)) in pdfs.iter().enumerate() {
        let pdf_nome = pdf
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let pdf_stem = pdf
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let destino_jpg = saida.join(format!("{pdf_stem}.jpg"));

        let imgs = imagens.get(idx).cloned().unwrap_or_default();
        if imgs.is_empty() {
            sem_imagem.push(pdf_nome);
        } else {
            let img_nomes: Vec<String> = imgs
                .iter()
                .map(|p| {
                    p.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect();
            pareados.push(FichaPareamentoInfo {
                pdf_nome,
                pdf_hora: hora.format("%d/%m %H:%M").to_string(),
                imagens_pareadas: img_nomes,
                status: if destino_jpg.exists() {
                    "pronto".to_string()
                } else {
                    "pendente".to_string()
                },
                destino_jpeg: if destino_jpg.exists() {
                    Some(destino_jpg.to_string_lossy().into_owned())
                } else {
                    None
                },
            });
        }
    }

    let sobrando_nomes: Vec<String> = sobrando
        .iter()
        .map(|p| {
            p.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        })
        .collect();

    let total_imgs =
        pareados.iter().map(|p| p.imagens_pareadas.len()).sum::<usize>() + sobrando.len();

    Ok(ShopeeDiagnostico {
        total_pdfs: pdfs.len(),
        total_imagens: total_imgs,
        pareados,
        sem_imagem,
        sobrando: sobrando_nomes,
    })
}

pub fn listar_prontos(pasta: &Path, limite: usize) -> Vec<ShopeeProntoItem> {
    let saida = pasta.join(PASTA_SAIDA);
    if !saida.is_dir() {
        return Vec::new();
    }

    let mut arquivos = Vec::new();
    if let Ok(entries) = fs::read_dir(&saida) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                    let low = ext.to_lowercase();
                    if low == "jpg" || low == "jpeg" {
                        if let Ok(meta) = fs::metadata(&p) {
                            let ts = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);
                            arquivos.push((p, meta.len(), ts));
                        }
                    }
                }
            }
        }
    }

    arquivos.sort_by(|a, b| b.2.cmp(&a.2));

    arquivos
        .into_iter()
        .take(limite)
        .map(|(p, tamanho_bytes, ts)| {
            let nome_arquivo = p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let (largura, altura) = image::image_dimensions(&p).unwrap_or((0, 0));
            let dt = DateTime::from_timestamp(ts as i64, 0)
                .map(|d| d.with_timezone(&Local).format("%d/%m %H:%M").to_string())
                .unwrap_or_else(|| "—".to_string());

            ShopeeProntoItem {
                nome_arquivo,
                caminho_jpeg: p.to_string_lossy().into_owned(),
                tamanho_bytes,
                modificado_str: dt,
                largura,
                altura,
            }
        })
        .collect()
}

pub fn carregar_miniatura_base64(caminho_jpeg: &Path) -> Result<String, String> {
    if !caminho_jpeg.is_file() {
        return Err("Arquivo não encontrado.".to_string());
    }
    let img = image::open(caminho_jpeg).map_err(|e| format!("Erro ao abrir imagem: {e}"))?;
    let (w, h) = img.dimensions();
    let (dest_w, dest_h) = if w >= h {
        (
            480,
            ((h as f64 * 480.0) / w.max(1) as f64)
                .round()
                .max(1.0) as u32,
        )
    } else {
        (
            ((w as f64 * 480.0) / h.max(1) as f64)
                .round()
                .max(1.0) as u32,
            480,
        )
    };

    let resized = resize_rgb_simd(&img.to_rgb8(), dest_w, dest_h);
    let mut buf = std::io::Cursor::new(Vec::with_capacity(32 * 1024));
    let mut enc = JpegEncoder::new_with_quality(&mut buf, 80);
    enc.encode_image(&DynamicImage::ImageRgb8(resized))
        .map_err(|e| format!("Erro ao codificar JPEG: {e}"))?;

    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let b64 = STANDARD.encode(buf.into_inner());
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(y: i32, m: u32, d: u32, hh: u32, mm: u32, ss: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(hh, mm, ss)
            .unwrap()
    }

    #[test]
    fn test_parse_pdf_stem_formats() {
        let ref_date = NaiveDate::from_ymd_opt(2026, 11, 23).unwrap();

        // Print 1: 231120260705.pdf (DDMMYYYYHHMM)
        assert_eq!(
            parse_pdf_stem_datetime("231120260705", ref_date),
            Some(dt(2026, 11, 23, 7, 5, 0))
        );
        // Print 2a: 231120260706.pdf (DDMMYYYYHHMM)
        assert_eq!(
            parse_pdf_stem_datetime("231120260706", ref_date),
            Some(dt(2026, 11, 23, 7, 6, 0))
        );
        // Print 2b: 070723112026.pdf (HHMMDDMMYYYY - invertido!)
        assert_eq!(
            parse_pdf_stem_datetime("070723112026", ref_date),
            Some(dt(2026, 11, 23, 7, 7, 0))
        );
        // Print 3: 181120260716.pdf
        let ref_18 = NaiveDate::from_ymd_opt(2026, 11, 18).unwrap();
        assert_eq!(
            parse_pdf_stem_datetime("181120260716", ref_18),
            Some(dt(2026, 11, 18, 7, 16, 0))
        );
        // Com sufixo de cópia do Windows "(1)"
        assert_eq!(
            parse_pdf_stem_datetime("070723112026 (1)", ref_date),
            Some(dt(2026, 11, 23, 7, 7, 0))
        );
    }

    #[test]
    fn test_parear_prints_whatsapp() {
        let limite = 2 * 60; // 2 minutos

        // Cenário real dos Prints 1 e 2 juntos:
        // PDF 1 (07:05) -> Foto 1 enviada às 07:06:10 (toalhas)
        // PDF 2 (07:06) -> Foto 2 enviada às 07:07:05 (mostarda)
        // PDF 3 (07:07) -> Foto 3 enviada às 07:07:45 (sued)
        let pdfs = vec![
            dt(2026, 11, 23, 7, 5, 0),
            dt(2026, 11, 23, 7, 6, 0),
            dt(2026, 11, 23, 7, 7, 0),
        ];
        let imgs = vec![
            dt(2026, 11, 23, 7, 6, 10),
            dt(2026, 11, 23, 7, 7, 5),
            dt(2026, 11, 23, 7, 7, 45),
        ];

        let (atrib, orfas) = parear_monotonic_dp(&pdfs, &imgs, limite);
        assert!(orfas.is_empty());
        assert_eq!(atrib[0], vec![0]); // PDF 07:05 -> Foto 07:06:10
        assert_eq!(atrib[1], vec![1]); // PDF 07:06 -> Foto 07:07:05
        assert_eq!(atrib[2], vec![2]); // PDF 07:07 -> Foto 07:07:45

        // Cenário do Print 3: 1 PDF (07:16) com 2 fotos (07:16:30 e 07:17:10)
        let pdfs_p3 = vec![dt(2026, 11, 18, 7, 16, 0)];
        let imgs_p3 = vec![
            dt(2026, 11, 18, 7, 16, 30),
            dt(2026, 11, 18, 7, 17, 10),
        ];
        let (atrib_p3, orfas_p3) = parear_monotonic_dp(&pdfs_p3, &imgs_p3, limite);
        assert!(orfas_p3.is_empty());
        assert_eq!(atrib_p3[0], vec![0, 1]);
    }
}
