use fast_image_resize as fr;
use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ImageFingerprint {
    pub dhash: u64,
    pub color_grid: [[u8; 3]; 16], // 4x4 grid com média RGB
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilaridadeResultado {
    pub caminho: String,
    pub score: f32, // 0.0 a 100.0%
}

/// Extrai a assinatura visual (dHash 64-bit + Color Grid 4x4)
pub fn extrair_fingerprint(img: &DynamicImage) -> Option<ImageFingerprint> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return None;
    }

    // 1. dHash: Redimensiona para 9x8 em tons de cinza
    let gray = img.to_luma8();
    let (gw, gh) = gray.dimensions();
    let src_gray = fr::images::ImageRef::new(gw, gh, gray.as_raw(), fr::PixelType::U8).ok()?;
    let mut dst_gray = fr::images::Image::new(9, 8, fr::PixelType::U8);
    let mut resizer = fr::Resizer::new();
    let opts = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Nearest);
    resizer.resize(&src_gray, &mut dst_gray, Some(&opts)).ok()?;
    let gray_9x8 = dst_gray.into_vec();

    let mut dhash: u64 = 0;
    let mut bit_idx = 0;
    for y in 0..8 {
        for x in 0..8 {
            let left = gray_9x8[y * 9 + x];
            let right = gray_9x8[y * 9 + x + 1];
            if left > right {
                dhash |= 1 << bit_idx;
            }
            bit_idx += 1;
        }
    }

    // 2. Color Grid: Redimensiona para 4x4 RGB
    let rgb = img.to_rgb8();
    let (rw, rh) = rgb.dimensions();
    let src_rgb = fr::images::ImageRef::new(rw, rh, rgb.as_raw(), fr::PixelType::U8x3).ok()?;
    let mut dst_rgb = fr::images::Image::new(4, 4, fr::PixelType::U8x3);
    resizer.resize(&src_rgb, &mut dst_rgb, Some(&opts)).ok()?;
    let rgb_4x4 = dst_rgb.into_vec();

    let mut color_grid = [[0u8; 3]; 16];
    for i in 0..16 {
        color_grid[i] = [rgb_4x4[i * 3], rgb_4x4[i * 3 + 1], rgb_4x4[i * 3 + 2]];
    }

    Some(ImageFingerprint { dhash, color_grid })
}

/// Calcula a porcentagem de similaridade entre duas impressões visuais (0.0 a 100.0%)
pub fn calcular_similaridade(a: &ImageFingerprint, b: &ImageFingerprint) -> f32 {
    // Similaridade estrutural via distância de Hamming (dHash 64 bits)
    let hamming = (a.dhash ^ b.dhash).count_ones();
    let score_estrutura = (64.0 - hamming as f32) / 64.0; // 0.0 a 1.0

    // Similaridade de cor via distância euclidiana média dos 16 blocos RGB
    let mut diff_cor_total = 0.0f32;
    for i in 0..16 {
        let dr = (a.color_grid[i][0] as f32) - (b.color_grid[i][0] as f32);
        let dg = (a.color_grid[i][1] as f32) - (b.color_grid[i][1] as f32);
        let db = (a.color_grid[i][2] as f32) - (b.color_grid[i][2] as f32);
        let dist = (dr * dr + dg * dg + db * db).sqrt();
        diff_cor_total += dist;
    }
    let max_dist = 441.67f32 * 16.0; // sqrt(255^2 * 3) * 16
    let score_cor = (1.0 - (diff_cor_total / max_dist)).max(0.0);

    // Peso: 55% estrutura visual / contornos + 45% paleta de cores
    let score_final = (score_estrutura * 0.55 + score_cor * 0.45) * 100.0;
    (score_final * 10.0).round() / 10.0
}

/// Carrega imagem a partir de caminho no disco ou base64 data-url
pub fn carregar_imagem_referencia(fonte: &str) -> Result<DynamicImage, String> {
    if fonte.starts_with("data:image/") {
        let comma_idx = fonte.find(',').ok_or("Data URL inválida: sem vírgula")?;
        let base64_str = &fonte[comma_idx + 1..];
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let bytes = BASE64
            .decode(base64_str.trim())
            .map_err(|e| format!("Erro ao decodificar base64: {e}"))?;
        image::load_from_memory(&bytes).map_err(|e| format!("Erro ao decodificar imagem: {e}"))
    } else {
        let p = Path::new(fonte);
        if !p.is_file() {
            return Err("Arquivo de imagem de referência não encontrado.".to_string());
        }
        image::open(p).map_err(|e| format!("Erro ao abrir imagem de referência: {e}"))
    }
}
