use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use fast_image_resize as fr;
use image::{DynamicImage, GrayImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use rayon::prelude::*;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::Path;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};
use tiff::decoder::{Decoder, DecodingResult, Limits};
use tiff::encoder::colortype;
use tiff::encoder::{compression::Lzw, TiffEncoder};
use tiff::tags::Tag;
use tiff::ColorType;

pub const DPI_FALLBACK: f64 = 300.0;

static FONT_CACHE: OnceLock<Option<Vec<u8>>> = OnceLock::new();

pub fn cm_to_px(cm: f64, dpi: f64) -> u32 {
    (cm * dpi / 2.54).round().max(0.0) as u32
}

pub fn px_to_cm(px: u32, dpi: f64) -> f64 {
    ((px as f64 * 2.54 / dpi) * 100.0).round() / 100.0
}

pub fn wait_until_stable(path: &Path, wait_secs: f64, timeout_secs: f64) -> bool {
    let mut prev: Option<u64> = None;
    let inicio = Instant::now();
    let timeout = Duration::from_secs_f64(timeout_secs);
    let wait = Duration::from_secs_f64(wait_secs);

    while inicio.elapsed() < timeout {
        let cur = match fs::metadata(path) {
            Ok(m) => m.len(),
            Err(_) => return false,
        };
        if Some(cur) == prev && cur > 0 {
            return true;
        }
        prev = Some(cur);
        thread::sleep(wait);
    }
    false
}

pub struct LoadedImageMeta {
    pub image: DynamicImage,
    pub dpi_x: f64,
    pub dpi_y: f64,
    pub icc_profile: Option<Vec<u8>>,
    pub color_mode: String,
}

fn read_rational_tag(decoder: &mut Decoder<BufReader<File>>, tag: Tag) -> Option<f64> {
    if let Ok(val) = decoder.get_tag(tag) {
        match val {
            tiff::decoder::ifd::Value::Rational(n, d) if d > 0 => Some(n as f64 / d as f64),
            tiff::decoder::ifd::Value::SRational(n, d) if d > 0 => Some(n as f64 / d as f64),
            tiff::decoder::ifd::Value::Unsigned(v) if v > 0 => Some(v as f64),
            tiff::decoder::ifd::Value::Short(v) if v > 0 => Some(v as f64),
            _ => None,
        }
    } else {
        None
    }
}

fn decode_tiff_single_open(
    path: &Path,
    fallback_dpi: f64,
) -> Result<Option<LoadedImageMeta>, String> {
    let file = File::open(path).map_err(|e| format!("Erro ao abrir TIFF: {e}"))?;
    let mut decoder = Decoder::new(BufReader::with_capacity(256 * 1024, file))
        .map_err(|e| format!("Erro ao ler cabeçalho TIFF: {e}"))?
        .with_limits(Limits::unlimited());

    let mut dpi_x = fallback_dpi;
    let mut dpi_y = fallback_dpi;

    let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
    if let Some(mut x) = read_rational_tag(&mut decoder, Tag::XResolution) {
        if unit == 3 {
            x *= 2.54;
        }
        if x > 0.0 {
            dpi_x = x;
        }
    }
    if let Some(mut y) = read_rational_tag(&mut decoder, Tag::YResolution) {
        if unit == 3 {
            y *= 2.54;
        }
        if y > 0.0 {
            dpi_y = y;
        }
    } else {
        dpi_y = dpi_x;
    }

    let icc_profile = decoder
        .get_tag_u8_vec(Tag::Unknown(34675))
        .ok()
        .filter(|b| !b.is_empty());

    let ct = decoder.colortype().ok();
    let color_mode = ct
        .map(|c| format!("{c:?}"))
        .unwrap_or_else(|| "RGB".to_string());
    let (w, h) = decoder
        .dimensions()
        .map_err(|e| format!("Erro ao ler dimensões TIFF: {e}"))?;

    let dyn_img = match (ct, decoder.read_image()) {
        (Some(ColorType::RGB(8)), Ok(DecodingResult::U8(buf))) => {
            RgbImage::from_raw(w, h, buf).map(DynamicImage::ImageRgb8)
        }
        (Some(ColorType::RGBA(8)), Ok(DecodingResult::U8(buf))) => {
            RgbaImage::from_raw(w, h, buf).map(DynamicImage::ImageRgba8)
        }
        (Some(ColorType::Gray(8)), Ok(DecodingResult::U8(buf))) => {
            GrayImage::from_raw(w, h, buf).map(DynamicImage::ImageLuma8)
        }
        (Some(ColorType::CMYK(8)), Ok(DecodingResult::U8(buf))) => {
            let total_pixels = (w as usize) * (h as usize);
            let mut rgb = vec![0u8; total_pixels * 3];
            rgb.par_chunks_exact_mut(3)
                .zip(buf.par_chunks_exact(4))
                .for_each(|(out, chunk)| {
                    let c = chunk[0] as u32;
                    let m = chunk[1] as u32;
                    let y = chunk[2] as u32;
                    let k = chunk[3] as u32;
                    let inv_k = 255 - k;
                    out[0] = (((255 - c) * inv_k) / 255) as u8;
                    out[1] = (((255 - m) * inv_k) / 255) as u8;
                    out[2] = (((255 - y) * inv_k) / 255) as u8;
                });
            RgbImage::from_raw(w, h, rgb).map(DynamicImage::ImageRgb8)
        }
        _ => None,
    };

    match dyn_img {
        Some(image) => Ok(Some(LoadedImageMeta {
            image,
            dpi_x,
            dpi_y,
            icc_profile,
            color_mode,
        })),
        None => Ok(None),
    }
}

