use crate::core::imaging::{blit_rgb_fast, resize_rgb_simd, wait_until_stable};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeDelta};
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

static RE_PDF: OnceLock<Regex> = OnceLock::new();
static RE_IMG_A: OnceLock<Regex> = OnceLock::new();
static RE_IMG_B: OnceLock<Regex> = OnceLock::new();

fn chave_pdf(arq: &Path) -> Option<NaiveDateTime> {
    let re = RE_PDF.get_or_init(|| {
        Regex::new(r"(\d{2})[-_.]?(\d{2})[-_.]?(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})").unwrap()
    });
    let stem = arq.file_stem()?.to_str()?;
    let caps = re.captures(stem)?;
    let d: u32 = caps[1].parse().ok()?;
    let m: u32 = caps[2].parse().ok()?;
    let y: i32 = caps[3].parse().ok()?;
    let hh: u32 = caps[4].parse().ok()?;
    let mm: u32 = caps[5].parse().ok()?;
    NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(hh, mm, 0)
}

fn chave_img(arq: &Path) -> Option<NaiveDateTime> {
    let stem = arq.file_stem()?.to_str()?;

    // Formato WhatsApp padrão (ex: "WhatsApp Image 2026-11-22 at 15.30.25")
    let re_a = RE_IMG_A.get_or_init(|| {
        Regex::new(r"(\d{4})-(\d{2})-(\d{2})[ _a-zA-Z]+(\d{2})[.:_-](\d{2})[.:_-](\d{2})")
            .unwrap()
    });
    if let Some(caps) = re_a.captures(stem) {
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

    // Formato compacto (ex: "20261122_153025" ou "2026-11-22_153025")
    let re_b = RE_IMG_B.get_or_init(|| {
        Regex::new(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})(\d{2})(\d{2})").unwrap()
    });
    if let Some(caps) = re_b.captures(stem) {
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

    // Fallback: carimbo de modificação do arquivo no disco
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

fn ler_pasta(
    pasta: &Path,
    tolerancia_min: u64,
) -> Result<
    (
        Vec<(NaiveDateTime, PathBuf)>,
        HashMap<NaiveDateTime, Vec<PathBuf>>,
        Vec<PathBuf>,
    ),
    String,
> {
    let mut entries: Vec<PathBuf> = fs::read_dir(pasta)
        .map_err(|e| format!("Erro ao ler pasta: {e}"))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    entries.sort();

    let mut pdfs: Vec<(NaiveDateTime, PathBuf)> = Vec::new();
    let mut soltas: Vec<(NaiveDateTime, PathBuf)> = Vec::new();

    for arq in entries {
        let ext = arq
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "pdf" {
            if let Some(chave) = chave_pdf(&arq) {
                pdfs.push((chave, arq));
            }
        } else if matches!(ext.as_str(), "jpeg" | "jpg" | "png") {
            if let Some(hora) = chave_img(&arq) {
                soltas.push((hora, arq));
            }
        }
    }

    pdfs.sort_by_key(|(k, _)| *k);

    let mut imagens: HashMap<NaiveDateTime, Vec<PathBuf>> = HashMap::new();
    let mut sobrando: Vec<PathBuf> = Vec::new();
    let limite = (tolerancia_min as i64) * 60;

    for (hora, arq) in soltas {
        let melhor = pdfs
            .iter()
            .map(|(p_hora, _)| (distancia_secs(hora, *p_hora), *p_hora))
            .min();
        if let Some((dist, p_hora)) = melhor {
            if dist <= limite {
                imagens.entry(p_hora).or_default().push(arq);
                continue;
            }
        }
        sobrando.push(arq);
    }

    Ok((pdfs, imagens, sobrando))
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

    for (chave, pdf) in &pdfs {
        let mut imgs = imagens.get(chave).cloned().unwrap_or_default();
        imgs.sort();
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

    for (hora, pdf) in &pdfs {
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

        let imgs = imagens.get(hora).cloned().unwrap_or_default();
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
