use chrono::{Local, NaiveDateTime, TimeZone};
use csv::{ReaderBuilder, WriterBuilder};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const GLOBAL_LOG_NAME: &str = "processados_global.tsv";
const LEGACY_LOG_FILENAME: &str = "processados.log";
const TOLERANCIA_MTIME: f64 = 2.0;
const FMT: &str = "%Y-%m-%d %H:%M:%S";

#[derive(Debug, Clone)]
struct Registro {
    tam_origem: Option<u64>,
    mtime_origem: Option<f64>,
    tam_saida: Option<u64>,
    mtime_saida: Option<f64>,
}

pub struct GlobalLog {
    path: PathBuf,
    lock: Mutex<LogState>,
}

struct LogState {
    registros: HashMap<String, Vec<Registro>>,
    legado: HashMap<PathBuf, HashSet<String>>,
}

fn chave(nome: &str) -> String {
    Path::new(nome)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn fmt_ts(ts: f64) -> String {
    let secs = ts.trunc() as i64;
    if let Some(dt) = Local.timestamp_opt(secs, 0).single() {
        dt.format(FMT).to_string()
    } else {
        String::new()
    }
}

fn parse_ts(txt: &str) -> Option<f64> {
    let trimmed = txt.trim();
    if trimmed.is_empty() {
        return None;
    }
    let naive = NaiveDateTime::parse_from_str(trimmed, FMT).ok()?;
    Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.timestamp() as f64)
}

fn bate(size: u64, mtime: f64, rec_size: Option<u64>, rec_mtime: Option<f64>) -> bool {
    match (rec_size, rec_mtime) {
        (Some(rs), Some(rm)) => size == rs && (mtime - rm).abs() <= TOLERANCIA_MTIME,
        _ => false,
    }
}

pub fn fingerprint(path: &Path) -> Result<(u64, f64), String> {
    let meta = fs::metadata(path).map_err(|e| format!("Erro stat {}: {e}", path.display()))?;
    let mtime = meta
        .modified()
        .map_err(|e| format!("Erro mtime: {e}"))?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    Ok((meta.len(), mtime))
}

impl GlobalLog {
    pub fn new() -> Self {
        let desktop = dirs::desktop_dir().unwrap_or_else(|| PathBuf::from("."));
        let path = desktop.join(GLOBAL_LOG_NAME);
        let mut registros: HashMap<String, Vec<Registro>> = HashMap::new();

        if path.exists() {
            if let Ok(mut rdr) = ReaderBuilder::new()
                .delimiter(b'\t')
                .has_headers(true)
                .flexible(true)
                .from_path(&path)
            {
                for rec in rdr.records().flatten() {
                    let status = rec.get(1).unwrap_or("");
                    if status != "PROCESSADO" {
                        continue;
                    }
                    let arquivo = rec.get(2).unwrap_or("");
                    if arquivo.is_empty() {
                        continue;
                    }
                    let item = Registro {
                        tam_origem: rec.get(3).and_then(|s| s.trim().parse().ok()),
                        mtime_origem: rec.get(4).and_then(parse_ts),
                        tam_saida: rec.get(5).and_then(|s| s.trim().parse().ok()),
                        mtime_saida: rec.get(6).and_then(parse_ts),
                    };
                    registros.entry(chave(arquivo)).or_default().push(item);
                }
            }
        }

        Self {
            path,
            lock: Mutex::new(LogState {
                registros,
                legado: HashMap::new(),
            }),
        }
    }

    pub fn ja_processado(&self, path: &Path) -> bool {
        let Ok((size, mtime)) = fingerprint(path) else {
            return false;
        };
        let nome = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let k = chave(&nome);

        let mut st = self.lock.lock().unwrap();
        if let Some(lista) = st.registros.get(&k) {
            for r in lista {
                if bate(size, mtime, r.tam_origem, r.mtime_origem)
                    || bate(size, mtime, r.tam_saida, r.mtime_saida)
                {
                    return true;
                }
            }
        }

        if let Some(parent) = path.parent() {
            let pasta = parent.to_path_buf();
            if !st.legado.contains_key(&pasta) {
                let mut set = HashSet::new();
                let legacy_path = pasta.join(LEGACY_LOG_FILENAME);
                if let Ok(txt) = fs::read_to_string(&legacy_path) {
                    for line in txt.lines() {
                        let l = line.trim();
                        if !l.is_empty() {
                            set.insert(l.to_string());
                        }
                    }
                }
                st.legado.insert(pasta.clone(), set);
            }
            if let Some(set) = st.legado.get(&pasta) {
                if set.contains(&nome) {
                    return true;
                }
            }
        }

        false
    }

    #[allow(clippy::too_many_arguments)]
    pub fn registrar(
        &self,
        status: &str,
        arquivo: &str,
        fp_origem: Option<(u64, f64)>,
        fp_saida: Option<(u64, f64)>,
        pasta_origem: &str,
        pasta_saida: &str,
        rotacionado: bool,
        nome_cliente: &str,
        largura_cm: f64,
        altura_cm: f64,
        obs: &str,
    ) {
        let mut st = self.lock.lock().unwrap();
        let novo = !self.path.exists();
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let mut wtr = WriterBuilder::new().delimiter(b'\t').from_writer(file);
            if novo {
                let _ = wtr.write_record([
                    "data_hora",
                    "status",
                    "arquivo",
                    "tam_origem",
                    "mtime_origem",
                    "tam_saida",
                    "mtime_saida",
                    "pasta_origem",
                    "pasta_saida",
                    "rotacionado",
                    "nome_cliente",
                    "largura_cm",
                    "altura_cm",
                    "obs",
                ]);
            }
            let now = Local::now().format(FMT).to_string();
            let _ = wtr.write_record([
                now,
                status.to_string(),
                arquivo.to_string(),
                fp_origem.map(|(s, _)| s.to_string()).unwrap_or_default(),
                fp_origem.map(|(_, m)| fmt_ts(m)).unwrap_or_default(),
                fp_saida.map(|(s, _)| s.to_string()).unwrap_or_default(),
                fp_saida.map(|(_, m)| fmt_ts(m)).unwrap_or_default(),
                pasta_origem.to_string(),
                pasta_saida.to_string(),
                if rotacionado { "sim" } else { "não" }.to_string(),
                nome_cliente.to_string(),
                format!("{largura_cm:.2}"),
                format!("{altura_cm:.2}"),
                obs.to_string(),
            ]);
            let _ = wtr.flush();
        }

        if status == "PROCESSADO" {
            st.registros.entry(chave(arquivo)).or_default().push(Registro {
                tam_origem: fp_origem.map(|(s, _)| s),
                mtime_origem: fp_origem.map(|(_, m)| m),
                tam_saida: fp_saida.map(|(s, _)| s),
                mtime_saida: fp_saida.map(|(_, m)| m),
            });
        }
    }
}