fn read_tiff_dpi(decoder: &mut Decoder<BufReader<File>>, fallback_dpi: f64) -> (f64, f64) {
    let mut dpi_x = fallback_dpi;
    let mut dpi_y = fallback_dpi;

    let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
    if let Some(mut x) = read_rational_tag(decoder, Tag::XResolution) {
        if unit == 3 {
            x *= 2.54;
        }
        if x > 0.0 {
            dpi_x = x;
        }
    }
    if let Some(mut y) = read_rational_tag(decoder, Tag::YResolution) {
        if unit == 3 {
            y *= 2.54;
        }
        if y > 0.0 {
            dpi_y = y;
        }
    } else {
        dpi_y = dpi_x;
    }
    (dpi_x, dpi_y)
}

/// Lê apenas dimensões (px) e DPI do cabeçalho sem decodificar os pixels da imagem.
pub fn read_image_dimensions_and_dpi(
    path: &Path,
    fallback_dpi: f64,
) -> Result<(u32, u32, f64, f64), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "tif" || ext == "tiff" {
        let file = File::open(path).map_err(|e| format!("Erro ao abrir TIFF: {e}"))?;
        let mut decoder = Decoder::new(BufReader::with_capacity(64 * 1024, file))
            .map_err(|e| format!("Erro ao ler cabeçalho TIFF: {e}"))?
            .with_limits(Limits::unlimited());
        let (dpi_x, dpi_y) = read_tiff_dpi(&mut decoder, fallback_dpi);
        let (w, h) = decoder
            .dimensions()
            .map_err(|e| format!("Erro ao ler dimensões TIFF: {e}"))?;
        return Ok((w, h, dpi_x, dpi_y));
    }

    let (w, h) =
        image::image_dimensions(path).map_err(|e| format!("Erro ao ler dimensões da imagem: {e}"))?;
    Ok((w, h, fallback_dpi, fallback_dpi))
}

