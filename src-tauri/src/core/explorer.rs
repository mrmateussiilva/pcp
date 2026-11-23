use crate::core::imaging::{px_to_cm, DPI_FALLBACK};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Local};
use fast_image_resize as fr;
use image::codecs::jpeg::JpegEncoder;
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Cursor};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tiff::decoder::{Decoder, Limits};
use tiff::tags::Tag;

static PREVIEW_CACHE: OnceLock<Mutex<HashMap<String, (u64, u64, ImagemPreviewInfo)>>> =
    OnceLock::new();
static HEAVY_DECODE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn get_preview_cache() -> &'static Mutex<HashMap<String, (u64, u64, ImagemPreviewInfo)>> {
    PREVIEW_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_heavy_decode_lock() -> &'static Mutex<()> {
    HEAVY_DECODE_LOCK.get_or_init(|| Mutex::new(()))
}

fn thumb_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("pcp-central")
        .join("thumbcache")
}

fn thumb_cache_key(caminho: &str, tamanho: u64, mtime_ms: u64) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h1 = DefaultHasher::new();
    caminho.to_lowercase().hash(&mut h1);
    let k1 = h1.finish();

    let mut h2 = DefaultHasher::new();
    (tamanho, mtime_ms).hash(&mut h2);
    let k2 = h2.finish();

    format!("{:016x}_{:016x}", k1, k2)
}

fn tentar_ler_cache_disco(key: &str) -> Option<ImagemPreviewInfo> {
    let dir = thumb_cache_dir();
    let json_path = dir.join(format!("{key}.json"));
    let jpg_path = dir.join(format!("{key}.jpg"));

    if !json_path.is_file() || !jpg_path.is_file() {
        return None;
    }

    let meta_str = fs::read_to_string(&json_path).ok()?;
    let mut info: ImagemPreviewInfo = serde_json::from_str(&meta_str).ok()?;

    let jpg_bytes = fs::read(&jpg_path).ok()?;
    info.miniatura_data_url = Some(format!("data:image/jpeg;base64,{}", BASE64.encode(&jpg_bytes)));
    Some(info)
}

