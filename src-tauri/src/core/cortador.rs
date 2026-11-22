use crate::core::imaging::{
    add_1px_black_border_inside_inplace, blit_rgb_fast, draw_text_rgb, load_image_with_meta,
    load_system_font_bytes, measure_text_px, parse_hex_color, paste_rgba_onto_rgb, px_to_cm,
    read_image_dimensions_and_dpi, resize_rgba_simd, rotate270_rgb_fast, rotate90_rgb_fast,
    save_image_with_meta,
};
use image::{imageops, DynamicImage, Rgb, RgbImage, RgbaImage};
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

static RE_PLATE: OnceLock<Regex> = OnceLock::new();
static RE_CITY: OnceLock<Regex> = OnceLock::new();

fn get_re_plate() -> &'static Regex {
    RE_PLATE.get_or_init(|| Regex::new(r"(?i) - P\d+$").unwrap())
}

fn get_re_city() -> &'static Regex {
    RE_CITY.get_or_init(|| {
        Regex::new(r"(?i)^\s*(?P<city>.+?)\s*\(\s*L\s*\d+(?:[.,]\d+)?\s*[X×]\s*A\s*\d+(?:[.,]\d+)?\s*\)\s*$").unwrap()
    })
}

const DEFAULT_COLOR_PALETTE: &[(&str, &str)] = &[
    ("preto", "#000000"),
    ("vermelho", "#D50000"),
    ("azul", "#0057D9"),
    ("verde", "#008A00"),
    ("roxo", "#7B1FA2"),
    ("laranja", "#E65100"),
    ("magenta", "#D00070"),
    ("ciano", "#008C95"),
    ("marrom", "#6D3B2F"),
    ("verde-limão", "#5B8C00"),
    ("ouro", "#B88830"),
    ("azul-petróleo", "#105888"),
    ("lilás", "#A888C0"),
    ("verde-floresta", "#106030"),
    ("coral", "#E87068"),
    ("azul-celeste", "#1098F8"),
    ("ameixa", "#883868"),
    ("cinza-oliva", "#909070"),
    ("rosa-orquídea", "#E068C8"),
    ("oliva-escuro", "#585810"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortadorAutoPayload {
    pub pasta: String,
    pub gabarito: String,
    pub saida: String,
    pub medida: f64,
    pub sobreposicao: f64,
    pub pad: f64,
    pub tipo: String,
    pub workers: usize,
    pub cor: String,
    pub inverter: bool,
    pub mover: bool,
    pub cidade: bool,
    pub cidade_cor: String,
    pub cidade_largura: f64,
    pub cidade_altura: f64,
    pub cidade_margem: f64,
    pub overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortadorMedidasPayload {
    pub entrada: String,
    pub saida: String,
    pub gabarito: String,
    pub medidas: Vec<f64>,
    pub sobreposicao: f64,
    pub pad: f64,
    pub tipo: String,
    pub cor: String,
    pub inverter: bool,
    #[serde(default)]
    pub mover: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CortadorProgress {
    pub current: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CortadorDoneSummary {
    pub ok: usize,
    pub err: usize,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CortadorSimItem {
    pub arquivo: String,
    pub largura_cm: f64,
    pub altura_cm: f64,
    pub dpi: f64,
    pub n_placas: usize,
    pub placas_cm: Vec<f64>,
    pub cidade: Option<String>,
    pub erro: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CortadorSimulacao {
    pub total_paineis: usize,
    pub total_placas: usize,
    pub itens: Vec<CortadorSimItem>,
}

pub struct CortadorService {
    rodando: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
}

impl CortadorService {
    pub fn new() -> Self {
        Self {
            rodando: Arc::new(AtomicBool::new(false)),
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn rodando(&self) -> bool {
        self.rodando.load(Ordering::Relaxed)
    }

    pub fn cancelar(&self) {
        if self.rodando.load(Ordering::Relaxed) {
            self.cancel_flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn executar_auto(
        &self,
        app: AppHandle,
        payload: CortadorAutoPayload,
    ) -> Result<(), String> {
        if self.rodando.swap(true, Ordering::Relaxed) {
            return Err("Já existe um corte em andamento.".to_string());
        }
        self.cancel_flag.store(false, Ordering::Relaxed);
        let rodando_ref = self.rodando.clone();
        let cancel_ref = self.cancel_flag.clone();
        let _ = app.emit("cortador-status", true);

        thread::spawn(move || {
            let res = run_auto(&app, &payload, &cancel_ref);
            if let Err(e) = res {
                let _ = app.emit("cortador-log", format!("❌ Erro: {e}"));
                let _ = app.emit(
                    "cortador-done",
                    CortadorDoneSummary {
                        ok: 0,
                        err: 1,
                        cancelled: cancel_ref.load(Ordering::Relaxed),
                    },
                );
            }
            rodando_ref.store(false, Ordering::Relaxed);
            let _ = app.emit("cortador-status", false);
        });

        Ok(())
    }

    pub fn executar_medidas(
        &self,
        app: AppHandle,
        payload: CortadorMedidasPayload,
    ) -> Result<(), String> {
        if self.rodando.swap(true, Ordering::Relaxed) {
            return Err("Já existe um corte em andamento.".to_string());
        }
        self.cancel_flag.store(false, Ordering::Relaxed);
        let rodando_ref = self.rodando.clone();
        let cancel_ref = self.cancel_flag.clone();
        let _ = app.emit("cortador-status", true);

        thread::spawn(move || {
            let res = run_medidas(&app, &payload, &cancel_ref);
            if let Err(e) = res {
                let _ = app.emit("cortador-log", format!("❌ Erro: {e}"));
                let _ = app.emit(
                    "cortador-done",
                    CortadorDoneSummary {
                        ok: 0,
                        err: 1,
                        cancelled: cancel_ref.load(Ordering::Relaxed),
                    },
                );
            }
            rodando_ref.store(false, Ordering::Relaxed);
            let _ = app.emit("cortador-status", false);
        });

        Ok(())
    }
}

fn is_image_ext(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "png" | "jpg" | "jpeg" | "tif" | "tiff"))
            .unwrap_or(false)
}

fn listar_paineis(entrada: &Path, gabarito: &Path) -> Result<Vec<PathBuf>, String> {
    if !entrada.is_dir() {
        return Err(format!("Pasta de entrada inválida: {}", entrada.display()));
    }
    let re_plate = get_re_plate();
    let gab_abs = fs::canonicalize(gabarito).unwrap_or_else(|_| gabarito.to_path_buf());

    let entries = fs::read_dir(entrada).map_err(|e| format!("Erro ao ler pasta de entrada: {e}"))?;
    let mut lista = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if !is_image_ext(&p) {
            continue;
        }
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if re_plate.is_match(&stem) {
            continue;
        }
        if fs::canonicalize(&p).unwrap_or_else(|_| p.clone()) == gab_abs {
            continue;
        }
        lista.push(p);
    }

    lista.sort_by(|a, b| {
        a.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .cmp(
                &b.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
            )
    });
    Ok(lista)
}

fn resolver_cor(nome_ou_hex: &str) -> Rgb<u8> {
    match nome_ou_hex {
        "Preto" | "black" => Rgb([0, 0, 0]),
        "Azul" | "blue" => Rgb([0, 0, 255]),
        "Rosa" | "#FF1493" => Rgb([255, 20, 147]),
        "Roxo" | "purple" => Rgb([128, 0, 128]),
        "Vermelho" | "red" => Rgb([255, 0, 0]),
        "Verde" | "green" => Rgb([0, 128, 0]),
        outro => parse_hex_color(outro),
    }
}

fn extrair_cidade(filename: &str, overrides: &HashMap<String, String>) -> Option<String> {
    let stem = Path::new(filename).file_stem()?.to_string_lossy();
    let caps = get_re_city().captures(&stem)?;
    let raw = caps.name("city")?.as_str().trim().to_uppercase();
    if let Some(ov) = overrides.get(&raw) {
        return Some(ov.to_uppercase());
    }
    Some(raw)
}

fn resize_template(
    template: &DynamicImage,
    tpl_dpi: (f64, f64),
    panel_dpi: (f64, f64),
) -> RgbaImage {
    let nw = ((template.width() as f64) * panel_dpi.0 / tpl_dpi.0)
        .ceil()
        .max(1.0) as u32;
    let nh = ((template.height() as f64) * panel_dpi.1 / tpl_dpi.1)
        .ceil()
        .max(1.0) as u32;
    resize_rgba_simd(&template.to_rgba8(), nw, nh)
}

fn draw_filename_in_padding(
    img: &mut RgbImage,
    font_bytes: Option<&[u8]>,
    name_file: &str,
    pad_x: u32,
    pad_y: u32,
    font_size_max: f32,
    color: Rgb<u8>,
) {
    if name_file.is_empty() || pad_y == 0 {
        return;
    }
    let Some(bytes) = font_bytes else { return };
    let inset_y = ((pad_y / 10).max(1)).min((pad_y.saturating_sub(1)) / 2);
    let avail_w = img.width().saturating_sub(2 * pad_x);
    let avail_h = pad_y.saturating_sub(2 * inset_y);
    if avail_w == 0 || avail_h == 0 {
        return;
    }

    let mut low = 1u32;
    let mut high = font_size_max.round().max(1.0) as u32;
    let mut best: Option<(u32, u32)> = None;

    while low <= high {
        let mid = (low + high) / 2;
        let (tw, th) = measure_text_px(bytes, name_file, mid as f32);
        if tw <= avail_w && th <= avail_h {
            best = Some((mid, th));
            low = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        }
    }

    if let Some((size, th)) = best {
        let padding_top = img.height().saturating_sub(pad_y);
        let text_top = padding_top + pad_y.saturating_sub(th) / 2;
        draw_text_rgb(
            img,
            Some(bytes),
            name_file,
            pad_x as i32,
            text_top as i32,
            size as f32,
            color,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_plate_decorations(
    mut cropped: RgbImage,
    plate_pos: &str,
    number: usize,
    pad_cm: f64,
    name_file: &str,
    template_rgba: &RgbaImage,
    dpi: (f64, f64),
    text_color: Rgb<u8>,
    font_bytes: Option<&[u8]>,
    city_label: Option<(&str, Rgb<u8>, f64, f64, f64)>,
) -> RgbImage {
    add_1px_black_border_inside_inplace(&mut cropped);
    let pad_x = (pad_cm * dpi.0 / 2.54).ceil().max(0.0) as u32;
    let pad_y = (pad_cm * dpi.1 / 2.54).ceil().max(0.0) as u32;

    let bw = cropped.width() + 2 * pad_x;
    let bh = cropped.height() + 2 * pad_y;
    let mut out = RgbImage::from_pixel(bw, bh, Rgb([255, 255, 255]));
    blit_rgb_fast(&mut out, &cropped, pad_x, pad_y);

    if let Some((city, c_color, c_w_cm, c_h_cm, c_margin_cm)) = city_label {
        if let Some(bytes) = font_bytes {
            let max_w = ((c_w_cm * dpi.0 / 2.54).round().max(1.0)) as u32;
            let max_h = ((c_h_cm * dpi.1 / 2.54).round().max(1.0)) as u32;
            let margin_y = ((c_margin_cm * dpi.1 / 2.54).round().max(0.0)) as u32;
            let mut low = 1u32;
            let mut high = max_h;
            let mut best = (12u32, max_w / 2, 12u32);
            while low <= high {
                let mid = (low + high) / 2;
                let (tw, th) = measure_text_px(bytes, city, mid as f32);
                if tw <= max_w && th <= max_h {
                    best = (mid, tw, th);
                    low = mid + 1;
                } else {
                    if mid == 0 {
                        break;
                    }
                    high = mid - 1;
                }
            }
            let cx = out.width().saturating_sub(best.1) / 2;
            let cy = out
                .height()
                .saturating_sub(pad_y + margin_y + best.2);
            draw_text_rgb(&mut out, Some(bytes), city, cx as i32, cy as i32, best.0 as f32, c_color);
        }
    }

    let origin_x = out.width().saturating_sub(pad_x) as i64;
    let font_size = (30.0 * dpi.0 / 72.0).ceil() as f32;

    match plate_pos {
        "single" => {
            // Placa única não possui emenda lateral
        }
        "start" => {
            paste_rgba_onto_rgb(&mut out, template_rgba, origin_x, 0);
            let lbl = format!("{number:02}");
            let lx = out.width().saturating_sub(2 * pad_x) as i32;
            draw_text_rgb(&mut out, font_bytes, &lbl, lx, 0, font_size, text_color);
        }
        "middle" => {
            paste_rgba_onto_rgb(&mut out, template_rgba, 0, 0);
            paste_rgba_onto_rgb(&mut out, template_rgba, origin_x, 0);
            let l1 = format!("{number:02}");
            let l2 = format!("{:02}", number + 1);
            let lx2 = out.width().saturating_sub(2 * pad_x) as i32;
            draw_text_rgb(&mut out, font_bytes, &l1, pad_x as i32, 0, font_size, text_color);
            draw_text_rgb(&mut out, font_bytes, &l2, lx2, 0, font_size, text_color);
        }
        _ => {
            paste_rgba_onto_rgb(&mut out, template_rgba, 0, 0);
            let lbl = format!("{number:02}");
            draw_text_rgb(&mut out, font_bytes, &lbl, pad_x as i32, 0, font_size, text_color);
        }
    }

    draw_filename_in_padding(
        &mut out,
        font_bytes,
        name_file,
        pad_x,
        pad_y,
        font_size,
        text_color,
    );

    out
}

/// Calcula os intervalos `[x0, x1)` em pixels, posição de emenda e número inicial de cada placa.
fn compute_plate_slices(
    pw: u32,
    dpi_x: f64,
    measures_cm: &[f64],
    sobreposicao_cm: f64,
    clamp_last_to_pw: bool,
) -> Vec<(u32, u32, &'static str, usize)> {
    let n_placas = measures_cm.len();
    if n_placas == 0 || pw == 0 {
        return Vec::new();
    }
    if n_placas == 1 {
        let end_px = if clamp_last_to_pw {
            pw
        } else {
            (((measures_cm[0] + sobreposicao_cm) * dpi_x) / 2.54)
                .round()
                .max(1.0)
                .min(pw as f64) as u32
        };
        return vec![(0, end_px, "single", 1)];
    }

    let mut slices = Vec::with_capacity(n_placas);
    let mut x_origin_f = 0.0f64;
    let mut size_of_cut_f = 0.0f64;

    for (i, &measure_cm) in measures_cm.iter().enumerate() {
        let plate = i + 1;
        let (pos, num) = if plate == 1 {
            size_of_cut_f = ((measure_cm + sobreposicao_cm) * dpi_x) / 2.54;
            ("start", plate)
        } else if plate != n_placas {
            x_origin_f = size_of_cut_f - ((2.0 * sobreposicao_cm) * dpi_x) / 2.54;
            size_of_cut_f += (measure_cm * dpi_x) / 2.54;
            ("middle", 2 * plate - 2)
        } else {
            x_origin_f = size_of_cut_f - ((2.0 * sobreposicao_cm) * dpi_x) / 2.54;
            size_of_cut_f = if clamp_last_to_pw {
                pw as f64
            } else {
                (size_of_cut_f + (measure_cm * dpi_x) / 2.54).min(pw as f64)
            };
            ("end", 2 * plate - 2)
        };

        let x0 = (x_origin_f.round().max(0.0) as u32).min(pw.saturating_sub(1));
        let x1 = (size_of_cut_f.round().max((x0 + 1) as f64) as u32).min(pw);
        slices.push((x0, x1, pos, num));
    }

    slices
}

#[allow(clippy::too_many_arguments)]
fn slice_and_save_panel(
    img_path: &Path,
    entrada: &Path,
    saida: &Path,
    tpl_meta: &crate::core::imaging::LoadedImageMeta,
    font_bytes: Option<&[u8]>,
    tipo: &str,
    inverter: bool,
    pad_cm: f64,
    sobreposicao_cm: f64,
    text_color: Rgb<u8>,
    city_cfg: Option<(Rgb<u8>, f64, f64, f64, &HashMap<String, String>)>,
    mover: bool,
    measures_fn: impl FnOnce(f64) -> Vec<f64>,
    clamp_last_to_pw: bool,
    cancel: &AtomicBool,
    log_fn: impl Fn(&str),
) -> Result<(), String> {
    let fname = img_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let meta = load_image_with_meta(img_path, 72.0)?;
    let mut panel = meta.image.into_rgb8();
    let dpi = (meta.dpi_x, meta.dpi_y);

    if inverter {
        imageops::rotate180_in_place(&mut panel);
    }
    if tipo == "horizontal" {
        panel = rotate270_rgb_fast(&panel);
    }

    let (pw, ph) = panel.dimensions();
    let largura_cm = (pw as f64 / dpi.0) * 2.54;
    let measures = measures_fn(largura_cm);
    let slices = compute_plate_slices(pw, dpi.0, &measures, sobreposicao_cm, clamp_last_to_pw);
    let n_placas = slices.len();

    let passo_msg = if measures.is_empty() {
        "0cm".to_string()
    } else if measures.windows(2).all(|w| (w[0] - w[1]).abs() < 0.05) {
        format!("~{:.1}cm", measures[0])
    } else {
        measures
            .iter()
            .map(|m| format!("{m:.1}"))
            .collect::<Vec<_>>()
            .join("/")
            + "cm"
    };
    log_fn(&format!("✂️ {fname} | {n_placas} placa(s) ({passo_msg})"));

    let tpl_rgba = resize_template(&tpl_meta.image, (tpl_meta.dpi_x, tpl_meta.dpi_y), dpi);
    let city_info = city_cfg.and_then(|(c_color, c_w, c_h, c_m, overrides)| {
        extrair_cidade(&fname, overrides).map(|c| (c, c_color, c_w, c_h, c_m))
    });

    let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = img_path.extension().unwrap_or_default().to_string_lossy();

    for (idx, (x0, x1, pos, num)) in slices.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let plate = idx + 1;
        let cropped = imageops::crop_imm(&panel, x0, 0, x1 - x0, ph).to_image();

        let city_arg = if plate == n_placas {
            city_info
                .as_ref()
                .map(|(c, col, w, h, m)| (c.as_str(), *col, *w, *h, *m))
        } else {
            None
        };

        let mut plate_rgb = apply_plate_decorations(
            cropped,
            pos,
            num,
            pad_cm,
            &fname,
            &tpl_rgba,
            dpi,
            text_color,
            font_bytes,
            city_arg,
        );

        if tipo == "horizontal" {
            plate_rgb = rotate90_rgb_fast(&plate_rgb);
        }
        if inverter {
            imageops::rotate180_in_place(&mut plate_rgb);
        }

        let out_name = format!("{stem} - P{plate:02}.{ext}");
        save_image_with_meta(
            &DynamicImage::ImageRgb8(plate_rgb),
            &saida.join(out_name),
            dpi.0,
            dpi.1,
            meta.icc_profile.as_deref(),
        )?;
    }

    if mover && !cancel.load(Ordering::Relaxed) {
        let orig_dir = entrada.join("painel_original");
        let _ = fs::create_dir_all(&orig_dir);
        let _ = fs::rename(img_path, orig_dir.join(&fname));
    }

    Ok(())
}

pub fn simular_auto(payload: &CortadorAutoPayload) -> Result<CortadorSimulacao, String> {
    let entrada = PathBuf::from(payload.pasta.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let imagens = listar_paineis(&entrada, &gabarito)?;
    let tipo = payload.tipo.to_lowercase();

    let mut itens = Vec::with_capacity(imagens.len());
    let mut total_placas = 0usize;

    for img_path in imagens {
        let fname = img_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        match read_image_dimensions_and_dpi(&img_path, 72.0) {
            Ok((w, h, dpi_x, dpi_y)) => {
                let (pw, ph, eff_dpi) = if tipo == "horizontal" {
                    (h, w, dpi_y)
                } else {
                    (w, h, dpi_x)
                };
                let largura_cm = px_to_cm(pw, eff_dpi);
                let altura_cm = px_to_cm(ph, if tipo == "horizontal" { dpi_x } else { dpi_y });
                let n_placas = ((largura_cm / payload.medida.max(1.0)).ceil() as usize).max(1);
                let passo_cm = largura_cm / n_placas as f64;
                let placas_cm = vec![(passo_cm * 10.0).round() / 10.0; n_placas];
                let cidade = if payload.cidade {
                    extrair_cidade(&fname, &payload.overrides)
                } else {
                    None
                };
                total_placas += n_placas;
                itens.push(CortadorSimItem {
                    arquivo: fname,
                    largura_cm: (largura_cm * 10.0).round() / 10.0,
                    altura_cm: (altura_cm * 10.0).round() / 10.0,
                    dpi: eff_dpi.round(),
                    n_placas,
                    placas_cm,
                    cidade,
                    erro: None,
                });
            }
            Err(e) => {
                itens.push(CortadorSimItem {
                    arquivo: fname,
                    largura_cm: 0.0,
                    altura_cm: 0.0,
                    dpi: 0.0,
                    n_placas: 0,
                    placas_cm: Vec::new(),
                    cidade: None,
                    erro: Some(e),
                });
            }
        }
    }

    Ok(CortadorSimulacao {
        total_paineis: itens.len(),
        total_placas,
        itens,
    })
}

pub fn simular_medidas(payload: &CortadorMedidasPayload) -> Result<CortadorSimulacao, String> {
    let entrada = PathBuf::from(payload.entrada.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let imagens = listar_paineis(&entrada, &gabarito)?;
    let tipo = payload.tipo.to_lowercase();

    let mut itens = Vec::with_capacity(imagens.len());
    let mut total_placas = 0usize;

    for img_path in imagens {
        let fname = img_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        match read_image_dimensions_and_dpi(&img_path, 72.0) {
            Ok((w, h, dpi_x, dpi_y)) => {
                let (pw, ph, eff_dpi) = if tipo == "horizontal" {
                    (h, w, dpi_y)
                } else {
                    (w, h, dpi_x)
                };
                let largura_cm = px_to_cm(pw, eff_dpi);
                let altura_cm = px_to_cm(ph, if tipo == "horizontal" { dpi_x } else { dpi_y });
                let n_placas = payload.medidas.len();
                let placas_cm = payload
                    .medidas
                    .iter()
                    .map(|m| (m * 10.0).round() / 10.0)
                    .collect();
                total_placas += n_placas;
                itens.push(CortadorSimItem {
                    arquivo: fname,
                    largura_cm: (largura_cm * 10.0).round() / 10.0,
                    altura_cm: (altura_cm * 10.0).round() / 10.0,
                    dpi: eff_dpi.round(),
                    n_placas,
                    placas_cm,
                    cidade: None,
                    erro: None,
                });
            }
            Err(e) => {
                itens.push(CortadorSimItem {
                    arquivo: fname,
                    largura_cm: 0.0,
                    altura_cm: 0.0,
                    dpi: 0.0,
                    n_placas: 0,
                    placas_cm: Vec::new(),
                    cidade: None,
                    erro: Some(e),
                });
            }
        }
    }

    Ok(CortadorSimulacao {
        total_paineis: itens.len(),
        total_placas,
        itens,
    })
}

fn run_auto(
    app: &AppHandle,
    payload: &CortadorAutoPayload,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let emit_log = |msg: String| {
        let _ = app.emit("cortador-log", msg);
    };

    let entrada = PathBuf::from(payload.pasta.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let saida = if payload.saida.trim().is_empty() {
        entrada.clone()
    } else {
        PathBuf::from(payload.saida.trim())
    };
    fs::create_dir_all(&saida).map_err(|e| format!("Erro ao criar pasta de saída: {e}"))?;

    let imagens = listar_paineis(&entrada, &gabarito)?;
    let total = imagens.len();
    if total == 0 {
        emit_log("❌ Nenhuma imagem encontrada na pasta de entrada.".to_string());
        let _ = app.emit(
            "cortador-done",
            CortadorDoneSummary {
                ok: 0,
                err: 0,
                cancelled: false,
            },
        );
        return Ok(());
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let font_bytes = load_system_font_bytes();
    let log_lock = Mutex::new(());
    let done = AtomicUsize::new(0);
    let ok_cnt = AtomicUsize::new(0);
    let err_cnt = AtomicUsize::new(0);

    let workers = payload.workers.clamp(1, 16);
    let pool = ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|e| e.to_string())?;

    let auto_color = payload.cor.starts_with("Automática");
    let tipo = payload.tipo.to_lowercase();
    let city_color = resolver_cor(&payload.cidade_cor);

    pool.install(|| {
        imagens.par_iter().enumerate().for_each(|(idx, img_path)| {
            if cancel.load(Ordering::Relaxed) {
                return;
            }

            let fname = img_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();

            let (color_name, text_color) = if auto_color {
                let (cn, hex) = DEFAULT_COLOR_PALETTE[idx % DEFAULT_COLOR_PALETTE.len()];
                (cn.to_string(), parse_hex_color(hex))
            } else {
                (payload.cor.clone(), resolver_cor(&payload.cor))
            };

            let city_cfg = if payload.cidade {
                Some((
                    city_color,
                    payload.cidade_largura,
                    payload.cidade_altura,
                    payload.cidade_margem,
                    &payload.overrides,
                ))
            } else {
                None
            };

            let res = slice_and_save_panel(
                img_path,
                &entrada,
                &saida,
                &tpl_meta,
                font_bytes,
                &tipo,
                payload.inverter,
                payload.pad,
                payload.sobreposicao,
                text_color,
                city_cfg,
                payload.mover,
                |largura_cm| {
                    let n_placas = ((largura_cm / payload.medida.max(1.0)).ceil() as usize).max(1);
                    let passo_cm = largura_cm / n_placas as f64;
                    vec![passo_cm; n_placas]
                },
                true,
                cancel,
                |msg| {
                    let _g = log_lock.lock().unwrap();
                    emit_log(format!("{msg} | cor={color_name}"));
                },
            );

            if let Err(e) = res {
                err_cnt.fetch_add(1, Ordering::Relaxed);
                let _g = log_lock.lock().unwrap();
                emit_log(format!("⚠️ Erro em '{fname}': {e}"));
            } else if !cancel.load(Ordering::Relaxed) {
                ok_cnt.fetch_add(1, Ordering::Relaxed);
            }

            let cur = done.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit("cortador-progress", CortadorProgress { current: cur, total });
        });
    });

    let was_cancelled = cancel.load(Ordering::Relaxed);
    if was_cancelled {
        emit_log("⏹ Corte cancelado pelo operador.".to_string());
    } else {
        emit_log("🎉 PROCESSO FINALIZADO COM SUCESSO!".to_string());
    }

    let _ = app.emit(
        "cortador-done",
        CortadorDoneSummary {
            ok: ok_cnt.load(Ordering::Relaxed),
            err: err_cnt.load(Ordering::Relaxed),
            cancelled: was_cancelled,
        },
    );

    Ok(())
}

fn run_medidas(
    app: &AppHandle,
    payload: &CortadorMedidasPayload,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let emit_log = |msg: String| {
        let _ = app.emit("cortador-log", msg);
    };

    let entrada = PathBuf::from(payload.entrada.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let saida = if payload.saida.trim().is_empty() {
        entrada.clone()
    } else {
        PathBuf::from(payload.saida.trim())
    };
    fs::create_dir_all(&saida).map_err(|e| format!("Erro ao criar pasta de saída: {e}"))?;

    let imagens = listar_paineis(&entrada, &gabarito)?;
    let total = imagens.len();
    if total == 0 {
        emit_log("❌ Nenhuma imagem encontrada na pasta de entrada.".to_string());
        let _ = app.emit(
            "cortador-done",
            CortadorDoneSummary {
                ok: 0,
                err: 0,
                cancelled: false,
            },
        );
        return Ok(());
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let font_bytes = load_system_font_bytes();
    let text_color = resolver_cor(&payload.cor);
    let tipo = payload.tipo.to_lowercase();

    let mut ok_cnt = 0usize;
    let mut err_cnt = 0usize;

    for (idx, img_path) in imagens.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let fname = img_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();

        match slice_and_save_panel(
            img_path,
            &entrada,
            &saida,
            &tpl_meta,
            font_bytes,
            &tipo,
            payload.inverter,
            payload.pad,
            payload.sobreposicao,
            text_color,
            None,
            payload.mover,
            |_| payload.medidas.clone(),
            false,
            cancel,
            |msg| emit_log(msg.to_string()),
        ) {
            Ok(()) => {
                if !cancel.load(Ordering::Relaxed) {
                    ok_cnt += 1;
                    emit_log(format!("  ✅ {fname} concluído."));
                }
            }
            Err(e) => {
                err_cnt += 1;
                emit_log(format!("⚠️ Erro em '{fname}': {e}"));
            }
        }

        let _ = app.emit(
            "cortador-progress",
            CortadorProgress {
                current: idx + 1,
                total,
            },
        );
    }

    let was_cancelled = cancel.load(Ordering::Relaxed);
    if was_cancelled {
        emit_log("⏹ Corte cancelado pelo operador.".to_string());
    } else {
        emit_log("🎉 PROCESSO FINALIZADO COM SUCESSO!".to_string());
    }

    let _ = app.emit(
        "cortador-done",
        CortadorDoneSummary {
            ok: ok_cnt,
            err: err_cnt,
            cancelled: was_cancelled,
        },
    );

    Ok(())
}