/// Carrega imagem (TIFF ou PNG/JPEG) abrindo TIFF em passada única quando possível.
pub fn load_image_with_meta(path: &Path, fallback_dpi: f64) -> Result<LoadedImageMeta, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut dpi_x = fallback_dpi;
    let mut dpi_y = fallback_dpi;
    let mut icc_profile: Option<Vec<u8>> = None;
    let mut color_mode = "RGB".to_string();

    if ext == "tif" || ext == "tiff" {
        if let Ok(Some(meta)) = decode_tiff_single_open(path, fallback_dpi) {
            return Ok(meta);
        }
        // Fallback para formatos TIFF menos comuns (ex: 16-bit/paleta)
        if let Ok(file) = File::open(path) {
            if let Ok(mut decoder) =
                Decoder::new(BufReader::new(file)).map(|d| d.with_limits(Limits::unlimited()))
            {
                let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
                if let Some(mut x) = read_rational_tag(&mut decoder, Tag::XResolution) {
                    if unit == 3 {
                        x *= 2.54;
                    }
                    if x > 0.0 {
                        dpi_x = x;
                    }
                }
                if let Some(mut y) = read_rational_tag(&mut decoder, Tag::YResolution) {
                    if unit == 3 {
                        y *= 2.54;
                    }
                    if y > 0.0 {
                        dpi_y = y;
                    }
                } else {
                    dpi_y = dpi_x;
                }
                if let Ok(bytes) = decoder.get_tag_u8_vec(Tag::Unknown(34675)) {
                    if !bytes.is_empty() {
                        icc_profile = Some(bytes);
                    }
                }
                if let Ok(ct) = decoder.colortype() {
                    color_mode = format!("{ct:?}");
                }
            }
        }
    }

    let img = image::ImageReader::open(path)
        .map_err(|e| format!("Erro ao abrir imagem: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Formato inválido: {e}"))?
        .decode()
        .map_err(|e| format!("Erro ao decodificar imagem: {e}"))?;

    Ok(LoadedImageMeta {
        image: img,
        dpi_x,
        dpi_y,
        icc_profile,
        color_mode,
    })
}

/// Salva imagem preservando DPI e perfil ICC (para TIFF usa compressão LZW).
pub fn save_image_with_meta(
    img: &DynamicImage,
    output_path: &Path,
    dpi_x: f64,
    dpi_y: f64,
    icc_profile: Option<&[u8]>,
) -> Result<(), String> {
    let ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "tif" || ext == "tiff" {
        let rgb = match img {
            DynamicImage::ImageRgb8(r) => r.clone(),
            other => other.to_rgb8(),
        };
        let (w, h) = rgb.dimensions();
        let file = File::create(output_path).map_err(|e| format!("Erro ao criar arquivo: {e}"))?;
        let buf_writer = BufWriter::with_capacity(8 * 1024 * 1024, file);
        let mut encoder = TiffEncoder::new(buf_writer)
            .map_err(|e| format!("Erro ao iniciar encoder TIFF: {e}"))?;
        let mut image_enc = encoder
            .new_image_with_compression::<colortype::RGB8, _>(w, h, Lzw)
            .map_err(|e| format!("Erro ao configurar TIFF LZW: {e}"))?;

        let rx_num = (dpi_x * 1000.0).round() as u32;
        let ry_num = (dpi_y * 1000.0).round() as u32;
        image_enc
            .encoder()
            .write_tag(Tag::ResolutionUnit, 2u16)
            .map_err(|e| format!("Erro tag ResolutionUnit: {e}"))?;
        image_enc
            .encoder()
            .write_tag(Tag::XResolution, tiff::encoder::Rational { n: rx_num, d: 1000 })
            .map_err(|e| format!("Erro tag XResolution: {e}"))?;
        image_enc
            .encoder()
            .write_tag(Tag::YResolution, tiff::encoder::Rational { n: ry_num, d: 1000 })
            .map_err(|e| format!("Erro tag YResolution: {e}"))?;

        if let Some(icc) = icc_profile {
            if !icc.is_empty() {
                image_enc
                    .encoder()
                    .write_tag(Tag::Unknown(34675), icc)
                    .map_err(|e| format!("Erro tag ICC: {e}"))?;
            }
        }

        image_enc
            .write_data(rgb.as_raw())
            .map_err(|e| format!("Erro ao gravar dados TIFF: {e}"))?;
        Ok(())
    } else {
        let fmt = ImageFormat::from_path(output_path).unwrap_or(ImageFormat::Png);
        img.save_with_format(output_path, fmt)
            .map_err(|e| format!("Erro ao salvar imagem: {e}"))
    }
}

