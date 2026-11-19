use crate::core::imaging::{
    blit_rgb_subrect_fast, draw_text_rgb, draw_text_with_stroke_rgb, load_image_with_meta,
    load_system_font_bytes, measure_text_px, parse_hex_color, paste_rgba_onto_rgb,
    resize_rgba_simd, save_image_with_meta, save_rgb_tiff,
};
use image::imageops;
use image::{DynamicImage, Rgb, RgbImage, RgbaImage};
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

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
    #[serde(default)]
    pub arquivos: Option<Vec<String>>,
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
    #[serde(default)]
    pub arquivos: Option<Vec<String>>,
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
    let re_plate = Regex::new(r"(?i) - P\d+$").unwrap();
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

fn resolver_paineis(
    arquivos: &Option<Vec<String>>,
    entrada: &Path,
    gabarito: &Path,
) -> Result<(Vec<PathBuf>, bool), String> {
    if let Some(sel) = arquivos {
        if !sel.is_empty() {
            let re_plate = Regex::new(r"(?i) - P\d+$").unwrap();
            let gab_abs = fs::canonicalize(gabarito).unwrap_or_else(|_| gabarito.to_path_buf());
            let mut vistos = HashSet::new();
            let mut lista = Vec::new();
            for raw in sel {
                let p = PathBuf::from(raw.trim());
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
                let canon = fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
                if canon == gab_abs || !vistos.insert(canon) {
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
            return Ok((lista, true));
        }
    }
    Ok((listar_paineis(entrada, gabarito)?, false))
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

fn extrair_cidade_obrigatoria(
    filename: &str,
    overrides_norm: &HashMap<String, String>,
) -> Result<String, String> {
    let re = Regex::new(
        r"(?i)^\s*(?P<city>.+?)\s*\(\s*L\s*\d+(?:[.,]\d+)?\s*[X×]\s*A\s*\d+(?:[.,]\d+)?\s*\)\s*$",
    )
    .map_err(|e| e.to_string())?;
    let stem = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let caps = re.captures(&stem).ok_or_else(|| {
        format!(
            "Não foi possível extrair a cidade de '{filename}'. Use o formato 'CIDADE (L 2,00 X A 2,60).TIF'."
        )
    })?;
    let raw = caps.name("city").map(|m| m.as_str().trim()).unwrap_or("");
    let final_city = overrides_norm
        .get(&raw.to_lowercase())
        .map(|s| s.as_str())
        .unwrap_or(raw)
        .trim()
        .to_string();
    if final_city.is_empty() {
        return Err(format!("A cidade de '{filename}' não pode estar vazia."));
    }
    Ok(final_city)
}

fn get_cached_template(
    cache: &Mutex<HashMap<(u32, u32), Arc<RgbaImage>>>,
    template_rgba: &RgbaImage,
    tpl_dpi: (f64, f64),
    panel_dpi: (f64, f64),
) -> Arc<RgbaImage> {
    let key = (
        (panel_dpi.0 * 100.0).round() as u32,
        (panel_dpi.1 * 100.0).round() as u32,
    );
    if let Some(cached) = cache.lock().unwrap().get(&key) {
        return cached.clone();
    }
    let nw = ((template_rgba.width() as f64) * panel_dpi.0 / tpl_dpi.0)
        .ceil()
        .max(1.0) as u32;
    let nh = ((template_rgba.height() as f64) * panel_dpi.1 / tpl_dpi.1)
        .ceil()
        .max(1.0) as u32;
    let resized = Arc::new(resize_rgba_simd(template_rgba, nw, nh));
    cache.lock().unwrap().insert(key, resized.clone());
    resized
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

/// Monta a placa em UMA única alocação: padding branco + cópia direta do slice + contorno 1px + gabarito + numeração + nome.
#[allow(clippy::too_many_arguments)]
fn build_plate_fast(
    panel_rgb: &RgbImage,
    x0: u32,
    x1: u32,
    plate_pos: &str,
    number: usize,
    pad_cm: f64,
    name_file: &str,
    template_rgba: &RgbaImage,
    dpi: (f64, f64),
    text_color: Rgb<u8>,
    font_bytes: Option<&[u8]>,
) -> (RgbImage, u32, u32) {
    let cw = x1.saturating_sub(x0).max(1);
    let ch = panel_rgb.height();
    let pad_x = (pad_cm * dpi.0 / 2.54).ceil().max(0.0) as u32;
    let pad_y = (pad_cm * dpi.1 / 2.54).ceil().max(0.0) as u32;

    let out_w = cw + 2 * pad_x;
    let out_h = ch + 2 * pad_y;
    let mut out = RgbImage::from_pixel(out_w, out_h, Rgb([255, 255, 255]));

    // Copia a faixa direto do painel para o destino (sem alocação de crop intermediário)
    blit_rgb_subrect_fast(&mut out, panel_rgb, x0, 0, cw, ch, pad_x, pad_y);

    // Contorno preto de 1px na borda interna da arte (igual ao add_contour do Python)
    let black = Rgb([0, 0, 0]);
    for x in pad_x..(pad_x + cw) {
        out.put_pixel(x, pad_y, black);
        out.put_pixel(x, pad_y + ch - 1, black);
    }
    for y in pad_y..(pad_y + ch) {
        out.put_pixel(pad_x, y, black);
        out.put_pixel(pad_x + cw - 1, y, black);
    }

    let origin_x = out_w.saturating_sub(pad_x) as i64;
    let font_size = (30.0 * dpi.0 / 72.0).ceil() as f32;

    match plate_pos {
        "start" => {
            paste_rgba_onto_rgb(&mut out, template_rgba, origin_x, 0);
            let lbl = format!("{number:02}");
            let lx = out_w.saturating_sub(2 * pad_x) as i32;
            draw_text_rgb(&mut out, font_bytes, &lbl, lx, 0, font_size, text_color);
        }
        "middle" => {
            paste_rgba_onto_rgb(&mut out, template_rgba, 0, 0);
            paste_rgba_onto_rgb(&mut out, template_rgba, origin_x, 0);
            let l1 = format!("{number:02}");
            let l2 = format!("{:02}", number + 1);
            let lx2 = out_w.saturating_sub(2 * pad_x) as i32;
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

    (out, pad_x, pad_y)
}

/// Escreve a cidade no canto inferior esquerdo da arte JÁ ORIENTADA, com contorno branco
/// (idêntico ao `add_city_label` de `cortador_core.py`).
#[allow(clippy::too_many_arguments)]
fn add_city_label(
    img: &mut RgbImage,
    city_name: &str,
    dpi: (f64, f64),
    padding_px: (u32, u32),
    text_width_cm: f64,
    text_height_cm: f64,
    margin_cm: f64,
    text_color: Rgb<u8>,
    font_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let Some(bytes) = font_bytes else {
        return Ok(());
    };
    let (pad_x, pad_y) = padding_px;
    let margin_x = (margin_cm * dpi.0 / 2.54).ceil().max(0.0) as u32;
    let margin_y = (margin_cm * dpi.1 / 2.54).ceil().max(0.0) as u32;

    let left = pad_x + margin_x + 1;
    let right = img.width().saturating_sub(pad_x + margin_x + 1);
    let top = pad_y + margin_y + 1;
    let bottom = img.height().saturating_sub(pad_y + margin_y + 1);

    if right <= left || bottom <= top {
        return Err(format!(
            "Placa de '{city_name}' sem espaço para o texto da cidade. Diminua a margem."
        ));
    }

    let available_w = right - left;
    let available_h = bottom - top;
    let target_w = ((text_width_cm * dpi.0 / 2.54).floor().max(1.0) as u32).min(available_w);
    let target_h = ((text_height_cm * dpi.1 / 2.54).floor().max(1.0) as u32).min(available_h);

    let mut low = 1u32;
    let mut high = (target_h * 2).max(1);
    let mut best: Option<(u32, u32, i32)> = None;

    while low <= high {
        let mid = (low + high) / 2;
        let stroke = ((mid as f64) * 0.025).round().max(1.0) as i32;
        let (tw, th) = measure_text_px(bytes, city_name, mid as f32);
        let total_w = tw + (stroke as u32) * 2;
        let total_h = th + (stroke as u32) * 2;
        if total_w <= target_w && total_h <= target_h {
            best = Some((mid, th, stroke));
            low = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        }
    }

    let Some((size, th, stroke)) = best else {
        return Err(format!(
            "Texto da cidade '{city_name}' não cabe na última placa."
        ));
    };

    let x = left as i32 + stroke;
    let y = bottom.saturating_sub(th) as i32 - stroke;
    draw_text_with_stroke_rgb(
        img,
        Some(bytes),
        city_name,
        x,
        y,
        size as f32,
        text_color,
        Rgb([255, 255, 255]),
        stroke,
    );

    Ok(())
}

fn unique_destination(dest_dir: &Path, filename: &str) -> PathBuf {
    let candidate = dest_dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().unwrap_or_default().to_string_lossy();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut idx = 1usize;
    loop {
        let c = dest_dir.join(format!("{stem} ({idx}){ext}"));
        if !c.exists() {
            return c;
        }
        idx += 1;
    }
}

fn move_file_safe(src: &Path, dst: &Path) -> Result<(), String> {
    fs::rename(src, dst)
        .or_else(|_| {
            fs::copy(src, dst)?;
            fs::remove_file(src)
        })
        .map_err(|e| e.to_string())
}

/// Move originais e placas um nível acima (idêntico ao `move_everything_up_one_level` do Python).
fn move_everything_up_one_level(
    image_path: &Path,
    output_dir: &Path,
    emit_log: &dyn Fn(String),
) {
    let img_abs = fs::canonicalize(image_path).unwrap_or_else(|_| image_path.to_path_buf());
    let out_abs = fs::canonicalize(output_dir).unwrap_or_else(|_| output_dir.to_path_buf());
    let mut moved: HashSet<PathBuf> = HashSet::new();

    if let Some(dest_out) = out_abs.parent() {
        if let Ok(entries) = fs::read_dir(&out_abs) {
            for e in entries.flatten() {
                let src = e.path();
                if !src.is_file() {
                    continue;
                }
                let fname = src.file_name().unwrap_or_default().to_string_lossy().into_owned();
                let dst = unique_destination(dest_out, &fname);
                match move_file_safe(&src, &dst) {
                    Ok(_) => {
                        moved.insert(src);
                        emit_log(format!("📦 movido: {fname} -> {}", dest_out.display()));
                    }
                    Err(err) => emit_log(format!("❌ não foi possível mover '{fname}': {err}")),
                }
            }
        }
    }

    if img_abs == out_abs {
        return;
    }

    if let Some(dest_img) = img_abs.parent() {
        if let Ok(entries) = fs::read_dir(&img_abs) {
            for e in entries.flatten() {
                let src = e.path();
                if !src.is_file() || moved.contains(&src) {
                    continue;
                }
                let fname = src.file_name().unwrap_or_default().to_string_lossy().into_owned();
                let dst = unique_destination(dest_img, &fname);
                match move_file_safe(&src, &dst) {
                    Ok(_) => emit_log(format!("📦 movido: {fname} -> {}", dest_img.display())),
                    Err(err) => emit_log(format!("❌ não foi possível mover '{fname}': {err}")),
                }
            }
        }
    }
}

fn save_plate_rgb(
    rgb: &RgbImage,
    out_path: &Path,
    dpi: (f64, f64),
    icc: Option<&[u8]>,
) -> Result<(), String> {
    let ext = out_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "tif" || ext == "tiff" {
        save_rgb_tiff(rgb, out_path, dpi.0, dpi.1, icc)
    } else {
        save_image_with_meta(&DynamicImage::ImageRgb8(rgb.clone()), out_path, dpi.0, dpi.1, icc)
    }
}

fn run_auto(app: &AppHandle, payload: &CortadorAutoPayload) -> Result<(), String> {
    let emit_log = |msg: String| {
        let _ = app.emit("cortador-log", msg);
    };

    if payload.medida <= 0.0 {
        return Err("Largura da placa deve ser maior que zero.".to_string());
    }
    if payload.sobreposicao < 0.0 || payload.pad < 0.0 {
        return Err("Sobreposição e padding não podem ser negativos.".to_string());
    }

    let entrada = PathBuf::from(payload.pasta.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let saida_custom = if payload.saida.trim().is_empty() {
        None
    } else {
        let p = PathBuf::from(payload.saida.trim());
        fs::create_dir_all(&p).map_err(|e| format!("Erro ao criar pasta de saída: {e}"))?;
        Some(p)
    };

    let (imagens, modo_arquivos) = resolver_paineis(&payload.arquivos, &entrada, &gabarito)?;
    let total = imagens.len();
    if total == 0 {
        emit_log("❌ Nenhuma imagem encontrada para cortar.".to_string());
        return Ok(());
    }

    // Pré-valida os nomes de cidade de todo o lote antes de cortar (igual ao Python)
    let mut panel_cities: HashMap<String, String> = HashMap::new();
    if payload.cidade {
        let overrides_norm: HashMap<String, String> = payload
            .overrides
            .iter()
            .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
            .collect();

        for img_path in &imagens {
            let fname = img_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let city = extrair_cidade_obrigatoria(&fname, &overrides_norm)?;
            panel_cities.insert(fname, city);
        }
        emit_log("🏙️ Cidades validadas para a última placa:".to_string());
        for img_path in &imagens {
            let fname = img_path.file_name().unwrap_or_default().to_string_lossy();
            if let Some(c) = panel_cities.get(fname.as_ref()) {
                emit_log(format!("  - {fname}: {c}"));
            }
        }
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let tpl_rgba_base = tpl_meta.image.to_rgba8();
    let tpl_dpi = (tpl_meta.dpi_x, tpl_meta.dpi_y);
    let tpl_cache: Mutex<HashMap<(u32, u32), Arc<RgbaImage>>> = Mutex::new(HashMap::new());

    let font_bytes = load_system_font_bytes();
    let log_lock = Mutex::new(());
    let done = AtomicUsize::new(0);
    let failed_list: Mutex<Vec<String>> = Mutex::new(Vec::new());

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
                let mut panel_rgb = meta.image.to_rgb8();
                let dpi = (meta.dpi_x, meta.dpi_y);

                if payload.inverter {
                    panel_rgb = imageops::rotate180(&panel_rgb);
                }
                if tipo == "horizontal" {
                    panel_rgb = imageops::rotate270(&panel_rgb);
                }

                let (pw, _ph) = panel_rgb.dimensions();
                let largura_cm = (pw as f64 / dpi.0) * 2.54;
                let n_placas = ((largura_cm / payload.medida).ceil() as usize).max(1);

                {
                    let _g = log_lock.lock().unwrap();
                    emit_log(format!(
                        "✂️ {fname} | {n_placas} placa(s) | largura={largura_cm:.1}cm | cor={color_name}"
                    ));
                }

                let tpl_rgba = get_cached_template(&tpl_cache, &tpl_rgba_base, tpl_dpi, dpi);
                let city = panel_cities.get(&fname);

                let stem = img_path.file_stem().unwrap_or_default().to_string_lossy();
                let ext = img_path.extension().unwrap_or_default().to_string_lossy();

                // Matemática EXATA do cortador_core.py (largura fixa measure_cm + restante na última placa)
                let mut size_of_cut: u32 = 0;

                for plate in 1..=n_placas {
                    let (x0, x1, pos, num) = if plate == 1 {
                        let cut = (((payload.medida + payload.sobreposicao) * dpi.0) / 2.54) as u32;
                        size_of_cut = pw.min(cut);
                        (0u32, size_of_cut, "start", plate)
                    } else if plate != n_placas {
                        let x_orig = ((size_of_cut as f64)
                            - (2.0 * payload.sobreposicao * dpi.0 / 2.54))
                            .max(0.0) as u32;
                        let next_cut = ((size_of_cut as f64)
                            + (payload.medida * dpi.0 / 2.54)) as u32;
                        size_of_cut = pw.min(next_cut);
                        (x_orig, size_of_cut, "middle", 2 * plate - 2)
                    } else {
                        let x_orig = ((size_of_cut as f64)
                            - (2.0 * payload.sobreposicao * dpi.0 / 2.54))
                            .max(0.0) as u32;
                        size_of_cut = pw;
                        (x_orig, size_of_cut, "end", 2 * plate - 2)
                    };

                    let (mut plate_rgb, pad_x, pad_y) = build_plate_fast(
                        &panel_rgb,
                        x0,
                        x1,
                        pos,
                        num,
                        payload.pad,
                        &fname,
                        &tpl_rgba,
                        dpi,
                        text_color,
                        font_bytes,
                    );

                    let mut final_padding = (pad_x, pad_y);
                    if tipo == "horizontal" {
                        plate_rgb = imageops::rotate90(&plate_rgb);
                        final_padding = (pad_y, pad_x);
                    }
                    if payload.inverter {
                        plate_rgb = imageops::rotate180(&plate_rgb);
                    }

                    // Cidade escrita DEPOIS de restaurar orientação, no canto inferior esquerdo com contorno branco
                    if plate == n_placas {
                        if let Some(city_str) = city {
                            add_city_label(
                                &mut plate_rgb,
                                city_str,
                                dpi,
                                final_padding,
                                payload.cidade_largura,
                                payload.cidade_altura,
                                payload.cidade_margem,
                                city_color,
                                font_bytes,
                            )?;
                        }
                    }

                    let out_dir_placa = saida_custom
                        .as_deref()
                        .or_else(|| img_path.parent())
                        .unwrap_or(&entrada);
                    let out_name = format!("{stem} - P{plate:02}.{ext}");
                    save_plate_rgb(
                        &plate_rgb,
                        &out_dir_placa.join(&out_name),
                        dpi,
                        meta.icc_profile.as_deref(),
                    )?;
                }

                Ok(())
            })();

            if let Err(e) = res {
                failed_list.lock().unwrap().push(fname.clone());
                let _g = log_lock.lock().unwrap();
                emit_log(format!("❌ Erro em '{fname}': {e}"));
            }

            let cur = done.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit("cortador-progress", CortadorProgress { current: cur, total });
        });
    });

    let failed = failed_list.into_inner().unwrap();
    if !failed.is_empty() {
        emit_log(format!(
            "⚠️ {} painel(is) falharam ({}). Os arquivos não serão movidos.",
            failed.len(),
            failed.join(", ")
        ));
        return Ok(());
    }

    if payload.mover && !modo_arquivos {
        let saida_move = saida_custom.as_deref().unwrap_or(&entrada);
        emit_log("📦 Movendo originais e placas geradas um nível acima...".to_string());
        move_everything_up_one_level(&entrada, saida_move, &emit_log);
    }

    emit_log("🏁 PROCESSO FINALIZADO COM SUCESSO!".to_string());
    Ok(())
}

fn run_medidas(app: &AppHandle, payload: &CortadorMedidasPayload) -> Result<(), String> {
    let emit_log = |msg: String| {
        let _ = app.emit("cortador-log", msg);
    };

    let entrada = PathBuf::from(payload.entrada.trim());
    let gabarito = PathBuf::from(payload.gabarito.trim());
    let saida_custom = if payload.saida.trim().is_empty() {
        None
    } else {
        let p = PathBuf::from(payload.saida.trim());
        fs::create_dir_all(&p).map_err(|e| format!("Erro ao criar pasta de saída: {e}"))?;
        Some(p)
    };

    let (imagens, _modo_arquivos) = resolver_paineis(&payload.arquivos, &entrada, &gabarito)?;
    let total = imagens.len();
    if total == 0 {
        emit_log("❌ Nenhuma imagem encontrada para cortar.".to_string());
        return Ok(());
    }

    let tpl_meta = load_image_with_meta(&gabarito, 72.0)?;
    let tpl_rgba_base = tpl_meta.image.to_rgba8();
    let tpl_dpi = (tpl_meta.dpi_x, tpl_meta.dpi_y);
    let tpl_cache: Mutex<HashMap<(u32, u32), Arc<RgbaImage>>> = Mutex::new(HashMap::new());

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
                let mut panel_rgb = meta.image.to_rgb8();
                let dpi = (meta.dpi_x, meta.dpi_y);
                if payload.inverter {
                    panel_rgb = imageops::rotate180(&panel_rgb);
                }
                if tipo == "horizontal" {
                    panel_rgb = imageops::rotate270(&panel_rgb);
                }

                let (pw, _ph) = panel_rgb.dimensions();
                let tpl_rgba = get_cached_template(&tpl_cache, &tpl_rgba_base, tpl_dpi, dpi);
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

                    let (mut plate_rgb, _, _) = build_plate_fast(
                        &panel_rgb,
                        x0,
                        x1,
                        pos,
                        num,
                        payload.pad,
                        &fname,
                        &tpl_rgba,
                        dpi,
                        text_color,
                        font_bytes,
                    );

                    if tipo == "horizontal" {
                        plate_rgb = imageops::rotate90(&plate_rgb);
                    }
                    if payload.inverter {
                        plate_rgb = imageops::rotate180(&plate_rgb);
                    }

                    let out_dir_placa = saida_custom
                        .as_deref()
                        .or_else(|| img_path.parent())
                        .unwrap_or(&entrada);
                    let out_name = format!("{stem} - P{plate:02}.{ext}");
                    if let Err(e) = save_plate_rgb(
                        &plate_rgb,
                        &out_dir_placa.join(out_name),
                        dpi,
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