fn salvar_em_cache_disco(key: &str, info: &ImagemPreviewInfo, jpg_bytes: &[u8]) {
    let dir = thumb_cache_dir();
    if let Err(_) = fs::create_dir_all(&dir) {
        return;
    }
    let json_path = dir.join(format!("{key}.json"));
    let jpg_path = dir.join(format!("{key}.jpg"));

    let mut meta_info = info.clone();
    meta_info.miniatura_data_url = None;
    if let Ok(json_str) = serde_json::to_string(&meta_info) {
        let _ = fs::write(&json_path, json_str);
    }
    let _ = fs::write(&jpg_path, jpg_bytes);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerConfig {
    #[serde(default)]
    pub favoritos: Vec<String>,
    #[serde(default = "default_modo_visao")]
    pub modo_visao: String, // "lista" | "grade"
    #[serde(default)]
    pub mostrar_ocultos: bool,
    #[serde(default = "default_true")]
    pub mostrar_preview: bool,
    #[serde(default)]
    pub ultima_pasta: Option<String>,
}

fn default_modo_visao() -> String {
    "grade".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for ExplorerConfig {
    fn default() -> Self {
        Self {
            favoritos: Vec::new(),
            modo_visao: default_modo_visao(),
            mostrar_ocultos: false,
            mostrar_preview: true,
            ultima_pasta: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerRaiz {
    pub nome: String,
    pub caminho: String,
    pub grupo: String, // "pcp" | "usuario" | "unidade"
    pub icone: String, // "calendar" | "harddrive" | "home" | "desktop" | "download" | "folder"
    pub existe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreadcrumbItem {
    pub nome: String,
    pub caminho: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerItem {
    pub nome: String,
    pub caminho: String,
    pub eh_pasta: bool,
    pub extensao: String,
    pub tamanho_bytes: u64,
    pub modificado_ms: i64,
    pub modificado_fmt: String,
    pub oculto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplorerListagem {
    pub caminho: String,
    pub pai: Option<String>,
    pub breadcrumbs: Vec<BreadcrumbItem>,
    pub itens: Vec<ExplorerItem>,
    pub total_pastas: usize,
    pub total_arquivos: usize,
    pub tamanho_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperacaoResultado {
    pub ok: usize,
    pub falhas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagemPreviewInfo {
    pub largura_px: u32,
    pub altura_px: u32,
    pub dpi_x: f64,
    pub dpi_y: f64,
    pub largura_cm: f64,
    pub altura_cm: f64,
    pub modo_cor: String,
    pub tem_icc: bool,
    pub miniatura_data_url: Option<String>,
}

/// Lista unidades montadas, pastas do usuário e atalhos PCP (Drive Base + Pasta do Dia).
pub fn listar_raizes(base_pcp: &str, pasta_dia: &Path) -> Vec<ExplorerRaiz> {
    let mut raizes = Vec::new();

    // 1. Atalhos PCP
    let dia_str = pasta_dia.to_string_lossy().to_string();
    raizes.push(ExplorerRaiz {
        nome: "Pasta do Dia".to_string(),
        caminho: dia_str,
        grupo: "pcp".to_string(),
        icone: "calendar".to_string(),
        existe: pasta_dia.exists(),
    });

    let base_path = Path::new(base_pcp);
    raizes.push(ExplorerRaiz {
        nome: format!("Base ({})", base_pcp.trim_end_matches(['\\', '/'])),
        caminho: base_pcp.to_string(),
        grupo: "pcp".to_string(),
        icone: "harddrive".to_string(),
        existe: base_path.exists(),
    });

    // 2. Pastas do usuário
    if let Some(p) = dirs::desktop_dir() {
        raizes.push(ExplorerRaiz {
            nome: "Área de Trabalho".to_string(),
            caminho: p.to_string_lossy().to_string(),
            grupo: "usuario".to_string(),
            icone: "desktop".to_string(),
            existe: p.exists(),
        });
    }
    if let Some(p) = dirs::download_dir() {
        raizes.push(ExplorerRaiz {
            nome: "Downloads".to_string(),
            caminho: p.to_string_lossy().to_string(),
            grupo: "usuario".to_string(),
            icone: "download".to_string(),
            existe: p.exists(),
        });
    }
    if let Some(p) = dirs::document_dir() {
        raizes.push(ExplorerRaiz {
            nome: "Documentos".to_string(),
            caminho: p.to_string_lossy().to_string(),
            grupo: "usuario".to_string(),
            icone: "folder".to_string(),
            existe: p.exists(),
        });
    }
    if let Some(p) = dirs::picture_dir() {
        raizes.push(ExplorerRaiz {
            nome: "Imagens".to_string(),
            caminho: p.to_string_lossy().to_string(),
            grupo: "usuario".to_string(),
            icone: "image".to_string(),
            existe: p.exists(),
        });
    }
    if let Some(p) = dirs::home_dir() {
        raizes.push(ExplorerRaiz {
            nome: "Usuário (Home)".to_string(),
            caminho: p.to_string_lossy().to_string(),
            grupo: "usuario".to_string(),
            icone: "home".to_string(),
            existe: p.exists(),
        });
    }

    // 3. Unidades do sistema
    #[cfg(windows)]
    {
        for letra in b'A'..=b'Z' {
            let unidade = format!("{}:\\", letra as char);
            let p = Path::new(&unidade);
            if p.exists() {
                raizes.push(ExplorerRaiz {
                    nome: format!("Disco ({}:)", letra as char),
                    caminho: unidade,
                    grupo: "unidade".to_string(),
                    icone: "harddrive".to_string(),
                    existe: true,
                });
            }
        }
    }

    #[cfg(not(windows))]
    {
        raizes.push(ExplorerRaiz {
            nome: "Raiz (/)".to_string(),
            caminho: "/".to_string(),
            grupo: "unidade".to_string(),
            icone: "harddrive".to_string(),
            existe: true,
        });

        for mount_root in ["/mnt", "/media"] {
            let mp = Path::new(mount_root);
            if let Ok(entries) = fs::read_dir(mp) {
                for entry in entries.flatten() {
                    let ep = entry.path();
                    if !ep.is_dir() {
                        continue;
                    }
                    // Em /media/$USER/*, listar os volumes internos se existirem
                    if mount_root == "/media" {
                        if let Ok(sub) = fs::read_dir(&ep) {
                            let mut achou_sub = false;
                            for s in sub.flatten() {
                                if s.path().is_dir() {
                                    achou_sub = true;
                                    let nome = s.file_name().to_string_lossy().to_string();
                                    raizes.push(ExplorerRaiz {
                                        nome,
                                        caminho: s.path().to_string_lossy().to_string(),
                                        grupo: "unidade".to_string(),
                                        icone: "harddrive".to_string(),
                                        existe: true,
                                    });
                                }
                            }
                            if achou_sub {
                                continue;
                            }
                        }
                    }
                    let nome = entry.file_name().to_string_lossy().to_string();
                    raizes.push(ExplorerRaiz {
                        nome: format!("{mount_root}/{nome}"),
                        caminho: ep.to_string_lossy().to_string(),
                        grupo: "unidade".to_string(),
                        icone: "harddrive".to_string(),
                        existe: true,
                    });
                }
            }
        }
    }

    raizes
}

fn montar_breadcrumbs(path: &Path) -> Vec<BreadcrumbItem> {
    let mut crumbs = Vec::new();
    let mut acumulado = PathBuf::new();

    for comp in path.components() {
        match comp {
            Component::Prefix(prefix) => {
                acumulado.push(prefix.as_os_str());
                let nome = prefix.as_os_str().to_string_lossy().to_string();
                let mut com_barra = acumulado.clone();
                com_barra.push(std::path::MAIN_SEPARATOR.to_string());
                crumbs.push(BreadcrumbItem {
                    nome,
                    caminho: com_barra.to_string_lossy().to_string(),
                });
            }
            Component::RootDir => {
                acumulado.push(comp.as_os_str());
                if crumbs.is_empty() {
                    crumbs.push(BreadcrumbItem {
                        nome: "/".to_string(),
                        caminho: "/".to_string(),
                    });
                }
            }
            Component::Normal(part) => {
                acumulado.push(part);
                crumbs.push(BreadcrumbItem {
                    nome: part.to_string_lossy().to_string(),
                    caminho: acumulado.to_string_lossy().to_string(),
                });
            }
            _ => {}
        }
    }

    crumbs
}

#[cfg(windows)]
fn is_hidden(path: &Path, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    let name_hidden = path
        .file_name()
        .map(|n| n.to_string_lossy().starts_with('.'))
        .unwrap_or(false);
    name_hidden || (meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN) != 0
}

#[cfg(not(windows))]
fn is_hidden(path: &Path, _meta: &fs::Metadata) -> bool {
    path.file_name()
        .map(|n| n.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

pub fn listar_diretorio(caminho: &str, mostrar_ocultos: bool) -> Result<ExplorerListagem, String> {
    let raw = PathBuf::from(caminho.trim());
    if !raw.exists() {
        return Err(format!("Caminho não encontrado: {caminho}"));
    }
    if !raw.is_dir() {
        return Err(format!("O caminho não é uma pasta: {caminho}"));
    }

    // Evita prefixo \\?\ no Windows mantendo caminho limpo
    let dir_path = {
        let canon = fs::canonicalize(&raw).unwrap_or(raw);
        let s = canon.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{stripped}"))
        } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
            PathBuf::from(stripped)
        } else {
            canon
        }
    };

    let entries =
        fs::read_dir(&dir_path).map_err(|e| format!("Não foi possível abrir a pasta: {e}"))?;

    let mut itens = Vec::new();
    let mut total_pastas = 0usize;
    let mut total_arquivos = 0usize;
    let mut tamanho_total = 0u64;

    for entry in entries.flatten() {
        let ep = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let oculto = is_hidden(&ep, &meta);
        if oculto && !mostrar_ocultos {
            continue;
        }

        let eh_pasta = meta.is_dir();
        let nome = entry.file_name().to_string_lossy().to_string();
        let extensao = if eh_pasta {
            String::new()
        } else {
            ep.extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        };

        let tamanho_bytes = if eh_pasta { 0 } else { meta.len() };
        let (modificado_ms, modificado_fmt) = meta
            .modified()
            .ok()
            .and_then(|st| {
                let dur = st.duration_since(UNIX_EPOCH).ok()?;
                let dt: DateTime<Local> = st.into();
                Some((
                    dur.as_millis() as i64,
                    dt.format("%d/%m/%Y %H:%M").to_string(),
                ))
            })
            .unwrap_or((0, "—".to_string()));

        if eh_pasta {
            total_pastas += 1;
        } else {
            total_arquivos += 1;
            tamanho_total = tamanho_total.saturating_add(tamanho_bytes);
        }

        itens.push(ExplorerItem {
            nome,
            caminho: ep.to_string_lossy().to_string(),
            eh_pasta,
            extensao,
            tamanho_bytes,
            modificado_ms,
            modificado_fmt,
            oculto,
        });
    }

    // Ordenação padrão estilo Windows: pastas primeiro, depois arquivos (A-Z case-insensitive)
    itens.sort_by(|a, b| {
        b.eh_pasta
            .cmp(&a.eh_pasta)
            .then_with(|| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()))
    });

    let pai = dir_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string());

    let breadcrumbs = montar_breadcrumbs(&dir_path);

    Ok(ExplorerListagem {
        caminho: dir_path.to_string_lossy().to_string(),
        pai,
        breadcrumbs,
        itens,
        total_pastas,
        total_arquivos,
        tamanho_total,
    })
}

pub fn criar_pasta(pai: &str, nome: &str) -> Result<String, String> {
    let limpo = nome.trim();
    if limpo.is_empty() || limpo.contains(['/', '\\']) || limpo == "." || limpo == ".." {
        return Err("Nome de pasta inválido.".to_string());
    }
    let destino = Path::new(pai).join(limpo);
    if destino.exists() {
        return Err(format!("Já existe um item chamado '{limpo}'."));
    }
    fs::create_dir(&destino).map_err(|e| format!("Erro ao criar pasta: {e}"))?;
    Ok(destino.to_string_lossy().to_string())
}

pub fn renomear_item(caminho: &str, novo_nome: &str) -> Result<String, String> {
    let limpo = novo_nome.trim();
    if limpo.is_empty() || limpo.contains(['/', '\\']) || limpo == "." || limpo == ".." {
        return Err("Nome inválido.".to_string());
    }
    let origem = Path::new(caminho);
    let pai = origem
        .parent()
        .ok_or_else(|| "Não é possível renomear o diretório raiz.".to_string())?;
    let destino = pai.join(limpo);
    if destino == origem {
        return Ok(caminho.to_string());
    }
    if destino.exists() {
        return Err(format!("Já existe um item chamado '{limpo}'."));
    }
    fs::rename(origem, &destino).map_err(|e| format!("Erro ao renomear: {e}"))?;
    Ok(destino.to_string_lossy().to_string())
}

pub fn excluir_itens(caminhos: &[String]) -> OperacaoResultado {
    let mut ok = 0usize;
    let mut falhas = Vec::new();
    for c in caminhos {
        let p = Path::new(c);
        let res = if p.is_dir() {
            fs::remove_dir_all(p)
        } else {
            fs::remove_file(p)
        };
        match res {
            Ok(_) => ok += 1,
            Err(e) => {
                let nome = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| c.clone());
                falhas.push(format!("{nome}: {e}"));
            }
        }
    }
    OperacaoResultado { ok, falhas }
}

fn resolver_conflito_nome(destino_dir: &Path, nome: &str, eh_pasta: bool) -> PathBuf {
    let candidato = destino_dir.join(nome);
    if !candidato.exists() {
        return candidato;
    }

    let (stem, ext) = if eh_pasta {
        (nome.to_string(), String::new())
    } else {
        let p = Path::new(nome);
        let s = p
            .file_stem()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_else(|| nome.to_string());
        let e = p
            .extension()
            .map(|x| format!(".{}", x.to_string_lossy()))
            .unwrap_or_default();
        (s, e)
    };

    for i in 1..=999 {
        let sufixo = if i == 1 {
            " - Copia".to_string()
        } else {
            format!(" - Copia ({i})")
        };
        let tentativa = destino_dir.join(format!("{stem}{sufixo}{ext}"));
        if !tentativa.exists() {
            return tentativa;
        }
    }
    destino_dir.join(format!("{stem}_{}{ext}", chrono::Local::now().timestamp()))
}

fn copiar_dir_recursivo(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Erro ao criar pasta destino: {e}"))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Erro ao ler pasta origem: {e}"))?;
    for entry in entries.flatten() {
        let ep = entry.path();
        let target = dst.join(entry.file_name());
        if ep.is_dir() {
            copiar_dir_recursivo(&ep, &target)?;
        } else {
            fs::copy(&ep, &target).map_err(|e| format!("Erro ao copiar arquivo: {e}"))?;
        }
    }
    Ok(())
}

pub fn copiar_ou_mover_itens(
    origens: &[String],
    destino_dir: &str,
    mover: bool,
) -> OperacaoResultado {
    let dst_root = Path::new(destino_dir);
    let mut ok = 0usize;
    let mut falhas = Vec::new();

    if !dst_root.is_dir() {
        return OperacaoResultado {
            ok: 0,
            falhas: vec!["Pasta de destino inválida.".to_string()],
        };
    }

    for c in origens {
        let src = Path::new(c);
        let nome = match src.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => {
                falhas.push(format!("{c}: caminho inválido"));
                continue;
            }
        };

        // Impede copiar/mover pasta para dentro de si mesma
        if src.is_dir() && dst_root.starts_with(src) {
            falhas.push(format!("{nome}: não é possível colar uma pasta dentro dela mesma"));
            continue;
        }

        let eh_pasta = src.is_dir();

        if mover {
            let mut alvo = dst_root.join(&nome);
            if alvo == src {
                ok += 1;
                continue;
            }
            if alvo.exists() {
                alvo = resolver_conflito_nome(dst_root, &nome, eh_pasta);
            }
            match fs::rename(src, &alvo) {
                Ok(_) => ok += 1,
                Err(_) => {
                    // Fallback cross-device (ex: C:\ -> Z:\)
                    let res = if eh_pasta {
                        copiar_dir_recursivo(src, &alvo)
                            .and_then(|_| fs::remove_dir_all(src).map_err(|e| e.to_string()))
                    } else {
                        fs::copy(src, &alvo)
                            .map_err(|e| e.to_string())
                            .and_then(|_| fs::remove_file(src).map_err(|e| e.to_string()))
                    };
                    match res {
                        Ok(_) => ok += 1,
                        Err(e) => falhas.push(format!("{nome}: {e}")),
                    }
                }
            }
        } else {
            let alvo = resolver_conflito_nome(dst_root, &nome, eh_pasta);
            let res = if eh_pasta {
                copiar_dir_recursivo(src, &alvo)
            } else {
                fs::copy(src, &alvo).map(|_| ()).map_err(|e| e.to_string())
            };
            match res {
                Ok(_) => ok += 1,
                Err(e) => falhas.push(format!("{nome}: {e}")),
            }
        }
    }

    OperacaoResultado { ok, falhas }
}

/// Abre o diretório no gerenciador de arquivos nativo do SO selecionando o item quando suportado.
pub fn revelar_no_sistema(caminho: &str) -> Result<(), String> {
    let p = Path::new(caminho);
    if !p.exists() {
        return Err("Caminho não encontrado.".to_string());
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        if p.is_dir() {
            Command::new("explorer")
                .arg(caminho)
                .spawn()
                .map_err(|e| format!("Erro ao abrir Explorer: {e}"))?;
        } else {
            Command::new("explorer")
                .arg(format!("/select,{caminho}"))
                .spawn()
                .map_err(|e| format!("Erro ao revelar arquivo no Explorer: {e}"))?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        use std::process::Command;
        let alvo = if p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(p)
        };
        Command::new("xdg-open")
            .arg(alvo)
            .spawn()
            .map_err(|e| format!("Erro ao abrir gerenciador de arquivos: {e}"))?;
        Ok(())
    }
}

fn read_tiff_rational(decoder: &mut Decoder<BufReader<File>>, tag: Tag) -> Option<f64> {
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

fn gerar_miniatura_rgb(rgb: &image::RgbImage, max_lado: u32) -> Option<(String, Vec<u8>)> {
    let (w, h) = rgb.dimensions();
    if w == 0 || h == 0 {
        return None;
    }

    let (nw, nh) = if w <= max_lado && h <= max_lado {
        (w, h)
    } else if w >= h {
        (max_lado, ((h as f64 * max_lado as f64) / w as f64).round().max(1.0) as u32)
    } else {
        (((w as f64 * max_lado as f64) / h as f64).round().max(1.0) as u32, max_lado)
    };

    let resized = if nw == w && nh == h {
        rgb.clone()
    } else {
        let src = fr::images::ImageRef::new(w, h, rgb.as_raw(), fr::PixelType::U8x3).ok()?;
        let mut dst = fr::images::Image::new(nw, nh, fr::PixelType::U8x3);
        let mut resizer = fr::Resizer::new();
        let opts = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear));
        resizer.resize(&src, &mut dst, Some(&opts)).ok()?;
        image::RgbImage::from_raw(nw, nh, dst.into_vec())?
    };

    let mut out = Cursor::new(Vec::new());
    let mut enc = JpegEncoder::new_with_quality(&mut out, 80);
    enc.encode(resized.as_raw(), nw, nh, image::ExtendedColorType::Rgb8)
        .ok()?;
    let bytes = out.into_inner();
    let data_url = format!("data:image/jpeg;base64,{}", BASE64.encode(&bytes));
    Some((data_url, bytes))
}

/// Tenta localizar uma miniatura JPEG já existente (ex: `_miniaturas/<stem>.jpg` ou bolsinha `<stem>.jpeg`)
/// para evitar decodificar centenas de MB via rede quando a miniatura já existe no diretório.
fn tentar_miniatura_existente(p: &Path, max_lado: u32) -> Option<(String, Vec<u8>)> {
    let parent = p.parent()?;
    let stem = p.file_stem()?.to_str()?;
    let candidatos = [
        parent.join("_miniaturas").join(format!("{stem}.jpg")),
        parent.join("BOLSINHAS").join("_miniaturas").join(format!("{stem}.jpg")),
        parent.join("BOLSINHAS").join(format!("{stem}.jpeg")),
        parent.join("BOLSINHAS").join(format!("{stem}.jpg")),
    ];
    for cand in candidatos {
        if cand.is_file() {
            if let Ok(img) = image::open(&cand) {
                let rgb = img.to_rgb8();
                if let Some(res) = gerar_miniatura_rgb(&rgb, max_lado) {
                    return Some(res);
                }
            }
        }
    }
    None
}

/// Extrai metadados técnicos (px, DPI, cm, modo de cor, ICC) e miniatura leve com cache persistente em SSD + RAM.
pub fn inspecionar_imagem(caminho: &str) -> Result<ImagemPreviewInfo, String> {
    let p = Path::new(caminho);
    if !p.is_file() {
        return Err("Arquivo não encontrado.".to_string());
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let meta = fs::metadata(p).map_err(|e| format!("Erro ao ler metadados: {e}"))?;
    let tamanho = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let cache_key = thumb_cache_key(caminho, tamanho, mtime_ms);

    // 1. Verifica cache em memória (retorno instantâneo)
    {
        let cache = get_preview_cache().lock().unwrap();
        if let Some((c_sz, c_mt, info)) = cache.get(caminho) {
            if *c_sz == tamanho && *c_mt == mtime_ms {
                return Ok(info.clone());
            }
        }
    }

    // 2. Verifica cache persistente no SSD local (zero leitura na rede Z:\ e zero alocação de RAM)
    if let Some(info_disco) = tentar_ler_cache_disco(&cache_key) {
        let mut cache = get_preview_cache().lock().unwrap();
        if cache.len() > 600 {
            cache.clear();
        }
        cache.insert(caminho.to_string(), (tamanho, mtime_ms, info_disco.clone()));
        return Ok(info_disco);
    }

    // 3. TIFF: leitura rápida apenas de cabeçalho + atalho de miniatura local ou decodificação com semáforo
    if ext == "tif" || ext == "tiff" {
        let file = File::open(p).map_err(|e| format!("Erro ao abrir TIFF: {e}"))?;
        let mut decoder = Decoder::new(BufReader::with_capacity(256 * 1024, file))
            .map_err(|e| format!("Cabeçalho TIFF inválido: {e}"))?
            .with_limits(Limits::unlimited());

        let (w, h) = decoder
            .dimensions()
            .map_err(|e| format!("Erro ao ler dimensões: {e}"))?;

        let mut dpi_x = DPI_FALLBACK;
        let mut dpi_y = DPI_FALLBACK;
        let unit = decoder.get_tag_u32(Tag::ResolutionUnit).unwrap_or(2);
        if let Some(mut x) = read_tiff_rational(&mut decoder, Tag::XResolution) {
            if unit == 3 {
                x *= 2.54;
            }
            if x > 0.0 {
                dpi_x = x;
            }
        }
        if let Some(mut y) = read_tiff_rational(&mut decoder, Tag::YResolution) {
            if unit == 3 {
                y *= 2.54;
            }
            if y > 0.0 {
                dpi_y = y;
            }
        } else {
            dpi_y = dpi_x;
        }

        let tem_icc = decoder
            .get_tag_u8_vec(Tag::Unknown(34675))
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        let modo_cor = decoder
            .colortype()
            .map(|c| format!("{c:?}"))
            .unwrap_or_else(|_| "RGB".to_string());

        drop(decoder);

        let (miniatura_data_url, jpg_bytes_opt) = if let Some((url, bytes)) = tentar_miniatura_existente(p, 280) {
            (Some(url), Some(bytes))
        } else if tamanho <= 450 * 1024 * 1024 {
            // Semáforo estrito: apenas 1 decodificação pesada por vez em todo o sistema
            let _guard = get_heavy_decode_lock().lock().unwrap();
            if let Ok(loaded) = crate::core::imaging::load_image_with_meta(p, DPI_FALLBACK) {
                let rgb = loaded.image.to_rgb8();
                drop(loaded); // libera a imagem TIFF gigante original imediatamente
                let thumb_res = gerar_miniatura_rgb(&rgb, 280);
                drop(rgb); // libera a matriz RGB da RAM imediatamente
                if let Some((url, bytes)) = thumb_res {
                    (Some(url), Some(bytes))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

        let info = ImagemPreviewInfo {
            largura_px: w,
            altura_px: h,
            dpi_x: (dpi_x * 10.0).round() / 10.0,
            dpi_y: (dpi_y * 10.0).round() / 10.0,
            largura_cm: px_to_cm(w, dpi_x),
            altura_cm: px_to_cm(h, dpi_y),
            modo_cor,
            tem_icc,
            miniatura_data_url,
        };

        if let Some(ref bytes) = jpg_bytes_opt {
            salvar_em_cache_disco(&cache_key, &info, bytes);
        }

        let mut cache = get_preview_cache().lock().unwrap();
        if cache.len() > 600 {
            cache.clear();
        }
        cache.insert(caminho.to_string(), (tamanho, mtime_ms, info.clone()));
        return Ok(info);
    }

    // 4. JPEG / PNG / etc.
    let (miniatura_data_url, jpg_bytes_opt, w, h, modo_cor) = {
        let dyn_img = image::open(p).map_err(|e| format!("Não foi possível ler imagem: {e}"))?;
        let (w, h) = dyn_img.dimensions();
        let modo_cor = format!("{:?}", dyn_img.color());
        let rgb = dyn_img.to_rgb8();
        drop(dyn_img);
        let res = gerar_miniatura_rgb(&rgb, 280);
        drop(rgb);
        let (url, bytes) = match res {
            Some((u, b)) => (Some(u), Some(b)),
            None => (None, None),
        };
        (url, bytes, w, h, modo_cor)
    };

    let info = ImagemPreviewInfo {
        largura_px: w,
        altura_px: h,
        dpi_x: 72.0,
        dpi_y: 72.0,
        largura_cm: px_to_cm(w, 72.0),
        altura_cm: px_to_cm(h, 72.0),
        modo_cor,
        tem_icc: false,
        miniatura_data_url,
    };

    if let Some(ref bytes) = jpg_bytes_opt {
        salvar_em_cache_disco(&cache_key, &info, bytes);
    }

    let mut cache = get_preview_cache().lock().unwrap();
    if cache.len() > 600 {
        cache.clear();
    }
    cache.insert(caminho.to_string(), (tamanho, mtime_ms, info.clone()));
    Ok(info)
}