/// Cópia rápida linha-a-linha paralela com Rayon de `src` para `dst` na posição `(ox, oy)`.
pub fn blit_rgb_fast(dst: &mut RgbImage, src: &RgbImage, ox: u32, oy: u32) {
    let (dw, dh) = dst.dimensions();
    let (sw, sh) = src.dimensions();
    if ox >= dw || oy >= dh || sw == 0 || sh == 0 {
        return;
    }
    let copy_w = sw.min(dw - ox) as usize;
    let copy_h = sh.min(dh - oy) as usize;
    let dst_stride = dw as usize * 3;
    let src_stride = sw as usize * 3;
    let row_bytes = copy_w * 3;

    let dst_raw = dst.as_mut();
    let src_raw = src.as_raw();

    if copy_h >= 128 {
        dst_raw
            .par_chunks_exact_mut(dst_stride)
            .skip(oy as usize)
            .take(copy_h)
            .zip(src_raw.par_chunks_exact(src_stride).take(copy_h))
            .for_each(|(d_line, s_line)| {
                let d_start = (ox as usize) * 3;
                d_line[d_start..d_start + row_bytes].copy_from_slice(&s_line[..row_bytes]);
            });
    } else {
        for y in 0..copy_h {
            let d_off = (oy as usize + y) * dst_stride + (ox as usize) * 3;
            let s_off = y * src_stride;
            dst_raw[d_off..d_off + row_bytes].copy_from_slice(&src_raw[s_off..s_off + row_bytes]);
        }
    }
}

/// Redimensionamento SIMD de alta velocidade para RgbImage.
pub fn resize_rgb_simd(src: &RgbImage, new_w: u32, new_h: u32) -> RgbImage {
    let (sw, sh) = src.dimensions();
    let nw = new_w.max(1);
    let nh = new_h.max(1);
    if sw == nw && sh == nh {
        return src.clone();
    }

    let Ok(src_img) = fr::images::ImageRef::new(sw, sh, src.as_raw(), fr::PixelType::U8x3) else {
        return DynamicImage::ImageRgb8(src.clone())
            .resize_exact(nw, nh, image::imageops::FilterType::Triangle)
            .to_rgb8();
    };
    let mut dst_img = fr::images::Image::new(nw, nh, fr::PixelType::U8x3);
    let mut resizer = fr::Resizer::new();
    let opts = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear));
    if resizer.resize(&src_img, &mut dst_img, &opts).is_ok() {
        if let Some(out) = RgbImage::from_raw(nw, nh, dst_img.into_vec()) {
            return out;
        }
    }
    DynamicImage::ImageRgb8(src.clone())
        .resize_exact(nw, nh, image::imageops::FilterType::Triangle)
        .to_rgb8()
}

/// Redimensionamento SIMD de alta velocidade para RgbaImage.
pub fn resize_rgba_simd(src: &RgbaImage, new_w: u32, new_h: u32) -> RgbaImage {
    let (sw, sh) = src.dimensions();
    let nw = new_w.max(1);
    let nh = new_h.max(1);
    if sw == nw && sh == nh {
        return src.clone();
    }

    let Ok(src_img) = fr::images::ImageRef::new(sw, sh, src.as_raw(), fr::PixelType::U8x4) else {
        return DynamicImage::ImageRgba8(src.clone())
            .resize_exact(nw, nh, image::imageops::FilterType::Triangle)
            .to_rgba8();
    };
    let mut dst_img = fr::images::Image::new(nw, nh, fr::PixelType::U8x4);
    let mut resizer = fr::Resizer::new();
    let opts = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear));
    if resizer.resize(&src_img, &mut dst_img, &opts).is_ok() {
        if let Some(out) = RgbaImage::from_raw(nw, nh, dst_img.into_vec()) {
            return out;
        }
    }
    DynamicImage::ImageRgba8(src.clone())
        .resize_exact(nw, nh, image::imageops::FilterType::Triangle)
        .to_rgba8()
}

pub fn load_system_font_bytes() -> Option<&'static [u8]> {
    FONT_CACHE
        .get_or_init(|| {
            let candidates = [
                r"C:\Windows\Fonts\arialbd.ttf",
                r"C:\Windows\Fonts\arial.ttf",
                r"C:\Windows\Fonts\segoeui.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ];
            for c in candidates {
                if let Ok(bytes) = fs::read(c) {
                    return Some(bytes);
                }
            }
            None
        })
        .as_deref()
}

