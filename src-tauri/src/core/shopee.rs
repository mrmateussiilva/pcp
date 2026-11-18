use crate::core::imaging::{blit_rgb_fast, resize_rgb_simd};
use chrono::{NaiveDate, NaiveDateTime, TimeDelta};
use image::codecs::jpeg::JpegEncoder;
use image::{GenericImageView, RgbImage};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
use windows::Storage::StorageFile;

const PASTA_SAIDA: &str = "PRONTOS";
const REGISTRO: &str = "_gerados.json";
const INTERVALO_S: u64 = 3;

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
            run_loop(app.clone(), pasta, opcoes, refazer, true, dummy_stop, counters);
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

fn chave_pdf(arq: &Path) -> Option<NaiveDateTime> {
    let re = Regex::new(r"^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})$").ok()?;
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
    let re = Regex::new(r"(\d{4})-(\d{2})-(\d{2}) at (\d{2})\.(\d{2})\.(\d{2})").ok()?;
    let stem = arq.file_stem()?.to_str()?;
    let caps = re.captures(stem)?;
    let y: i32 = caps[1].parse().ok()?;
    let m: u32 = caps[2].parse().ok()?;
    let d: u32 = caps[3].parse().ok()?;
    let hh: u32 = caps[4].parse().ok()?;
    let mm: u32 = caps[5].parse().ok()?;
    let ss: u32 = caps[6].parse().ok()?;
    NaiveDate::from_ymd_opt(y, m, d)?.and_hms_opt(hh, mm, ss)
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

fn render_pdf_page_winrt(pdf_path: &Path, pagina_1based: u32, dpi: u32) -> Result<(RgbImage, f64, f64, String), String> {
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
    // WinRT PdfPage.Size() retorna em DIPs (96 DPI), mas proporcionalmente 72pt = 96dip
    // Para manter a escala exata de pt -> pixels no DPI alvo:
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

fn fim_do_conteudo_px(img: &RgbImage) -> u32 {
    let (w, h) = img.dimensions();
    let raw = img.as_raw();
    let stride = (w as usize) * 3;
    for y in (0..h).rev() {
        let row = &raw[(y as usize) * stride..(y as usize + 1) * stride];
        for px in row.chunks_exact(3) {
            // Luminância aproximada: se houver qualquer pixel escuro (< 200), achou conteúdo
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
    let (mut page_rgb, _w_pt, _h_pt, aviso) =
        render_pdf_page_winrt(pdf, opcoes.pagina, opcoes.dpi)?;
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

    let mut out_file =
        File::create(destino).map_err(|e| format!("Erro ao criar JPEG de saída: {e}"))?;
    let mut enc = JpegEncoder::new_with_quality(&mut out_file, 95);
    enc.encode_image(&page_rgb)
        .map_err(|e| format!("Erro ao gravar JPEG: {e}"))?;

    Ok(aviso)
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
        emit_log("↻ Registro zerado: gerando todas as fichas novamente.");
        empty
    } else {
        carregar_registro(&arq_registro)
    };

    if !uma_vez {
        emit_log(&format!("Observando fichas Shopee em: {}", pasta.display()));
    }

    let mut vistos: HashMap<String, Vec<(String, u64, u64)>> = HashMap::new();
    let mut falhas: HashMap<String, Vec<(String, u64, u64)>> = HashMap::new();

    while !stop.load(Ordering::Relaxed) {
        let mut pendentes = 0usize;

        let Ok((pdfs, imagens, sobrando)) = ler_pasta(&pasta, opcoes.tolerancia_min) else {
            thread::sleep(Duration::from_secs(INTERVALO_S));
            continue;
        };

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
                " (refeita: mudaram as imagens)"
            } else {
                ""
            };

            match montar(pdf, &imgs, &destino, &opcoes) {
                Ok(aviso) => {
                    registro.insert(pdf_name.clone(), nomes);
                    salvar_registro(&arq_registro, &registro);
                    emit_log(&format!(
                        "✔ {pdf_name}  +  {} imagem(ns){aviso}{refeita_txt}",
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
                emit_log("⚠ Fichas SEM imagem (não foram geradas):");
                for n in sem_imagem_nomes {
                    emit_log(&format!("  - {n}"));
                }
            }
            if !sobrando.is_empty() {
                emit_log("⚠ Imagens SEM ficha correspondente:");
                for s in sobrando {
                    emit_log(&format!(
                        "  - {}",
                        s.file_name().unwrap_or_default().to_string_lossy()
                    ));
                }
            }
            emit_log("🎉 Execução concluída.");
            break;
        }

        thread::sleep(Duration::from_secs(INTERVALO_S));
    }

    if !uma_vez {
        emit_log("Monitor de fichas Shopee parado.");
    }
}
