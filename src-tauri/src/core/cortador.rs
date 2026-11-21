use crate::core::imaging::{
    add_1px_black_border_inside_inplace, blit_rgb_fast, draw_text_rgb, load_image_with_meta,
    load_system_font_bytes, measure_text_px, parse_hex_color, paste_rgba_onto_rgb,
    resize_rgba_simd, rotate270_rgb_fast, rotate90_rgb_fast, save_image_with_meta,
};
use image::{imageops, DynamicImage, Rgb, RgbImage, RgbaImage};
use rayon::ThreadPoolBuilder;
use rayon::prelude::*;
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
}

#[derive(Debug, Clone, Serialize)]
pub struct CortadorProgress {
    pub current: usize,
    pub total: usize,
}

pub struct CortadorService {
    rodando: Arc<AtomicBool>,
}

impl CortadorService {
    pub fn new() -> Self {
        Self {
            rodando: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn rodando(&self) -> bool {
        self.rodando.load(Ordering::Relaxed)
    }

    pub fn executar_auto(
        &self,
        app: AppHandle,
        payload: CortadorAutoPayload,
    ) -> Result<(), String> {
        if self.rodando.swap(true, Ordering::Relaxed) {
            return Err("Já existe um corte em andamento.".to_string());
        }
        let rodando_ref = self.rodando.clone();
        let _ = app.emit("cortador-status", true);

        thread::spawn(move || {
            let res = run_auto(&app, &payload);
            if let Err(e) = res {
                let _ = app.emit("cortador-log", format!("❌ Erro: {e}"));
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
        let rodando_ref = self.rodando.clone();
        let _ = app.emit("cortador-status", true);

        thread::spawn(move || {
            let res = run_medidas(&app, &payload);
            if let Err(e) = res {
                let _ = app.emit("cortador-log", format!("❌ Erro: {e}"));
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

fn run_auto(app: &AppHandle, payload: &CortadorAutoPayload) -> Result<(), String> {
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
        return Ok(());
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let font_bytes = load_system_font_bytes();
    let log_lock = Mutex::new(());
    let done = AtomicUsize::new(0);

    let workers = payload.workers.clamp(1, 16);
    let pool = ThreadPoolBuilder::new()
        .num_threads(workers)
        .build()
        .map_err(|e| e.to_string())?;

    let auto_color = payload.cor.starts_with("Automática");
    let tipo = payload.tipo.to_lowercase();

    pool.install(|| {
        imagens.par_iter().enumerate().for_each(|(idx, img_path)| {
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

            let res = (|| -> Result<(), String> {
                let meta = load_image_with_meta(img_path, 72.0)?;
                let mut panel = meta.image.into_rgb8();
                let dpi = (meta.dpi_x, meta.dpi_y);

                if payload.inverter {
                    imageops::rotate180_in_place(&mut panel);
                }
                if tipo == "horizontal" {
                    panel = rotate270_rgb_fast(&panel);
                }

                let (pw, ph) = panel.dimensions();
                let largura_cm = (pw as f64 / dpi.0) * 2.54;
                let n_placas = ((largura_cm / payload.medida).ceil() as usize).max(1);
                let passo_cm = largura_cm / n_placas as f64;

                {
                    let _g = log_lock.lock().unwrap();
                    emit_log(format!(
                        "✂️ {fname} | {n_placas} placa(s) de ~{passo_cm:.1}cm | cor={color_name}"
                    ));
                }

                let tpl_rgba = resize_template(&tpl_meta.image, (tpl_meta.dpi_x, tpl_meta.dpi_y), dpi);
                let city = if payload.cidade {
                    extrair_cidade(&fname, &payload.overrides)
                } else {
                    None
                };
                let city_color = resolver_cor(&payload.cidade_cor);

                let mut x_origin_f = 0.0f64;
                let mut size_of_cut_f = 0.0f64;

                let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
                let ext = img_path.extension().unwrap_or_default().to_string_lossy();

                for plate in 1..=n_placas {
                    let (pos, num) = if plate == 1 {
                        size_of_cut_f = ((passo_cm + payload.sobreposicao) * dpi.0) / 2.54;
                        ("start", plate)
                    } else if plate != n_placas {
                        x_origin_f = size_of_cut_f - ((2.0 * payload.sobreposicao) * dpi.0) / 2.54;
                        size_of_cut_f += (passo_cm * dpi.0) / 2.54;
                        ("middle", 2 * plate - 2)
                    } else {
                        x_origin_f = size_of_cut_f - ((2.0 * payload.sobreposicao) * dpi.0) / 2.54;
                        size_of_cut_f = pw as f64;
                        ("end", 2 * plate - 2)
                    };

                    let x0 = (x_origin_f.round().max(0.0) as u32).min(pw.saturating_sub(1));
                    let x1 = (size_of_cut_f.round().max((x0 + 1) as f64) as u32).min(pw);
                    let cropped = imageops::crop_imm(&panel, x0, 0, x1 - x0, ph).to_image();

                    let city_arg = if plate == n_placas {
                        city.as_deref().map(|c| {
                            (
                                c,
                                city_color,
                                payload.cidade_largura,
                                payload.cidade_altura,
                                payload.cidade_margem,
                            )
                        })
                    } else {
                        None
                    };

                    let mut plate_rgb = apply_plate_decorations(
                        cropped,
                        pos,
                        num,
                        payload.pad,
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
                    if payload.inverter {
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

                if payload.mover {
                    let orig_dir = entrada.join("painel_original");
                    let _ = fs::create_dir_all(&orig_dir);
                    let _ = fs::rename(img_path, orig_dir.join(&fname));
                }

                Ok(())
            })();

            if let Err(e) = res {
                let _g = log_lock.lock().unwrap();
                emit_log(format!("⚠️ Erro em '{fname}': {e}"));
            }

            let cur = done.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit("cortador-progress", CortadorProgress { current: cur, total });
        });
    });

    emit_log("🎉 PROCESSO FINALIZADO COM SUCESSO!".to_string());
    Ok(())
}

fn run_medidas(app: &AppHandle, payload: &CortadorMedidasPayload) -> Result<(), String> {
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
        return Ok(());
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let font_bytes = load_system_font_bytes();
    let text_color = resolver_cor(&payload.cor);
    let tipo = payload.tipo.to_lowercase();
    let n_placas = payload.medidas.len();

    for (idx, img_path) in imagens.iter().enumerate() {
        let fname = img_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        emit_log(format!("✂️ Cortando: {fname}"));

        match load_image_with_meta(img_path, 72.0) {
            Ok(meta) => {
                let mut panel = meta.image.into_rgb8();
                let dpi = (meta.dpi_x, meta.dpi_y);
                if payload.inverter {
                    imageops::rotate180_in_place(&mut panel);
                }
                if tipo == "horizontal" {
                    panel = rotate270_rgb_fast(&panel);
                }

                let (pw, ph) = panel.dimensions();
                let tpl_rgba = resize_template(&tpl_meta.image, (tpl_meta.dpi_x, tpl_meta.dpi_y), dpi);
                let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
                let ext = img_path.extension().unwrap_or_default().to_string_lossy();

                let mut x_origin_f = 0.0f64;
                let mut size_of_cut_f = 0.0f64;

                for (i, &measure_cm) in payload.medidas.iter().enumerate() {
                    let plate = i + 1;
                    let (pos, num) = if plate == 1 {
                        size_of_cut_f = ((measure_cm + payload.sobreposicao) * dpi.0) / 2.54;
                        ("start", plate)
                    } else if plate != n_placas {
                        x_origin_f = size_of_cut_f - ((2.0 * payload.sobreposicao) * dpi.0) / 2.54;
                        size_of_cut_f += (measure_cm * dpi.0) / 2.54;
                        ("middle", 2 * plate - 2)
                    } else {
                        x_origin_f = size_of_cut_f - ((2.0 * payload.sobreposicao) * dpi.0) / 2.54;
                        size_of_cut_f = (size_of_cut_f + (measure_cm * dpi.0) / 2.54).min(pw as f64);
                        ("end", 2 * plate - 2)
                    };

                    let x0 = (x_origin_f.round().max(0.0) as u32).min(pw.saturating_sub(1));
                    let x1 = (size_of_cut_f.round().max((x0 + 1) as f64) as u32).min(pw);
                    let cropped = imageops::crop_imm(&panel, x0, 0, x1 - x0, ph).to_image();

                    let mut plate_rgb = apply_plate_decorations(
                        cropped,
                        pos,
                        num,
                        payload.pad,
                        &fname,
                        &tpl_rgba,
                        dpi,
                        text_color,
                        font_bytes,
                        None,
                    );

                    if tipo == "horizontal" {
                        plate_rgb = rotate90_rgb_fast(&plate_rgb);
                    }
                    if payload.inverter {
                        imageops::rotate180_in_place(&mut plate_rgb);
                    }

                    let out_name = format!("{stem} - P{plate:02}.{ext}");
                    if let Err(e) = save_image_with_meta(
                        &DynamicImage::ImageRgb8(plate_rgb),
                        &saida.join(out_name),
                        dpi.0,
                        dpi.1,
                        meta.icc_profile.as_deref(),
                    ) {
                        emit_log(format!("⚠️ Erro ao salvar placa {plate}: {e}"));
                    } else {
                        emit_log(format!("  ✅ Placa {plate} salva."));
                    }
                }
            }
            Err(e) => emit_log(format!("⚠️ Erro ao abrir '{fname}': {e}")),
        }

        let _ = app.emit(
            "cortador-progress",
            CortadorProgress {
                current: idx + 1,
                total,
            },
        );
    }

    emit_log("🎉 PROCESSO FINALIZADO COM SUCESSO!".to_string());
    Ok(())
}