pub fn measure_text_px(font_bytes: &[u8], text: &str, scale_px: f32) -> (u32, u32) {
    let Ok(font) = FontRef::try_from_slice(font_bytes) else {
        return ((text.len() as f32 * scale_px * 0.55) as u32, scale_px as u32);
    };
    let scaled = font.as_scaled(PxScale::from(scale_px));
    let mut width = 0.0f32;
    let mut prev = None;
    for ch in text.chars() {
        let gid = scaled.glyph_id(ch);
        if let Some(p) = prev {
            width += scaled.kern(p, gid);
        }
        width += scaled.h_advance(gid);
        prev = Some(gid);
    }
    let height = scaled.ascent() - scaled.descent();
    (width.ceil().max(1.0) as u32, height.ceil().max(1.0) as u32)
}

pub fn draw_text_rgb(
    img: &mut RgbImage,
    font_bytes: Option<&[u8]>,
    text: &str,
    x: i32,
    y: i32,
    scale_px: f32,
    color: Rgb<u8>,
) {
    let Some(bytes) = font_bytes else { return };
    let Ok(font) = FontRef::try_from_slice(bytes) else {
        return;
    };
    draw_text_mut(img, color, x, y, PxScale::from(scale_px.max(1.0)), &font, text);
}

pub fn paste_rgba_onto_rgb(dst: &mut RgbImage, src: &RgbaImage, ox: i64, oy: i64) {
    let (dw, dh) = dst.dimensions();
    let (sw, sh) = src.dimensions();
    for sy in 0..sh {
        let dy = oy + sy as i64;
        if dy < 0 || dy >= dh as i64 {
            continue;
        }
        for sx in 0..sw {
            let dx = ox + sx as i64;
            if dx < 0 || dx >= dw as i64 {
                continue;
            }
            let Rgba([r, g, b, a]) = *src.get_pixel(sx, sy);
            if a == 255 {
                dst.put_pixel(dx as u32, dy as u32, Rgb([r, g, b]));
            } else if a > 0 {
                let dst_p = dst.get_pixel(dx as u32, dy as u32);
                let alpha = a as f32 / 255.0;
                let inv = 1.0 - alpha;
                dst.put_pixel(
                    dx as u32,
                    dy as u32,
                    Rgb([
                        (r as f32 * alpha + dst_p[0] as f32 * inv).round() as u8,
                        (g as f32 * alpha + dst_p[1] as f32 * inv).round() as u8,
                        (b as f32 * alpha + dst_p[2] as f32 * inv).round() as u8,
                    ]),
                );
            }
        }
    }
}

pub fn add_1px_black_border_inside_inplace(img: &mut RgbImage) {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return;
    }
    let black = Rgb([0, 0, 0]);
    for x in 0..w {
        img.put_pixel(x, 0, black);
        img.put_pixel(x, h - 1, black);
    }
    for y in 0..h {
        img.put_pixel(0, y, black);
        img.put_pixel(w - 1, y, black);
    }
}

#[allow(dead_code)]
pub fn add_1px_black_border_inside(img: &RgbImage) -> RgbImage {
    let mut out = img.clone();
    add_1px_black_border_inside_inplace(&mut out);
    out
}

pub fn parse_hex_color(hex: &str) -> Rgb<u8> {
    let s = hex.trim().trim_start_matches('#');
    if s.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&s[0..2], 16),
            u8::from_str_radix(&s[2..4], 16),
            u8::from_str_radix(&s[4..6], 16),
        ) {
            return Rgb([r, g, b]);
        }
    }
    match hex.to_lowercase().as_str() {
        "black" => Rgb([0, 0, 0]),
        "blue" => Rgb([0, 0, 255]),
        "purple" => Rgb([128, 0, 128]),
        "red" => Rgb([255, 0, 0]),
        "green" => Rgb([0, 128, 0]),
        _ => Rgb([0, 0, 0]),
    }
}

/// Rotação de 90 graus anti-horário (equivalente a rotate270()) paralela em blocos de 64x64.
pub fn rotate270_rgb_fast(src: &RgbImage) -> RgbImage {
    let (sw, sh) = src.dimensions();
    let dw = sh;
    let dh = sw;
    let mut dst = RgbImage::new(dw, dh);

    let src_stride = (sw as usize) * 3;
    let dst_stride = (dw as usize) * 3;
    let src_raw = src.as_raw();
    let dst_raw = dst.as_mut();

    const TILE: usize = 64;
    let ty_count = ((sh as usize) + TILE - 1) / TILE;
    let tx_count = ((sw as usize) + TILE - 1) / TILE;

    (0..ty_count).into_par_iter().for_each(|ty_idx| {
        let sy_start = ty_idx * TILE;
        let sy_end = (sy_start + TILE).min(sh as usize);

        for tx_idx in 0..tx_count {
            let sx_start = tx_idx * TILE;
            let sx_end = (sx_start + TILE).min(sw as usize);

            for sy in sy_start..sy_end {
                let s_row = sy * src_stride;
                for sx in sx_start..sx_end {
                    let s_off = s_row + sx * 3;
                    // Em 270 anti-horário: (dx, dy) = (sy, sw - 1 - sx)
                    let dx = sy;
                    let dy = (sw as usize) - 1 - sx;
                    let d_off = dy * dst_stride + dx * 3;

                    unsafe {
                        let dst_ptr = dst_raw.as_ptr() as *mut u8;
                        *dst_ptr.add(d_off) = src_raw[s_off];
                        *dst_ptr.add(d_off + 1) = src_raw[s_off + 1];
                        *dst_ptr.add(d_off + 2) = src_raw[s_off + 2];
                    }
                }
            }
        }
    });

    dst
}

/// Rotação de 90 graus horário (rotate90) paralela em blocos de 64x64.
pub fn rotate90_rgb_fast(src: &RgbImage) -> RgbImage {
    let (sw, sh) = src.dimensions();
    let dw = sh;
    let dh = sw;
    let mut dst = RgbImage::new(dw, dh);

    let src_stride = (sw as usize) * 3;
    let dst_stride = (dw as usize) * 3;
    let src_raw = src.as_raw();
    let dst_raw = dst.as_mut();

    const TILE: usize = 64;
    let ty_count = ((sh as usize) + TILE - 1) / TILE;
    let tx_count = ((sw as usize) + TILE - 1) / TILE;

    (0..ty_count).into_par_iter().for_each(|ty_idx| {
        let sy_start = ty_idx * TILE;
        let sy_end = (sy_start + TILE).min(sh as usize);

        for tx_idx in 0..tx_count {
            let sx_start = tx_idx * TILE;
            let sx_end = (sx_start + TILE).min(sw as usize);

            for sy in sy_start..sy_end {
                let s_row = sy * src_stride;
                for sx in sx_start..sx_end {
                    let s_off = s_row + sx * 3;
                    // Em 90 horário: (dx, dy) = (sh - 1 - sy, sx)
                    let dx = (sh as usize) - 1 - sy;
                    let dy = sx;
                    let d_off = dy * dst_stride + dx * 3;

                    unsafe {
                        let dst_ptr = dst_raw.as_ptr() as *mut u8;
                        *dst_ptr.add(d_off) = src_raw[s_off];
                        *dst_ptr.add(d_off + 1) = src_raw[s_off + 1];
                        *dst_ptr.add(d_off + 2) = src_raw[s_off + 2];
                    }
                }
            }
        }
    });

    dst
}

pub fn image_to_base64_png_thumb(img: &DynamicImage, max_side: u32) -> Option<String> {
    use base64::Engine;
    let (w, h) = (img.width(), img.height());
    let (nw, nh) = if w >= h {
        (max_side, ((h as f64 * max_side as f64) / w.max(1) as f64).round().max(1.0) as u32)
    } else {
        (((w as f64 * max_side as f64) / h.max(1) as f64).round().max(1.0) as u32, max_side)
    };
    let thumb = DynamicImage::ImageRgb8(resize_rgb_simd(&img.to_rgb8(), nw, nh));
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb.write_to(&mut buf, ImageFormat::Png).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
}
