#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    io::{BufRead, BufReader, ErrorKind},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::path::BaseDirectory;
use tauri::Emitter;
use tauri::Manager;
use tauri::{async_runtime, AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::init as fs_init;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::init as shell_init;
use tauri_plugin_store::{Builder, Store, StoreBuilder};
use tempfile::NamedTempFile;
use tokio::time::sleep;
use url::Url;
mod commands;
mod config;
mod musiclang;
mod util;
use crate::commands::{album_concat, generate_musicgen, musicgen_env};
use crate::util::list_from_dir;

fn persistence_enabled() -> bool {
    env::var("BLOSSOM_DISABLE_PERSIST").ok().as_deref() != Some("1")
}

#[tauri::command]
fn generate_llm(prompt: String, system: Option<String>) -> Result<String, String> {
    // Use the Python helper which streams from Ollama and concatenates the result
    let mut cmd = python_command();
    // Safely embed the prompt as a Python string literal
    let prompt_literal = serde_json::to_string(&prompt).unwrap_or_else(|_| format!("{:?}", prompt));
    let system_literal = system
        .as_ref()
        .and_then(|s| serde_json::to_string(s).ok())
        .unwrap_or_else(|| "null".to_string());
    let py = format!(
        r#"import os, json, requests, sys
url = "http://localhost:11434/api/generate"
model = os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "mistral"))
payload = {{"model": model, "prompt": {prompt}, "stream": False}}
system = {system}
if isinstance(system, str) and system.strip():
    payload["system"] = system
try:
    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    print(data.get("response", ""))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"#,
        prompt = prompt_literal,
        system = system_literal,
    );
    let output = cmd.arg("-c").arg(py).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn looks_like_project_root(dir: &Path) -> bool {
    [
        "pyproject.toml",
        "package.json",
        "requirements.txt",
        "blossom.py",
    ]
    .iter()
    .any(|marker| dir.join(marker).exists())
}

fn find_project_root() -> Option<PathBuf> {
    if let Ok(mut dir) = env::current_dir() {
        loop {
            if looks_like_project_root(&dir) {
                return Some(dir);
            }
            if !dir.pop() {
                break;
            }
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if looks_like_project_root(&manifest_dir) {
        return Some(manifest_dir);
    }
    if let Some(parent) = manifest_dir.parent() {
        let candidate = parent.to_path_buf();
        if looks_like_project_root(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn project_root() -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let candidate = find_project_root().unwrap_or_else(|| PathBuf::from("."));
        candidate.canonicalize().unwrap_or(candidate)
    })
    .clone()
}

fn configure_python_command(cmd: &mut Command) {
    let root = project_root();
    cmd.current_dir(&root);
    // Ensure unbuffered I/O so logs stream promptly to the UI
    cmd.env("PYTHONUNBUFFERED", "1");
    // Optional debug: print Python working directory and PYTHONPATH
    if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
        eprintln!(
            "[blossom] python cwd: {}",
            root.to_string_lossy()
        );
    }
    let mut pythonpath = root.clone().into_os_string();
    if let Some(existing) = env::var_os("PYTHONPATH") {
        if !existing.is_empty() {
            pythonpath.push(if cfg!(target_os = "windows") {
                ";"
            } else {
                ":"
            });
            pythonpath.push(existing);
        }
    }
    // Capture a debug copy before moving into env
    let pythonpath_dbg = pythonpath.to_string_lossy().to_string();
    cmd.env("PYTHONPATH", pythonpath);
    if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
        eprintln!("[blossom] PYTHONPATH: {}", pythonpath_dbg);
    }
}

#[tauri::command]
fn write_discord_token(token: String) -> Result<(), String> {
    let root = project_root();
    let dir = root.join("config");
    if let Err(e) = fs::create_dir_all(&dir) {
        // Continue if directory exists or cannot be created; file write may still succeed when dir exists.
        if e.kind() != ErrorKind::AlreadyExists {
            return Err(e.to_string());
        }
    }
    let path = dir.join("discord_token.txt");
    fs::write(&path, token).map_err(|e| e.to_string())?;
    // Best-effort set read-only; ignore errors on platforms that disallow it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o444));
    }
    Ok(())
}

fn python_command() -> Command {
    // Resolution priority:
    // 1) BLOSSOM_PY (explicit override)
    // 2) VIRTUAL_ENV python (active venv)
    // 3) Windows: py -3.10 -u (explicit 3.10)
    // 4) Fallback: python -u
    if let Ok(custom) = env::var("BLOSSOM_PY") {
        let mut cmd = Command::new(custom);
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using BLOSSOM_PY interpreter");
        }
        return cmd;
    }

    if let Ok(venv) = env::var("VIRTUAL_ENV") {
        #[cfg(target_os = "windows")]
        let python_path = PathBuf::from(&venv).join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = PathBuf::from(&venv).join("bin").join("python");
        let mut cmd = Command::new(python_path);
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using VIRTUAL_ENV interpreter");
        }
        return cmd;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("py");
        cmd.arg("-3.10").arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using Windows py launcher for Python 3.10");
        }
        return cmd;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("python");
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using system 'python' interpreter");
        }
        return cmd;
    }
}

#[tauri::command]
fn resolve_resource(app: AppHandle, path: String) -> Result<String, String> {
    use std::path::PathBuf;

    fn normalize_path_string(p: &Path) -> Result<String, String> {
        let mut s = p.to_string_lossy().to_string();
        if s.starts_with(r"\\?\") {
            s = s.trim_start_matches(r"\\?\").to_string();
        }
        Ok(s)
    }

    let input = PathBuf::from(&path);
    if input.is_absolute() && input.exists() {
        return normalize_path_string(&input);
    }

    // Prefer project-root relative paths in dev
    let root = project_root();
    let candidates = [root.join(&path), root.join("src-tauri").join(&path)];
    for c in &candidates {
        if c.exists() {
            return normalize_path_string(c);
        }
    }

    // Fallback to resource resolution (prod bundles)
    if let Ok(resolved) = app.path().resolve(&path, BaseDirectory::Resource) {
        if resolved.exists() {
            return normalize_path_string(&resolved);
        }
        // Return the resolved string even if it doesn't exist, as a last resort
        return normalize_path_string(&resolved);
    }

    Err(format!("Unable to resolve resource path: {}", path))
}

#[tauri::command]
fn list_bundled_voices(app: AppHandle) -> Result<Value, String> {
    // Candidate roots for voices in dev/prod
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app
        .path()
        .resolve("assets/voice_models", BaseDirectory::Resource)
    {
        roots.push(res);
    }
    let proj = project_root();
    roots.push(proj.join("assets/voice_models"));
    roots.push(proj.join("src-tauri").join("assets/voice_models"));
    // Also support alternate capitalizations or separate folder names
    roots.push(proj.join("assets/Voice_Models"));
    roots.push(proj.join("src-tauri").join("assets/Voice_Models"));
    roots.push(proj.join("Voice_Models"));

    // Deduplicate and keep only existing dirs
    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| p.exists() && seen.insert(p.canonicalize().unwrap_or(p.clone())));

    let mut items = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    for base in roots {
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            // Find model/config filenames
            let mut model_file = None::<String>;
            let mut config_file = None::<String>;
            for f in fs::read_dir(&path).map_err(|e| e.to_string())? {
                let f = f.map_err(|e| e.to_string())?;
                if !f.file_type().map_err(|e| e.to_string())?.is_file() {
                    continue;
                }
                if let Some(name) = f.file_name().to_str() {
                    let lower = name.to_lowercase();
                    if model_file.is_none() && lower.ends_with(".onnx") {
                        model_file = Some(name.to_string());
                    }
                    if config_file.is_none() && lower.ends_with(".onnx.json") {
                        config_file = Some(name.to_string());
                    }
                }
            }
            let (model_file, config_file) = match (model_file, config_file) {
                (Some(m), Some(c)) => (m, c),
                _ => continue,
            };
            // Build a relative resource path when possible, otherwise absolute path
            let rel_prefix = "assets/voice_models";
            let model_path = if path.starts_with(rel_prefix) {
                format!("{}/{}/{}", rel_prefix, id, model_file)
            } else if let Some(pos) = path.to_string_lossy().find(rel_prefix) {
                let suffix = &path.to_string_lossy()[pos + rel_prefix.len() + 1..];
                format!("{}/{}/{}", rel_prefix, suffix, model_file)
            } else {
                path.join(&model_file).to_string_lossy().to_string()
            };
            let config_path = if path.starts_with(rel_prefix) {
                format!("{}/{}/{}", rel_prefix, id, config_file)
            } else if let Some(pos) = path.to_string_lossy().find(rel_prefix) {
                let suffix = &path.to_string_lossy()[pos + rel_prefix.len() + 1..];
                format!("{}/{}/{}", rel_prefix, suffix, config_file)
            } else {
                path.join(&config_file).to_string_lossy().to_string()
            };

            // Attempt to read language/speaker from the config
            let mut lang: Option<String> = None;
            let mut speaker: Option<Value> = None;
            // Read config using absolute path if relative resolution fails
            let text =
                if let Ok(cfg_abs) = app.path().resolve(&config_path, BaseDirectory::Resource) {
                    fs::read_to_string(cfg_abs)
                } else {
                    fs::read_to_string(path.join(&config_file))
                };
            if let Ok(text) = text {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    if let Some(espeak) = val.get("espeak") {
                        if let Some(v) = espeak.get("voice").and_then(|v| v.as_str()) {
                            lang = Some(v.to_string());
                        }
                    }
                    if lang.is_none() {
                        if let Some(l) = val.get("language").and_then(|v| v.as_str()) {
                            lang = Some(l.to_string());
                        }
                    }
                    if let Some(s) = val.get("default_speaker") {
                        speaker = Some(s.clone());
                    }
                }
            }

            // Build a friendly label and a dedup key based on model metadata
            let mut label: Option<String> = None;
            let mut dedup_key: Option<String> = None;
            if let Ok(text) = fs::read_to_string(&path.join(&config_file)) {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    let dataset = val
                        .get("dataset")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let quality = val
                        .get("audio")
                        .and_then(|a| a.get("quality"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let lang_code = val
                        .get("language")
                        .and_then(|l| l.get("code"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            val.get("language")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        });
                    if let Some(ds) = dataset.clone() {
                        let mut name = ds[..1].to_uppercase();
                        name.push_str(&ds[1..]);
                        if let Some(q) = quality.clone() {
                            let q_title = {
                                let mut qq = q.clone();
                                if !qq.is_empty() {
                                    qq.replace_range(0..1, &qq[0..1].to_uppercase());
                                }
                                qq
                            };
                            name = format!("{} ({})", name, q_title);
                        }
                        if let Some(lc) = lang_code.clone() {
                            name = format!("{} [{}]", name, lc);
                        }
                        label = Some(name);
                    }
                    // Create a metadata-based dedup key if possible
                    if let Some(ds) = dataset {
                        let q = quality.unwrap_or_else(|| "".into());
                        let lc = lang_code.unwrap_or_else(|| "".into());
                        dedup_key = Some(format!(
                            "{}|{}|{}",
                            ds.to_lowercase(),
                            q.to_lowercase(),
                            lc.to_lowercase()
                        ));
                    }
                }
            }

            // Deduplicate across different folder IDs by using metadata-based key when available,
            // falling back to a normalized id (underscores/hyphens treated the same).
            let norm_id = id.to_lowercase().replace('-', "_");

            let mut obj = serde_json::Map::new();
            obj.insert("id".into(), Value::String(id.clone()));
            obj.insert("modelPath".into(), Value::String(model_path));
            obj.insert("configPath".into(), Value::String(config_path));
            if let Some(l) = lang {
                obj.insert("lang".into(), Value::String(l));
            }
            if let Some(s) = speaker {
                obj.insert("speaker".into(), s);
            }
            if let Some(lbl) = label {
                obj.insert("label".into(), Value::String(lbl));
            }
            let key = dedup_key.clone().unwrap_or(norm_id);
            if seen_keys.insert(key) {
                items.push(Value::Object(obj));
            }
        }
    }
    // Sort by id for stable UI
    items.sort_by(|a, b| {
        a["id"]
            .as_str()
            .unwrap_or("")
            .cmp(b["id"].as_str().unwrap_or(""))
    });
    Ok(Value::Array(items))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Npc {
    name: String,
    description: String,
    prompt: String,
    voice: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LoreItem {
    path: String,
    title: String,
    summary: String,
    content: String,
    tags: Vec<String>,
    aliases: Vec<String>,
    fields: Map<String, Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct PiperProfile {
    name: String,
    voice_id: String,
    tags: Vec<String>,
}

fn read_npcs() -> Result<Vec<Npc>, String> {
    let path = Path::new("data/npcs.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let npcs = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(npcs)
}

fn write_npcs(npcs: &[Npc]) -> Result<(), String> {
    let path = Path::new("data/npcs.json");
    let text = serde_json::to_string_pretty(npcs).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn npc_list() -> Result<Vec<Npc>, String> {
    let mut npcs = read_npcs()?;
    let mut cmd = python_command();
    if let Ok(output) = cmd
        .args([
            "-c",
            "import json, service_api; print(json.dumps(service_api.list_npcs()))",
        ])
        .output()
    {
        if output.status.success() {
            if let Ok(notes) = serde_json::from_slice::<Vec<Value>>(&output.stdout) {
                for note in notes {
                    if let Some(name) = note
                        .get("aliases")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.get(0))
                        .and_then(|v| v.as_str())
                        .or_else(|| note.get("path").and_then(|v| v.as_str()))
                    {
                        if !npcs.iter().any(|n| n.name == name) {
                            let fields = note.get("fields").and_then(|v| v.as_object());
                            let description = fields
                                .and_then(|f| f.get("description"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let prompt = fields
                                .and_then(|f| f.get("prompt"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let voice = fields
                                .and_then(|f| f.get("voice"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            npcs.push(Npc {
                                name: name.to_string(),
                                description,
                                prompt,
                                voice,
                            });
                        }
                    }
                }
            }
        }
    }
    Ok(npcs)
}

#[tauri::command]
fn lore_list() -> Result<Vec<LoreItem>, String> {
    let mut cmd = python_command();
    let output = cmd
        .args([
            "-c",
            "import json, service_api; print(json.dumps(service_api.list_lore()))",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let notes = serde_json::from_slice::<Vec<Value>>(&output.stdout).map_err(|e| e.to_string())?;

    let mut lore_items = Vec::new();
    for note in notes {
        let path = note
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let title = note
            .get("title")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                note.get("aliases")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.get(0))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&path)
                    .to_string()
            });
        let summary = note
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let content = note
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let tags = note
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let aliases = note
            .get("aliases")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let fields = note
            .get("fields")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(Map::new);

        lore_items.push(LoreItem {
            path,
            title,
            summary,
            content,
            tags,
            aliases,
            fields,
        });
    }

    Ok(lore_items)
}

#[tauri::command]
fn npc_save(npc: Npc) -> Result<(), String> {
    let mut npcs = read_npcs()?;
    if let Some(existing) = npcs.iter_mut().find(|n| n.name == npc.name) {
        *existing = npc;
    } else {
        npcs.push(npc);
    }
    write_npcs(&npcs)
}

#[tauri::command]
fn npc_delete(name: String) -> Result<(), String> {
    let mut npcs = read_npcs()?;
    npcs.retain(|n| n.name != name);
    write_npcs(&npcs)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProgressEvent {
    stage: Option<String>,
    percent: Option<u8>,
    message: Option<String>,
    eta: Option<String>,
    step: Option<u64>,
    total: Option<u64>,
    queue_position: Option<usize>,
    queue_eta_seconds: Option<u64>,
}

fn extract_error_message(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .find_map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .map(|s| s.to_string())
        })
}

const MAX_LOG_LINES: usize = 200;
const MAX_HISTORY: usize = 200;

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct JobProgressSnapshot {
    stage: Option<String>,
    percent: Option<u8>,
    message: Option<String>,
    eta: Option<String>,
    step: Option<u64>,
    total: Option<u64>,
    queue_position: Option<usize>,
    queue_eta_seconds: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct JobArtifact {
    name: String,
    path: String,
}

#[derive(Clone, Debug)]
struct JobArtifactCandidate {
    name: String,
    path: PathBuf,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct JobRecord {
    id: u64,
    kind: Option<String>,
    label: Option<String>,
    args: Vec<String>,
    created_at: DateTime<Utc>,
    #[serde(default)]
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    success: Option<bool>,
    exit_code: Option<i32>,
    stdout_excerpt: Vec<String>,
    stderr_excerpt: Vec<String>,
    artifacts: Vec<JobArtifact>,
    progress: Option<JobProgressSnapshot>,
    #[serde(default)]
    cancelled: bool,
}

impl JobRecord {
    fn status_text(&self) -> String {
        if self.cancelled {
            "cancelled".to_string()
        } else {
            match self.success {
                Some(true) => "completed".to_string(),
                Some(false) => "error".to_string(),
                None => "running".to_string(),
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct QueueRecord {
    id: u64,
    args: Vec<String>,
    kind: Option<String>,
    label: Option<String>,
    artifact_candidates: Vec<JobArtifact>,
    created_at: DateTime<Utc>,
    queued_at: DateTime<Utc>,
}

#[derive(Clone, Default)]
struct JobContext {
    kind: Option<String>,
    label: Option<String>,
    artifact_candidates: Vec<JobArtifactCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicGenJobRequest {
    prompt: String,
    duration: f32,
    model_name: String,
    temperature: f32,
    force_cpu: Option<bool>,
    force_gpu: Option<bool>,
    use_fp16: Option<bool>,
    output_dir: Option<String>,
    output_name: Option<String>,
    count: Option<u32>,
    melody_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RenderJobRequest {
    preset: Option<String>,
    style: Option<String>,
    minutes: Option<f64>,
    sections: Option<u32>,
    seed: Option<i64>,
    sampler_seed: Option<i64>,
    mix_preset: Option<String>,
    name: Option<String>,
    outdir: Option<String>,
    mix_config: Option<String>,
    arrange_config: Option<String>,
    bundle_stems: Option<bool>,
    eval_only: Option<bool>,
    dry_run: Option<bool>,
    keys_sfz: Option<String>,
    pads_sfz: Option<String>,
    bass_sfz: Option<String>,
    drums_sfz: Option<String>,
    melody_midi: Option<String>,
    drums_model: Option<String>,
    bass_model: Option<String>,
    keys_model: Option<String>,
    arrange: Option<String>,
    outro: Option<String>,
    preview: Option<u32>,
    phrase: Option<bool>,
}

struct JobInfo {
    child: Arc<Mutex<Option<Child>>>,
    pending: bool,
    cancelled: bool,
    status: Option<bool>,
    stderr_full: Arc<Mutex<String>>,
    stdout_excerpt: Arc<Mutex<VecDeque<String>>>,
    stderr_excerpt: Arc<Mutex<VecDeque<String>>>,
    artifacts: Arc<Mutex<Vec<JobArtifact>>>,
    artifact_candidates: Vec<JobArtifactCandidate>,
    created_at: DateTime<Utc>,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    args: Vec<String>,
    exit_code: Option<i32>,
    progress: Arc<Mutex<Option<JobProgressSnapshot>>>,
    kind: Option<String>,
    label: Option<String>,
}

impl JobInfo {
    fn new_pending(args: Vec<String>, context: &JobContext) -> Self {
        let now = Utc::now();
        JobInfo {
            child: Arc::new(Mutex::new(None)),
            pending: true,
            cancelled: false,
            status: None,
            stderr_full: Arc::new(Mutex::new(String::new())),
            stdout_excerpt: Arc::new(Mutex::new(VecDeque::new())),
            stderr_excerpt: Arc::new(Mutex::new(VecDeque::new())),
            artifacts: Arc::new(Mutex::new(Vec::new())),
            artifact_candidates: context.artifact_candidates.clone(),
            created_at: now,
            queued_at: now,
            started_at: None,
            finished_at: None,
            args,
            exit_code: None,
            progress: Arc::new(Mutex::new(None)),
            kind: context.kind.clone(),
            label: context.label.clone(),
        }
    }

    fn to_record(&self, id: u64) -> JobRecord {
        let stdout = self
            .stdout_excerpt
            .lock()
            .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let stderr_lines = self
            .stderr_excerpt
            .lock()
            .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let artifacts = self
            .artifacts
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        let progress = self
            .progress
            .lock()
            .map(|p| (*p).clone())
            .unwrap_or_default();
        JobRecord {
            id,
            kind: self.kind.clone(),
            label: self.label.clone(),
            args: self.args.clone(),
            created_at: self.created_at,
            started_at: self.started_at,
            finished_at: self.finished_at,
            success: self.status,
            exit_code: self.exit_code,
            stdout_excerpt: stdout,
            stderr_excerpt: stderr_lines,
            artifacts,
            progress,
            cancelled: self.cancelled,
        }
    }
}

struct JobRegistry {
    jobs: Mutex<HashMap<u64, JobInfo>>,
    history: Mutex<VecDeque<JobRecord>>,
    queue: Mutex<VecDeque<u64>>,
    counter: AtomicU64,
    history_path: OnceLock<PathBuf>,
    queue_path: OnceLock<PathBuf>,
    concurrency_limit: AtomicUsize,
}

impl JobRegistry {
    fn new() -> Self {
        let concurrency = env::var("BLOSSOM_JOB_CONCURRENCY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(1);
        Self {
            jobs: Mutex::new(HashMap::new()),
            history: Mutex::new(VecDeque::new()),
            queue: Mutex::new(VecDeque::new()),
            counter: AtomicU64::new(1),
            history_path: OnceLock::new(),
            queue_path: OnceLock::new(),
            concurrency_limit: AtomicUsize::new(concurrency),
        }
    }

    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::SeqCst)
    }

    fn init_persistence(&self, history_path: PathBuf, queue_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = history_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if let Some(parent) = queue_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if self.history_path.set(history_path.clone()).is_ok() {
            if history_path.exists() {
                let data = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
                if !data.trim().is_empty() {
                    let parsed: Vec<JobRecord> =
                        serde_json::from_str(&data).map_err(|e| e.to_string())?;
                    let mut history = self.history.lock().unwrap();
                    history.extend(parsed.into_iter());
                }
            }
        }

        if self.queue_path.set(queue_path.clone()).is_ok() {
            if queue_path.exists() {
                let data = fs::read_to_string(&queue_path).map_err(|e| e.to_string())?;
                if !data.trim().is_empty() {
                    let parsed: Vec<QueueRecord> =
                        serde_json::from_str(&data).map_err(|e| e.to_string())?;
                    let mut jobs = self.jobs.lock().unwrap();
                    let mut queue = self.queue.lock().unwrap();
                    for record in parsed {
                        let artifact_candidates = record
                            .artifact_candidates
                            .iter()
                            .map(|candidate| JobArtifactCandidate {
                                name: candidate.name.clone(),
                                path: PathBuf::from(&candidate.path),
                            })
                            .collect();
                        let job = JobInfo {
                            child: Arc::new(Mutex::new(None)),
                            pending: true,
                            cancelled: false,
                            status: None,
                            stderr_full: Arc::new(Mutex::new(String::new())),
                            stdout_excerpt: Arc::new(Mutex::new(VecDeque::new())),
                            stderr_excerpt: Arc::new(Mutex::new(VecDeque::new())),
                            artifacts: Arc::new(Mutex::new(Vec::new())),
                            artifact_candidates,
                            created_at: record.created_at,
                            queued_at: record.queued_at,
                            started_at: None,
                            finished_at: None,
                            args: record.args.clone(),
                            exit_code: None,
                            progress: Arc::new(Mutex::new(None)),
                            kind: record.kind.clone(),
                            label: record.label.clone(),
                        };
                        jobs.insert(record.id, job);
                        queue.push_back(record.id);
                    }
                }
            }
        }

        let mut max_id = None;
        {
            let history = self.history.lock().unwrap();
            if let Some(history_max) = history.iter().map(|r| r.id).max() {
                max_id = Some(history_max);
            }
        }
        {
            let queue = self.queue.lock().unwrap();
            if let Some(queue_max) = queue.iter().copied().max() {
                max_id = Some(max_id.map_or(queue_max, |m| m.max(queue_max)));
            }
        }
        if let Some(max_id) = max_id {
            let next = max_id.saturating_add(1);
            let current = self.counter.load(Ordering::SeqCst);
            if next > current {
                self.counter.store(next, Ordering::SeqCst);
            }
        }

        Ok(())
    }

    fn persist_history(&self) -> Result<(), String> {
        let path = match self.history_path.get() {
            Some(p) => p.clone(),
            None => return Ok(()),
        };
        let history = self.history.lock().unwrap();
        let data = serde_json::to_string_pretty(&history.iter().cloned().collect::<Vec<_>>())
            .map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    fn persist_queue(&self) -> Result<(), String> {
        let path = match self.queue_path.get() {
            Some(p) => p.clone(),
            None => return Ok(()),
        };
        let queue_ids: Vec<u64> = self.queue.lock().unwrap().iter().copied().collect();
        let jobs = self.jobs.lock().unwrap();
        let records: Vec<QueueRecord> = queue_ids
            .into_iter()
            .filter_map(|id| {
                jobs.get(&id).and_then(|job| {
                    if job.pending && !job.cancelled && job.status.is_none() {
                        Some(QueueRecord {
                            id,
                            args: job.args.clone(),
                            kind: job.kind.clone(),
                            label: job.label.clone(),
                            artifact_candidates: job
                                .artifact_candidates
                                .iter()
                                .map(|candidate| JobArtifact {
                                    name: candidate.name.clone(),
                                    path: candidate.path.to_string_lossy().to_string(),
                                })
                                .collect(),
                            created_at: job.created_at,
                            queued_at: job.queued_at,
                        })
                    } else {
                        None
                    }
                })
            })
            .collect();
        let data = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    fn remove_from_queue(&self, id: u64) -> bool {
        let mut queue = self.queue.lock().unwrap();
        if let Some(pos) = queue.iter().position(|candidate| *candidate == id) {
            queue.remove(pos);
            true
        } else {
            false
        }
    }

    fn concurrency_limit_value(&self) -> usize {
        self.concurrency_limit.load(Ordering::SeqCst)
    }

    fn count_active_jobs(&self) -> usize {
        let jobs = self.jobs.lock().unwrap();
        jobs.values()
            .filter(|job| !job.pending && !job.cancelled && job.status.is_none())
            .count()
    }

    fn is_job_done(&self, id: u64) -> bool {
        self.jobs
            .lock()
            .unwrap()
            .get(&id)
            .map(|job| job.cancelled || job.status.is_some())
            .unwrap_or(true)
    }

    fn average_job_duration_seconds(&self) -> Option<u64> {
        let history = self.history.lock().unwrap();
        let mut durations = Vec::new();
        for record in history.iter().rev() {
            if record.success == Some(true) {
                if let Some(finished) = record.finished_at {
                    let start = record.started_at.unwrap_or(record.created_at);
                    let delta = finished.signed_duration_since(start);
                    let seconds = delta.num_seconds();
                    if seconds > 0 {
                        durations.push(seconds as u64);
                    }
                }
            }
            if durations.len() >= 20 {
                break;
            }
        }
        if durations.is_empty() {
            None
        } else {
            let total: u64 = durations.iter().copied().sum();
            Some(total / durations.len() as u64)
        }
    }

    fn estimate_queue_eta_seconds(&self, queue_index: usize, running_count: usize) -> Option<u64> {
        let average = self.average_job_duration_seconds()?;
        let limit = self.concurrency_limit_value();
        if limit == 0 {
            return Some(0);
        }
        let slots = limit.max(1);
        let jobs_before = running_count + queue_index;
        let rounds = jobs_before / slots;
        Some(average.saturating_mul(rounds as u64))
    }

    fn update_queue_positions(&self, app: &AppHandle) {
        let queue_ids: Vec<u64> = self.queue.lock().unwrap().iter().copied().collect();
        if queue_ids.is_empty() {
            return;
        }
        let running = self.count_active_jobs();
        let mut updates = Vec::new();
        {
            let jobs = self.jobs.lock().unwrap();
            for (idx, id) in queue_ids.iter().enumerate() {
                if let Some(job) = jobs.get(id) {
                    if !job.pending || job.cancelled || job.status.is_some() {
                        continue;
                    }
                    let eta_seconds = self.estimate_queue_eta_seconds(idx, running);
                    let ahead = running + idx;
                    let mut snapshot = JobProgressSnapshot {
                        stage: Some("queued".into()),
                        percent: Some(0),
                        message: Some(if ahead > 0 {
                            format!("Queued ({} ahead)", ahead)
                        } else {
                            "Queued".to_string()
                        }),
                        eta: eta_seconds.map(format_eta_string),
                        step: None,
                        total: None,
                        queue_position: Some(idx),
                        queue_eta_seconds: eta_seconds,
                    };
                    {
                        let mut stored = job.progress.lock().unwrap();
                        *stored = Some(snapshot.clone());
                    }
                    updates.push((*id, snapshot));
                }
            }
        }
        for (id, snapshot) in updates {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            let _ = app.emit(&format!("progress::{}", id), event);
        }
    }

    fn enqueue_job(&self, id: u64, job: JobInfo) -> Result<(), String> {
        {
            let mut jobs = self.jobs.lock().unwrap();
            jobs.insert(id, job);
        }
        {
            let mut queue = self.queue.lock().unwrap();
            queue.push_back(id);
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_queue() {
                eprintln!("failed to persist job queue: {}", err);
                return Err(err);
            }
        } else {
            eprintln!("[blossom] persistence disabled; skipping persist_queue on enqueue");
        }
        Ok(())
    }

    fn spawn_completion_watcher(
        &self,
        app: &AppHandle,
        id: u64,
        child_arc: Arc<Mutex<Option<Child>>>,
    ) {
        let app_handle = app.clone();
        async_runtime::spawn(async move {
            loop {
                let result = {
                    let mut guard = child_arc.lock().unwrap();
                    if let Some(child) = guard.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let success = status.success();
                                let code = status.code();
                                *guard = None;
                                Some((success, code))
                            }
                            Ok(None) => None,
                            Err(err) => {
                                eprintln!("failed to check job {} status: {}", id, err);
                                Some((false, None))
                            }
                        }
                    } else {
                        None
                    }
                };
                if let Some((success, code)) = result {
                    eprintln!("[blossom] job {} exited (success={}, code={:?})", id, success, code);
                    let registry = app_handle.state::<JobRegistry>();
                    registry.complete_job(&app_handle, id, success, code, false);
                    registry.maybe_start_jobs(&app_handle);
                    break;
                }
                let registry = app_handle.state::<JobRegistry>();
                if registry.is_job_done(id) {
                    break;
                }
                sleep(Duration::from_secs(1)).await;
            }
        });
    }

    fn start_job_process(&self, app: &AppHandle, id: u64) -> Result<(), String> {
        let (args, stderr_full, stdout_excerpt, stderr_excerpt, progress_arc, child_arc) = {
            let mut jobs = self.jobs.lock().unwrap();
            let job = jobs
                .get_mut(&id)
                .ok_or_else(|| format!("Unknown job {}", id))?;
            if job.cancelled || job.status.is_some() {
                return Err("Job already completed".into());
            }
            job.pending = false;
            job.started_at = Some(Utc::now());
            let progress_arc = job.progress.clone();
            {
                let mut progress = progress_arc.lock().unwrap();
                let snapshot = JobProgressSnapshot {
                    stage: Some("starting".into()),
                    percent: Some(0),
                    message: Some("Starting job...".into()),
                    eta: None,
                    step: None,
                    total: None,
                    queue_position: None,
                    queue_eta_seconds: None,
                };
                *progress = Some(snapshot);
            }
            (
                job.args.clone(),
                job.stderr_full.clone(),
                job.stdout_excerpt.clone(),
                job.stderr_excerpt.clone(),
                progress_arc,
                job.child.clone(),
            )
        };

        let mut cmd = python_command();
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        eprintln!("[blossom] starting job {} with args: {:?}", id, args);
        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("Failed to spawn python process for job {}: {}", id, e);
            eprintln!("[blossom] {}", msg);
            msg
        })?;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        {
            let mut guard = child_arc.lock().unwrap();
            *guard = Some(child);
        }

        if let Some(stderr) = stderr_pipe {
            let stderr_buf_clone = stderr_full.clone();
            let stderr_excerpt_clone = stderr_excerpt.clone();
            let app_handle = app.clone();
            async_runtime::spawn(async move {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    {
                        let mut buf = stderr_buf_clone.lock().unwrap();
                        buf.push_str(&line);
                        buf.push('\n');
                    }
                    {
                        let mut lines = stderr_excerpt_clone.lock().unwrap();
                        if lines.len() >= MAX_LOG_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line.clone());
                    }
                    // Also mirror to terminal stderr for troubleshooting
                    eprintln!("[job {} stderr] {}", id, line);
                    let _ = app_handle.emit("logs::line", line.clone());
                }
            });
        }

        if let Some(stdout) = stdout_pipe {
            let app_handle = app.clone();
            let stdout_excerpt_clone = stdout_excerpt.clone();
            let progress_clone = progress_arc.clone();
            async_runtime::spawn(async move {
                let stage_re = Regex::new(r"^\s*([\w-]+):").unwrap();
                let percent_re = Regex::new(r"(\d+)%").unwrap();
                let eta_re = Regex::new(r"ETA[:\s]+([0-9:]+)").unwrap();
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    {
                        let mut lines = stdout_excerpt_clone.lock().unwrap();
                        if lines.len() >= MAX_LOG_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line.clone());
                    }
                    let stage = stage_re.captures(&line).map(|c| c[1].to_string());
                    let percent = percent_re
                        .captures(&line)
                        .and_then(|c| c[1].parse::<u8>().ok());
                    let eta = eta_re.captures(&line).map(|c| c[1].to_string());
                    let event = ProgressEvent {
                        stage: stage.clone(),
                        percent,
                        message: Some(line.clone()),
                        eta: eta.clone(),
                        step: None,
                        total: None,
                        queue_position: None,
                        queue_eta_seconds: None,
                    };
                    {
                        let mut snapshot = progress_clone.lock().unwrap();
                        *snapshot = Some(JobProgressSnapshot {
                            stage,
                            percent,
                            message: event.message.clone(),
                            eta,
                            step: event.step,
                            total: event.total,
                            queue_position: None,
                            queue_eta_seconds: None,
                        });
                    }
                    // Mirror to terminal stdout for troubleshooting
                    eprintln!("[job {} stdout] {}", id, line);
                    let _ = app_handle.emit("logs::line", line.clone());
                    let _ = app_handle.emit(&format!("progress::{}", id), event);
                }
            });
        }

        self.spawn_completion_watcher(app, id, child_arc.clone());

        if let Some(snapshot) = progress_arc.lock().unwrap().clone() {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            let _ = app.emit(&format!("progress::{}", id), event);
        }

        Ok(())
    }

    fn maybe_start_jobs(&self, app: &AppHandle) {
        loop {
            let limit = self.concurrency_limit_value();
            let slots = if limit == 0 { usize::MAX } else { limit.max(1) };
            if slots != usize::MAX && self.count_active_jobs() >= slots {
                break;
            }
            let next_id = {
                let mut queue = self.queue.lock().unwrap();
                queue.pop_front()
            };
            let Some(id) = next_id else {
                break;
            };
        if persistence_enabled() {
            if let Err(err) = self.persist_queue() {
                eprintln!("failed to persist job queue after dequeue: {}", err);
            }
        }
            if let Err(err) = self.start_job_process(app, id) {
                eprintln!("failed to start job {}: {}", id, err);
                self.complete_job(app, id, false, None, false);
            }
        }
        self.update_queue_positions(app);
    }

    fn complete_job(
        &self,
        app: &AppHandle,
        id: u64,
        success: bool,
        exit_code: Option<i32>,
        cancelled: bool,
    ) {
        eprintln!(
            "[blossom] complete_job(id={}, success={}, cancelled={}, code={:?})",
            id, success, cancelled, exit_code
        );
        eprintln!("[blossom] complete_job: remove_from_queue start id={}", id);
        if self.remove_from_queue(id) {
            if persistence_enabled() {
                if let Err(err) = self.persist_queue() {
                    eprintln!("failed to persist job queue after removal: {}", err);
                }
            } else {
                eprintln!("[blossom] persistence disabled; skipping queue persist after removal");
            }
        }
        eprintln!("[blossom] complete_job: removed from queue id={}", id);
        let mut maybe_record: Option<JobRecord> = None;
        let mut progress_update = None;
        eprintln!("[blossom] complete_job: acquiring jobs lock id={}", id);
        let mut captured: Option<(
            Arc<Mutex<VecDeque<String>>>,
            Arc<Mutex<VecDeque<String>>>,
            Arc<Mutex<Vec<JobArtifact>>>,
            Arc<Mutex<Option<JobProgressSnapshot>>>,
            (Option<String>, Option<String>, Vec<String>, DateTime<Utc>, Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<bool>, Option<i32>, bool),
        )> = None;
        {
            let mut jobs = self.jobs.lock().unwrap();
            eprintln!("[blossom] complete_job: jobs lock acquired id={}", id);
            if let Some(job) = jobs.get_mut(&id) {
                if job.finished_at.is_some() {
                    return;
                }
                job.pending = false;
                job.status = Some(success);
                job.cancelled = cancelled;
                job.exit_code = exit_code;
                job.finished_at.get_or_insert_with(Utc::now);
                if job.started_at.is_none() {
                    job.started_at = Some(job.created_at);
                }
                {
                    let mut child_guard = job.child.lock().unwrap();
                    *child_guard = None;
                }
                eprintln!("[blossom] complete_job: checking artifact candidates id={}", id);
                if job.artifacts.lock().map(|a| a.is_empty()).unwrap_or(true) {
                    let mut artifacts = job.artifacts.lock().unwrap();
                    for candidate in &job.artifact_candidates {
                        if candidate.path.exists() {
                            artifacts.push(JobArtifact {
                                name: candidate.name.clone(),
                                path: candidate.path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
                eprintln!("[blossom] complete_job: building progress snapshot id={}", id);
                let mut progress = job.progress.lock().unwrap();
                let mut snapshot = progress.clone().unwrap_or_default();
                snapshot.queue_position = None;
                snapshot.queue_eta_seconds = None;
                snapshot.eta = None;
                snapshot.step = None;
                snapshot.total = None;
                snapshot.percent = Some(100);
                snapshot.stage = Some(if cancelled {
                    "cancelled".into()
                } else if success {
                    "completed".into()
                } else {
                    "error".into()
                });
                if cancelled {
                    snapshot.message = Some("Job cancelled by user".into());
                    let mut stderr = job.stderr_full.lock().unwrap();
                    if !stderr.contains("Job cancelled by user") {
                        if !stderr.is_empty() && !stderr.ends_with('\n') {
                            stderr.push('\n');
                        }
                        stderr.push_str("Job cancelled by user\n");
                    }
                }
                *progress = Some(snapshot.clone());
                progress_update = Some(snapshot);
                eprintln!("[blossom] complete_job: preparing record fields id={}", id);
                // Capture data and Arc handles, then build record after releasing jobs lock
                captured = Some((
                    job.stdout_excerpt.clone(),
                    job.stderr_excerpt.clone(),
                    job.artifacts.clone(),
                    job.progress.clone(),
                    (
                        job.kind.clone(),
                        job.label.clone(),
                        job.args.clone(),
                        job.created_at,
                        job.started_at,
                        job.finished_at,
                        job.status,
                        job.exit_code,
                        job.cancelled,
                    ),
                ));
            }
        }
        // If we captured handles, build the record outside of the jobs lock to avoid deadlocks
        if let Some((stdout_arc, stderr_arc, artifacts_arc, progress_arc2, (
            kind,
            label,
            args_clone,
            created_at,
            started_at,
            finished_at,
            success_val,
            exit_code_val,
            cancelled_val,
        ))) = captured
        {
            eprintln!("[blossom] complete_job: building record outside lock id={}", id);
            let stdout = stdout_arc
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let stderr_lines = stderr_arc
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let artifacts = artifacts_arc.lock().map(|items| items.clone()).unwrap_or_default();
            let progress = progress_arc2.lock().map(|p| (*p).clone()).unwrap_or_default();
            maybe_record = Some(JobRecord {
                id,
                kind,
                label,
                args: args_clone,
                created_at,
                started_at,
                finished_at,
                success: success_val,
                exit_code: exit_code_val,
                stdout_excerpt: stdout,
                stderr_excerpt: stderr_lines,
                artifacts,
                progress,
                cancelled: cancelled_val,
            });
            eprintln!("[blossom] complete_job: record built id={}", id);
        }
        if let Some(record) = maybe_record {
            if persistence_enabled() {
                eprintln!("[blossom] complete_job: pushing history id={}", id);
                self.push_history(record);
                eprintln!("[blossom] complete_job: pushed history id={}", id);
            } else {
                eprintln!("[blossom] persistence disabled; skipping push_history");
            }
        }
        if let Some(snapshot) = progress_update {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            eprintln!("[blossom] complete_job: emitting final progress id={}", id);
            let _ = app.emit(&format!("progress::{}", id), event);
            eprintln!("[blossom] complete_job: emitted final progress id={}", id);
        }
        eprintln!("[blossom] complete_job: updating queue positions id={}", id);
        self.update_queue_positions(app);
        eprintln!("[blossom] complete_job finished for id={}", id);
    }

    fn cancel_job(&self, app: &AppHandle, job_id: u64) -> Result<(), String> {
        let mut child_to_kill: Option<Child> = None;
        let mut was_pending = false;
        {
            let mut jobs = self.jobs.lock().unwrap();
            let job = jobs
                .get_mut(&job_id)
                .ok_or_else(|| "Unknown job_id".to_string())?;
            if job.status.is_some() || job.cancelled {
                return Err("Job already completed".into());
            }
            was_pending = job.pending;
            job.pending = false;
            job.cancelled = true;
            job.finished_at.get_or_insert_with(Utc::now);
            if !was_pending {
                let mut child_guard = job.child.lock().unwrap();
                if let Some(child) = child_guard.take() {
                    child_to_kill = Some(child);
                }
            }
        }
        if was_pending && self.remove_from_queue(job_id) {
            if persistence_enabled() {
                if let Err(err) = self.persist_queue() {
                    eprintln!("failed to persist job queue after cancellation: {}", err);
                }
            }
        }
        if let Some(mut child) = child_to_kill {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.complete_job(app, job_id, false, None, true);
        self.maybe_start_jobs(app);
        Ok(())
    }

    fn resume_pending(&self, app: &AppHandle) {
        self.update_queue_positions(app);
        self.maybe_start_jobs(app);
    }

    fn push_history(&self, record: JobRecord) {
        {
            let mut history = self.history.lock().unwrap();
            history.push_back(record);
            while history.len() > MAX_HISTORY {
                history.pop_front();
            }
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_history() {
                eprintln!("failed to persist job history: {}", err);
            }
        }
    }

    fn list_history(&self) -> Vec<JobRecord> {
        self.history.lock().unwrap().iter().cloned().collect()
    }

    fn prune_history(&self, retain: usize) {
        {
            let mut history = self.history.lock().unwrap();
            if retain == 0 {
                history.clear();
            } else if history.len() > retain {
                let drop = history.len() - retain;
                for _ in 0..drop {
                    history.pop_front();
                }
            }
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_history() {
                eprintln!("failed to persist job history after prune: {}", err);
            }
        }
    }
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
fn list_presets() -> Result<Vec<String>, String> {
    list_from_dir(Path::new("assets/presets"))
}

#[tauri::command]
fn list_styles() -> Result<Vec<String>, String> {
    list_from_dir(Path::new("assets/styles"))
}

// Settings store accessor (shared with config.rs pattern)
fn settings_store(app: &AppHandle) -> Result<Arc<Store<tauri::Wry>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Unable to resolve app config directory".to_string())?
        .join("settings.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct InboxItem {
    path: String,
    name: String,
    title: String,
    size: u64,
    modified_ms: i64,
    preview: Option<String>,
}

fn read_first_paragraph(text: &str, max_len: usize) -> Option<String> {
    let norm = text.replace("\r\n", "\n");
    let mut parts = norm.splitn(2, "\n\n");
    let first = parts.next().unwrap_or("").trim();
    if first.is_empty() {
        return None;
    }
    let snippet = if first.len() > max_len {
        let mut s = first[..max_len].to_string();
        s.push_str("…");
        s
    } else {
        first.to_string()
    };
    Some(snippet)
}

#[tauri::command]
fn inbox_list(app: AppHandle, path: Option<String>) -> Result<Vec<InboxItem>, String> {
    // Resolve base path: explicit param > vaultPath + 00_Inbox
    let base_dir = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else {
        let store = settings_store(&app)?;
        let vault = store
            .get("vaultPath")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .ok_or_else(|| "Vault path not set. Choose it in Settings.".to_string())?;
        PathBuf::from(vault).join("00_Inbox")
    };

    if !base_dir.exists() {
        return Err(format!(
            "Inbox folder does not exist: {}",
            base_dir.to_string_lossy()
        ));
    }
    if !base_dir.is_dir() {
        return Err(format!(
            "Inbox path is not a directory: {}",
            base_dir.to_string_lossy()
        ));
    }

    let mut items: Vec<InboxItem> = Vec::new();
    for entry in fs::read_dir(&base_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&name)
            .to_string();
        let size = meta.len();
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|e| {
                // Convert to an approximate ms since now - elapsed
                let now = Utc::now();
                let ago = ChronoDuration::from_std(e).unwrap_or_else(|_| ChronoDuration::seconds(0));
                (now - ago).timestamp_millis()
            })
            .unwrap_or_else(|| Utc::now().timestamp_millis());

        // Try to read small preview
        let preview = fs::read_to_string(&path)
            .ok()
            .and_then(|t| read_first_paragraph(&t, 280));

        items.push(InboxItem {
            path: path.to_string_lossy().to_string(),
            name,
            title,
            size,
            modified_ms,
            preview,
        });
    }

    // Sort by modified desc, then name
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
fn npc_create(app: AppHandle, name: String, region: Option<String>, purpose: Option<String>, template: Option<String>, random_name: Option<bool>) -> Result<String, String> {
    eprintln!("[blossom] npc_create: start name='{}', region={:?}, purpose={:?}, template={:?}", name, region, purpose, template);
    // Resolve NPC base directory
    let store = settings_store(&app).map_err(|e| { eprintln!("[blossom] npc_create: settings_store error: {}", e); e })?;
    let vault = store
        .get("vaultPath")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let base_dir = if let Some(ref v) = vault {
        PathBuf::from(v).join("20_DM").join("NPC")
    } else {
        PathBuf::from(r"D:\\Documents\\DreadHaven\\20_DM\\NPC")
    };
    if !base_dir.exists() { fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?; }

    // Build target directory from region (can be nested like "Bree/Inn")
    let mut target_dir = base_dir.clone();
    if let Some(r) = region.and_then(|s| if s.trim().is_empty() { None } else { Some(s) }) {
        for part in r.replace("\\", "/").split('/') {
            if part.trim().is_empty() { continue; }
            target_dir = target_dir.join(part);
        }
    }
    if !target_dir.exists() { fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?; }

    // Safe filename
    let mut fname = name.chars().map(|c| if c.is_alphanumeric() || c==' ' || c=='-' || c=='_' { c } else { '_' }).collect::<String>().trim().replace(' ', "_");
    if fname.is_empty() { fname = "New_NPC".to_string(); }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 { break; }
    }

    // Resolve template path and load text (tolerant of spaces and variants)
    eprintln!("[blossom] npc_create: resolving template path");
    let default_template_a = r"D:\\Documents\\DreadHaven\\_Templates\\NPC Template.md".to_string();
    let default_template_b = r"D:\\Documents\\DreadHaven\\_Templates\\NPC_Template.md".to_string();
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut tried: Vec<String> = Vec::new();
    if let Some(mut s) = template {
        let mut ch = s.chars();
        if let (Some(d), Some(sep)) = (ch.next(), ch.next()) {
            if d.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", d, rest);
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() { candidates.push(p); }
        if let Some(v) = &vault {
            candidates.push(PathBuf::from(v).join("_Templates").join(&s));
            candidates.push(PathBuf::from(v).join(&s));
        }
    }
    if let Some(v) = &vault {
        candidates.push(PathBuf::from(v).join("_Templates").join("NPC Template.md"));
        candidates.push(PathBuf::from(v).join("_Templates").join("NPC_Template.md"));
    }
    candidates.push(PathBuf::from(&default_template_a));
    candidates.push(PathBuf::from(&default_template_b));
    let mut template_text: Option<String> = None;
    for cand in candidates {
        let s = cand.to_string_lossy().to_string();
        tried.push(s.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => { template_text = Some(t); break; }
            Err(_) => {}
        }
    }
    let now = Utc::now().format("%Y-%m-%d").to_string();
    let location_str = target_dir.strip_prefix(&base_dir).ok().map(|p| p.to_string_lossy().to_string()).unwrap_or_default().replace('\\', "/");
    let purpose_str = purpose.unwrap_or_default();
    let use_random_name = random_name.unwrap_or(false) || name.trim().is_empty();

    // Build LLM prompt using template (or a fallback structure)
    let tpl = template_text.unwrap_or_else(|| {
        String::from("---\nTitle: {{NAME}}\nLocation: {{LOCATION}}\nPurpose: {{PURPOSE}}\nDate: {{DATE}}\n---\n\n# {{NAME}}\n\n## Description\n\n## Personality\n\n## Goals\n\n## Hooks\n\n## Relationships\n\n## Secrets\n")
    });
    let prompt = if use_random_name {
        format!(
            "You are drafting a D&D NPC note. Using the TEMPLATE, fully populate it for an NPC appropriate to the location \"{location}\" with the role/purpose \"{purpose}\".\n\nRules:\n- Choose an evocative, setting-appropriate NPC name and set it consistently in all places ({{{{NAME}}}}, Title/frontmatter, headings).\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Fill placeholders with specific details grounded in the location and purpose.\n- Provide short but rich sections: appearance, personality, goals, plot hooks, relationships, and any relevant secrets.\n- Avoid game-legal OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown.\n\nTEMPLATE:\n```\n{template}\n```",
            location = location_str,
            purpose = purpose_str,
            template = tpl
        )
    } else {
        format!(
            "You are drafting a D&D NPC note. Using the TEMPLATE, fully populate it for an NPC named \"{name}\". The NPC is located in \"{location}\" and has the role/purpose \"{purpose}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Fill placeholders with evocative, specific details grounded in the location and purpose.\n- Provide short but rich sections: appearance, personality, goals, plot hooks, relationships, and any relevant secrets.\n- Avoid game-legal OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown.\n\nTEMPLATE:\n```\n{template}\n```",
            name = name,
            location = location_str,
            purpose = purpose_str,
            template = tpl
        )
    };
    let system = Some(String::from("You are a helpful worldbuilding assistant. Produce clean, cohesive Markdown. Keep a grounded tone; avoid overpowered traits."));
    eprintln!("[blossom] npc_create: invoking LLM generation (ollama)");
    let content = generate_llm(prompt, system)?;

    // Determine filename
    fn extract_title(src: &str) -> Option<String> {
        let s = src.replace("\r\n", "\n");
        if s.starts_with("---\n") {
            if let Some(end) = s[4..].find("\n---") { // position of closing
                let body = &s[4..4+end];
                for line in body.lines() {
                    let ln = line.trim();
                    let lower = ln.to_ascii_lowercase();
                    if lower.starts_with("title:") {
                        return Some(ln.splitn(2, ':').nth(1).unwrap_or("").trim().to_string());
                    }
                    if lower.starts_with("name:") {
                        return Some(ln.splitn(2, ':').nth(1).unwrap_or("").trim().to_string());
                    }
                }
            }
        }
        for line in s.lines() {
            let ln = line.trim();
            if let Some(rest) = ln.strip_prefix('#') {
                let rest = rest.trim_start_matches('#').trim();
                if !rest.is_empty() { return Some(rest.to_string()); }
            }
        }
        None
    }

    let effective_name = if use_random_name {
        extract_title(&content).unwrap_or_else(|| "New_NPC".to_string())
    } else { name.clone() };

    // Safe filename and unique path
    let mut fname = effective_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c==' ' || c=='-' || c=='_' { c } else { '_' })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() { fname = "New_NPC".to_string(); }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 { break; }
    }

    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())?;
    eprintln!("[blossom] npc_create: wrote '{}'", target.to_string_lossy());
    Ok(target.to_string_lossy().to_string())
}
#[tauri::command]
fn inbox_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(path);
    if !p.exists() || !p.is_file() {
        return Err("File not found".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct DirEntryItem {
    path: String,
    name: String,
    is_dir: bool,
    size: Option<u64>,
    modified_ms: i64,
}

#[tauri::command]
fn dir_list(path: String) -> Result<Vec<DirEntryItem>, String> {
    let base = PathBuf::from(&path);
    if !base.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !base.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut items: Vec<DirEntryItem> = Vec::new();
    for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
        let is_dir = meta.is_dir();
        let name = match p.file_name().and_then(|s| s.to_str()) { Some(s) => s.to_string(), None => continue };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|e| {
                let now = Utc::now();
                let ago = ChronoDuration::from_std(e).unwrap_or_else(|_| ChronoDuration::seconds(0));
                (now - ago).timestamp_millis()
            })
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let size = if is_dir { None } else { Some(meta.len()) };
        items.push(DirEntryItem {
            path: p.to_string_lossy().to_string(),
            name,
            is_dir,
            size,
            modified_ms,
        });
    }
    // Sort: directories first by name, then files by name
    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

#[tauri::command]
fn monster_create(app: AppHandle, name: String, template: Option<String>) -> Result<String, String> {
    eprintln!(
        "[blossom] monster_create: start name='{}', template={:?}",
        name, template
    );

    // Determine Monsters directory
    let store = settings_store(&app).map_err(|e| {
        eprintln!("[blossom] monster_create: settings_store error: {}", e);
        e
    })?;
    let vault = store
        .get("vaultPath")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    eprintln!("[blossom] monster_create: vaultPath={:?}", vault);
    let monsters_dir = if let Some(ref v) = vault {
        PathBuf::from(v).join("20_DM").join("Monsters")
    } else {
        PathBuf::from(r"D:\\Documents\\DreadHaven\\20_DM\\Monsters")
    };
    eprintln!(
        "[blossom] monster_create: monsters_dir='{}'",
        monsters_dir.to_string_lossy()
    );
    if !monsters_dir.exists() {
        eprintln!("[blossom] monster_create: creating monsters_dir");
        fs::create_dir_all(&monsters_dir).map_err(|e| {
            eprintln!(
                "[blossom] monster_create: failed to create monsters_dir '{}': {}",
                monsters_dir.to_string_lossy(),
                e
            );
            e.to_string()
        })?;
    }

    // Resolve template path (be tolerant of malformed Windows paths and relative inputs)
    eprintln!("[blossom] monster_create: resolving template path");
    let default_template =
        r"D:\\Documents\\DreadHaven\\_Templates\\Monster Template + Universal (D&D 5e Statblock).md"
            .to_string();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(mut s) = template {
        eprintln!("[blossom] monster_create: raw template arg='{}'", s);
        // Fix a common Windows input: "D\\path" (missing ":") -> "D:\\path"
        let mut ch = s.chars();
        if let (Some(drive), Some(sep)) = (ch.next(), ch.next()) {
            if drive.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", drive, rest);
                eprintln!("[blossom] monster_create: normalized Windows path -> '{}'", s);
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() {
            candidates.push(p);
        }
        if let Some(v) = &vault {
            candidates.push(PathBuf::from(v).join("_Templates").join(&s));
            candidates.push(PathBuf::from(v).join(&s));
        }
    } else {
        candidates.push(PathBuf::from(&default_template));
    }
    // Always try the default last as a safety net
    candidates.push(PathBuf::from(&default_template));

    // Try candidates in order
    let mut template_text_opt: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for cand in candidates {
        let cand_str = cand.to_string_lossy().to_string();
        eprintln!("[blossom] monster_create: trying template candidate '{}'", cand_str);
        tried.push(cand_str.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => {
                eprintln!(
                    "[blossom] monster_create: template selected '{}' ({} bytes)",
                    cand_str,
                    t.len()
                );
                template_text_opt = Some(t);
                break;
            }
            Err(e) => {
                eprintln!(
                    "[blossom] monster_create: candidate failed '{}': {}",
                    cand_str, e
                );
                last_err = Some(e.to_string());
            }
        }
    }
    let template_text = match template_text_opt {
        Some(t) => t,
        None => {
            let summary = tried.join("; ");
            let last = last_err.unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Failed to read template. Tried: {}. Last error: {}",
                summary, last
            ));
        }
    };

    // Build prompt for LLM
    let prompt = format!(
        "You are drafting a D&D 5e monster statblock. Using the TEMPLATE, fully populate it for a monster named \"{name}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML frontmatter.\n- Fill all placeholders with appropriate values.\n- Output only the completed markdown, no extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
        name = name,
        template = template_text
    );
    let system = Some(String::from(
        "You are a meticulous editor that outputs only valid Markdown and YAML frontmatter.\nInclude typical D&D 5e fields: type, size, alignment, AC, HP, speed, abilities, skills, senses, languages, CR, traits, actions. No OGL text.\n"
    ));
    eprintln!("[blossom] monster_create: invoking LLM generation");
    let content = match generate_llm(prompt, system) {
        Ok(c) => {
            eprintln!("[blossom] monster_create: LLM returned ({} bytes)", c.len());
            c
        }
        Err(e) => {
            eprintln!("[blossom] monster_create: LLM generation failed: {}", e);
            return Err(e);
        }
    };

    // Build a safe file name
    let mut fname = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() { fname = "New_Monster".to_string(); }
    let mut target = monsters_dir.join(format!("{}.md", fname));
    let mut counter = 2;
    while target.exists() {
        target = monsters_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 { break; }
    }
    eprintln!(
        "[blossom] monster_create: writing file to '{}'",
        target.to_string_lossy()
    );

    fs::write(&target, content.as_bytes()).map_err(|e| {
        eprintln!(
            "[blossom] monster_create: failed to write file '{}': {}",
            target.to_string_lossy(),
            e
        );
        e.to_string()
    })?;
    eprintln!("[blossom] monster_create: completed -> '{}'", target.to_string_lossy());

    Ok(target.to_string_lossy().to_string())
}

fn models_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("models.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

fn devices_store(app: &AppHandle) -> Result<Arc<Store<tauri::Wry>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("devices.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_whisper(app: AppHandle) -> Result<Value, String> {
    let options = vec!["tiny", "base", "small", "medium", "large"]
        .into_iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("whisper")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        std::env::set_var("WHISPER_MODEL", sel);
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_whisper(app: AppHandle, model: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("whisper".to_string(), model.clone());
    store.save().map_err(|e| e.to_string())?;
    std::env::set_var("WHISPER_MODEL", &model);
    app.emit("settings::models", json!({"whisper": model}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_piper(app: AppHandle) -> Result<Value, String> {
    let mut options = list_from_dir("assets/voice_models")
        .ok()
        .filter(|opts| !opts.is_empty())
        .or_else(|| {
            app.path()
                .resolve("assets/voice_models", BaseDirectory::Resource)
                .ok()
                .and_then(|dir| list_from_dir(dir).ok())
                .filter(|opts| !opts.is_empty())
        })
        .unwrap_or_else(|| {
            let mut fallback = Vec::new();
            if let Ok(text) = fs::read_to_string("data/voices.json") {
                if let Ok(map) = serde_json::from_str::<serde_json::Map<String, Value>>(&text) {
                    fallback.extend(map.keys().cloned());
                }
            }
            if fallback.is_empty() {
                fallback.push("narrator".to_string());
            } else {
                fallback.sort();
            }
            fallback
        });
    options.sort();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("piper")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        std::env::set_var("PIPER_VOICE", sel);
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_piper(app: AppHandle, voice: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("piper".to_string(), voice.clone());
    store.save().map_err(|e| e.to_string())?;
    std::env::set_var("PIPER_VOICE", &voice);
    app.emit("settings::models", json!({"piper": voice}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn discover_piper_voices() -> Result<Vec<String>, String> {
    match Command::new("piper-voices").arg("--json").output() {
        Ok(output) => {
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
            let voices_json: Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("failed to parse voice list: {e}"))?;
            let voices = match voices_json {
                Value::Object(map) => map.keys().cloned().collect(),
                Value::Array(arr) => arr
                    .into_iter()
                    .filter_map(|v| {
                        v.as_object()
                            .and_then(|o| o.get("id"))
                            .and_then(|id| id.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect(),
                _ => Vec::new(),
            };
            Ok(voices)
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let output = Command::new("piper").arg("--list").output().map_err(|e| {
                if e.kind() == ErrorKind::NotFound {
                    "neither piper-voices nor piper binary found".into()
                } else {
                    e.to_string()
                }
            })?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
            let voices = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .filter_map(|l| l.split_whitespace().next())
                .map(|s| s.trim_start_matches('-').to_string())
                .filter(|s| s.contains('-'))
                .collect();
            Ok(voices)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn add_piper_voice(name: String, voice: String, tags: String) -> Result<(), String> {
    let path = Path::new("data/voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    let tag_list: Vec<String> = tags
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    map.insert(
        name,
        json!({
            "voice_id": voice,
            "speed": 1.0,
            "emotion": "neutral",
            "tags": tag_list,
        }),
    );
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_piper_profiles() -> Result<Vec<PiperProfile>, String> {
    let path = Path::new("data/voices.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let map: serde_json::Map<String, Value> = serde_json::from_str(&text).unwrap_or_default();
    let mut profiles = Vec::new();
    for (name, v) in map {
        let voice_id = v
            .get("voice_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let tags = v
            .get("tags")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        profiles.push(PiperProfile {
            name,
            voice_id,
            tags,
        });
    }
    Ok(profiles)
}

#[tauri::command]
fn update_piper_profile(original: String, name: String, tags: String) -> Result<(), String> {
    let path = Path::new("data/voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    let mut profile = map.remove(&original).ok_or("profile not found")?;
    let tag_list: Vec<String> = tags
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    profile["tags"] = json!(tag_list);
    map.insert(name, profile);
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_piper_profile(name: String) -> Result<(), String> {
    let path = Path::new("data/voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    map.remove(&name);
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn piper_test(text: String, voice: String) -> Result<PathBuf, String> {
    let base = Path::new("data/piper_tests");
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let prefix = format!("{}_", voice);
    let count = fs::read_dir(base)
        .map_err(|e| e.to_string())?
        .filter(|entry| {
            entry
                .as_ref()
                .ok()
                .and_then(|e| {
                    e.file_name()
                        .to_str()
                        .map(|n| n.starts_with(&prefix) && n.ends_with(".mp3"))
                })
                .unwrap_or(false)
        })
        .count();
    let file = base.join(format!("{}_{:03}.mp3", voice, count + 1));

    let tmp = NamedTempFile::new().map_err(|e| e.to_string())?;
    let tmp_path = tmp.into_temp_path();
    let wav_path = tmp_path.to_path_buf();
    let py_script = format!(
        r#"
import soundfile as sf
from mouth.tts import TTSEngine
engine = TTSEngine()
audio = engine.synthesize({text:?}, voice={voice:?})
sf.write({wav:?}, audio, 22050)
"#,
        text = text,
        voice = voice,
        wav = wav_path.to_string_lossy()
    );
    let mut cmd = python_command();
    let status = cmd
        .arg("-c")
        .arg(py_script)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("piper synthesis failed".into());
    }
    let wav_str = wav_path.to_string_lossy().to_string();
    let out_str = file.to_string_lossy().to_string();
    let status = Command::new("ffmpeg")
        .args(["-y", "-i", &wav_str, &out_str])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("audio conversion failed".into());
    }
    drop(tmp_path);
    Ok(file)
}

#[tauri::command]
fn musicgen_test(app_handle: AppHandle) -> Result<Vec<u8>, String> {
    let script = app_handle
        .path()
        .resolve("scripts/test_musicgen.py", BaseDirectory::Resource)
        .map_err(|_| "failed to resolve test script".to_string())?;
    let mut cmd = python_command();
    let output = cmd.arg(script).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let out_path = Path::new("out/musicgen_sample.wav");
    let bytes = fs::read(out_path).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[tauri::command]
fn hotword_get() -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .args(["-m", "ears.hotword", "list"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(parsed)
}

#[tauri::command]
fn hotword_set(
    app: AppHandle,
    name: String,
    enabled: bool,
    file: Option<String>,
) -> Result<(), String> {
    if let Some(src) = file {
        let src_path = PathBuf::from(&src);
        if let Some(fname) = src_path.file_name() {
            let dest_dir = Path::new("ears").join("hotwords");
            fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
            let dest = dest_dir.join(fname);
            fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
        }
    }
    let mut cmd = python_command();
    let status = cmd
        .args([
            "-m",
            "ears.hotword",
            "set",
            &name,
            if enabled { "1" } else { "0" },
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("hotword configuration failed".into());
    }
    app.emit(
        "settings::hotwords",
        json!({ "name": name, "enabled": enabled }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_llm(app: AppHandle) -> Result<Value, String> {
    let stdout_bytes = Command::new("ollama")
        .arg("list")
        .output()
        .map(|o| o.stdout)
        .unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let mut options = Vec::new();
    for line in stdout.lines().skip(1) {
        if let Some(name) = line.split_whitespace().next() {
            if !name.is_empty() {
                options.push(name.to_string());
            }
        }
    }
    if options.is_empty() {
        options.push("mistral".to_string());
    }
    options.sort();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("llm")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        std::env::set_var("LLM_MODEL", sel);
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_llm(app: AppHandle, model: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("llm".to_string(), model.clone());
    store.save().map_err(|e| e.to_string())?;
    std::env::set_var("LLM_MODEL", &model);
    app.emit("settings::models", json!({"llm": model}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pull_llm(model: String) -> Result<String, String> {
    // Run `ollama pull <model>` and return stdout/stderr text on success/failure
    let output = Command::new("ollama").arg("pull").arg(&model).output().map_err(|e| e.to_string())?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(text)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn list_devices(app: AppHandle) -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .args(["-m", "ears.devices"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let input_opts = parsed
        .get("input")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    let output_opts = parsed
        .get("output")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    let store = devices_store(&app)?;
    let selected_input = store
        .get("input")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let selected_output = store
        .get("output")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    if let Some(id) = selected_input {
        env::set_var("INPUT_DEVICE", id.to_string());
    }
    if let Some(id) = selected_output {
        env::set_var("OUTPUT_DEVICE", id.to_string());
    }
    Ok(json!({
        "input": {"options": input_opts, "selected": selected_input},
        "output": {"options": output_opts, "selected": selected_output}
    }))
}

#[tauri::command]
fn set_devices(app: AppHandle, input: Option<u32>, output: Option<u32>) -> Result<(), String> {
    let store = devices_store(&app)?;
    if let Some(id) = input {
        store.set("input".to_string(), id as u64);
        env::set_var("INPUT_DEVICE", id.to_string());
    } else {
        store.delete("input");
        env::remove_var("INPUT_DEVICE");
    }
    if let Some(id) = output {
        store.set("output".to_string(), id as u64);
        env::set_var("OUTPUT_DEVICE", id.to_string());
    } else {
        store.delete("output");
        env::remove_var("OUTPUT_DEVICE");
    }
    store.save().map_err(|e| e.to_string())?;
    app.emit(
        "settings::devices",
        json!({"input": input, "output": output}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn app_version() -> Result<Value, String> {
    let app = env!("CARGO_PKG_VERSION").to_string();
    let mut cmd = python_command();
    let output = cmd.arg("--version").output().map_err(|e| e.to_string())?;
    let python = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    Ok(json!({ "app": app, "python": python }))
}

#[tauri::command]
fn spawn_job_with_context(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
    context: JobContext,
) -> Result<u64, String> {
    let id = registry.next_id();
    let job = JobInfo::new_pending(args.clone(), &context);
    registry.enqueue_job(id, job)?;
    registry.update_queue_positions(&app);
    registry.maybe_start_jobs(&app);
    Ok(id)
}

#[tauri::command]
fn start_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
) -> Result<u64, String> {
    spawn_job_with_context(app, registry, args, JobContext::default())
}

#[tauri::command]
fn train_model(
    app: AppHandle,
    registry: State<JobRegistry>,
    midi_files: Vec<String>,
    epochs: u32,
    lr: f32,
) -> Result<u64, String> {
    let script = if Path::new("training/run_phrase_train.py").exists() {
        "training/run_phrase_train.py".to_string()
    } else {
        "../training/run_phrase_train.py".to_string()
    };
    let mut args = vec![script, "--midis".into()];
    args.extend(midi_files);
    args.push("--epochs".into());
    args.push(epochs.to_string());
    args.push("--lr".into());
    args.push(lr.to_string());
    start_job(app, registry, args)
}

#[tauri::command]
fn cancel_render(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
    registry.cancel_job(&app, job_id)
}

#[tauri::command]
fn cancel_job(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
    registry.cancel_job(&app, job_id)
}

#[derive(Serialize, Clone)]
struct JobState {
    status: String,
    message: Option<String>,
    stdout: Vec<String>,
    stderr: Vec<String>,
    created_at: Option<String>,
    finished_at: Option<String>,
    args: Vec<String>,
    artifacts: Vec<JobArtifact>,
    progress: Option<JobProgressSnapshot>,
    kind: Option<String>,
    label: Option<String>,
    cancelled: bool,
}

fn format_timestamp(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn format_eta_string(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

fn sanitize_file_stem(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        "loop".to_string()
    } else {
        out.chars().take(120).collect()
    }
}

fn sanitize_musicgen_base_name(name: Option<&str>, fallback: &str) -> String {
    let raw = name.unwrap_or("").trim();
    let mut sanitized = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    let mut cleaned = sanitized.trim().trim_matches('.').to_string();
    if cleaned.len() > 120 {
        cleaned = cleaned.chars().take(120).collect();
    }
    cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        return fallback.to_string();
    }
    let lower = cleaned.to_lowercase();
    let without_ext = if lower.ends_with(".wav") {
        cleaned[..cleaned.len() - 4]
            .trim()
            .trim_matches('.')
            .to_string()
    } else {
        cleaned.clone()
    };
    let final_name = without_ext.trim().trim_matches('.').to_string();
    if final_name.is_empty() {
        fallback.to_string()
    } else {
        final_name
    }
}

#[tauri::command]
fn export_loop_video(
    app: AppHandle,
    registry: State<JobRegistry>,
    input_path: String,
    target_seconds: f64,
    clip_seconds: Option<f64>,
    outdir: Option<String>,
    output_name: Option<String>,
) -> Result<u64, String> {
    let in_path = PathBuf::from(&input_path);
    if !in_path.exists() {
        return Err("Input video does not exist".into());
    }
    let clip = clip_seconds.unwrap_or(0.0);
    if target_seconds <= 0.0 {
        return Err("Target seconds must be > 0".into());
    }
    if clip <= 0.0 {
        return Err("Clip duration unknown; cannot compute loops".into());
    }
    let loops = (target_seconds / clip).floor() as i64;
    let remainder = target_seconds - (loops as f64) * clip;
    let eps = 0.0005_f64;

    // Determine output directory
    let out_dir = if let Some(dir) = outdir {
        PathBuf::from(dir)
    } else {
        // Default to app data jobs/loops
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("jobs")
            .join("loops")
    };
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    // Determine output filename
    let stem = if let Some(name) = output_name {
        sanitize_file_stem(&name)
    } else {
        in_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(sanitize_file_stem)
            .unwrap_or_else(|| "loop".to_string())
    };
    let out_path = out_dir.join(format!("{}.mp4", stem));
    let out_path_str = out_path.to_string_lossy().to_string();

    let script = if Path::new("scripts/export_loop_video.py").exists() {
        "scripts/export_loop_video.py".to_string()
    } else {
        "../scripts/export_loop_video.py".to_string()
    };

    let input_arg = in_path
        .canonicalize()
        .unwrap_or_else(|_| in_path.clone())
        .to_string_lossy()
        .to_string();

    let mut args = vec![script];
    args.push("--input".into());
    args.push(input_arg);
    args.push("--target-seconds".into());
    args.push(format!("{:.6}", target_seconds));
    args.push("--clip-seconds".into());
    args.push(format!("{:.6}", clip));
    args.push("--output".into());
    args.push(out_path_str.clone());
    args.push("--label".into());
    args.push(stem.clone());
    args.push("--remainder".into());
    args.push(format!("{:.6}", remainder.max(0.0)));

    let artifact_candidates = vec![JobArtifactCandidate {
        name: format!("{} (MP4)", stem.clone()),
        path: out_path.clone(),
    }];

    let context = JobContext {
        kind: Some("loop-maker".into()),
        label: Some(stem),
        artifact_candidates,
    };

    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn job_state_from_registry(app: &AppHandle, registry: &JobRegistry, job_id: u64) -> JobState {
    let mut finalize_request: Option<(bool, Option<i32>)> = None;
    let mut state = JobState {
        status: "not-found".into(),
        message: None,
        stdout: Vec::new(),
        stderr: Vec::new(),
        created_at: None,
        finished_at: None,
        args: Vec::new(),
        artifacts: Vec::new(),
        progress: None,
        kind: None,
        label: None,
        cancelled: false,
    };

    {
        let mut jobs = registry.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            state.args = job.args.clone();
            state.created_at = Some(format_timestamp(job.created_at));
            state.kind = job.kind.clone();
            state.label = job.label.clone();
            state.cancelled = job.cancelled;
            state.stdout = job
                .stdout_excerpt
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            state.stderr = job
                .stderr_excerpt
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            state.artifacts = job
                .artifacts
                .lock()
                .map(|items| items.clone())
                .unwrap_or_default();
            state.progress = job
                .progress
                .lock()
                .map(|p| (*p).clone())
                .unwrap_or_default();
            if job.cancelled {
                state.status = "cancelled".into();
                state.finished_at = job.finished_at.map(format_timestamp);
            } else if let Some(success) = job.status {
                state.status = if success { "completed" } else { "error" }.into();
                state.finished_at = job.finished_at.map(format_timestamp);
                if !success {
                    let stderr = job.stderr_full.lock().unwrap().clone();
                    state.message = extract_error_message(&stderr).or_else(|| {
                        let trimmed = stderr.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    });
                }
            } else if job.pending {
                state.status = "queued".into();
            } else {
                let mut child_guard = job.child.lock().unwrap();
                if let Some(child) = child_guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            finalize_request = Some((status.success(), status.code()));
                        }
                        Ok(None) => {
                            state.status = "running".into();
                        }
                        Err(_) => {
                            finalize_request = Some((false, None));
                        }
                    }
                } else {
                    state.status = "running".into();
                }
            }
        }
    }

    if let Some((success, code)) = finalize_request {
        registry.complete_job(app, job_id, success, code, false);
        registry.maybe_start_jobs(app);
        return job_state_from_registry(app, registry, job_id);
    }

    if state.status == "not-found" {
        if let Some(record) = registry.list_history().into_iter().find(|r| r.id == job_id) {
            state.status = record.status_text();
            state.args = record.args.clone();
            state.kind = record.kind.clone();
            state.label = record.label.clone();
            state.stdout = record.stdout_excerpt.clone();
            state.stderr = record.stderr_excerpt.clone();
            state.artifacts = record.artifacts.clone();
            state.progress = record.progress.clone();
            state.created_at = Some(format_timestamp(record.created_at));
            state.finished_at = record.finished_at.map(format_timestamp);
            state.cancelled = record.cancelled;
            if record.success == Some(false) {
                if let Some(msg) = state
                    .stderr
                    .iter()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                {
                    state.message = Some(msg.clone());
                }
            }
        }
    }

    state
}

#[tauri::command]
fn job_status(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> JobState {
    job_state_from_registry(&app, &registry, job_id)
}

#[tauri::command]
fn job_details(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> JobState {
    job_state_from_registry(&app, &registry, job_id)
}

#[tauri::command]
fn list_job_queue(registry: State<JobRegistry>) -> Vec<QueueEntry> {
    let queue_ids: Vec<u64> = registry.queue.lock().unwrap().iter().copied().collect();
    let mut running_entries = Vec::new();
    let mut pending_info: HashMap<
        u64,
        (DateTime<Utc>, Option<String>, Option<String>, Vec<String>),
    > = HashMap::new();
    {
        let jobs = registry.jobs.lock().unwrap();
        for (&id, job) in jobs.iter() {
            if job.cancelled || job.status.is_some() {
                continue;
            }
            if job.pending {
                pending_info.insert(
                    id,
                    (
                        job.queued_at,
                        job.label.clone(),
                        job.kind.clone(),
                        job.args.clone(),
                    ),
                );
            } else {
                running_entries.push(QueueEntry {
                    id,
                    status: "running".into(),
                    position: None,
                    queued_at: Some(format_timestamp(job.queued_at)),
                    started_at: job.started_at.map(format_timestamp),
                    label: job.label.clone(),
                    kind: job.kind.clone(),
                    args: job.args.clone(),
                    eta_seconds: None,
                });
            }
        }
    }
    running_entries.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    let running_count = running_entries.len();
    let mut queued_entries = Vec::new();
    for (idx, id) in queue_ids.iter().enumerate() {
        if let Some((queued_at, label, kind, args)) = pending_info.get(id) {
            let eta_seconds = registry.estimate_queue_eta_seconds(idx, running_count);
            queued_entries.push(QueueEntry {
                id: *id,
                status: "queued".into(),
                position: Some(idx),
                queued_at: Some(format_timestamp(*queued_at)),
                started_at: None,
                label: label.clone(),
                kind: kind.clone(),
                args: args.clone(),
                eta_seconds,
            });
        }
    }
    running_entries.extend(queued_entries);
    running_entries
}

#[derive(Serialize)]
struct JobSummary {
    id: u64,
    status: String,
    created_at: Option<String>,
    finished_at: Option<String>,
    kind: Option<String>,
    label: Option<String>,
    args: Vec<String>,
}

#[derive(Serialize)]
struct QueueEntry {
    id: u64,
    status: String,
    position: Option<usize>,
    queued_at: Option<String>,
    started_at: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    args: Vec<String>,
    eta_seconds: Option<u64>,
}

#[tauri::command]
fn list_completed_jobs(registry: State<JobRegistry>) -> Vec<JobSummary> {
    let mut history = registry.list_history();
    history.sort_by(|a, b| {
        let at = a.finished_at.unwrap_or(a.created_at);
        let bt = b.finished_at.unwrap_or(b.created_at);
        bt.cmp(&at)
    });
    history
        .into_iter()
        .map(|record| JobSummary {
            id: record.id,
            status: record.status_text(),
            created_at: Some(format_timestamp(record.created_at)),
            finished_at: record.finished_at.map(format_timestamp),
            kind: record.kind.clone(),
            label: record.label.clone(),
            args: record.args.clone(),
        })
        .collect()
}

#[tauri::command]
fn register_job_artifacts(
    registry: State<JobRegistry>,
    job_id: u64,
    artifacts: Vec<JobArtifact>,
) -> Result<(), String> {
    let mut jobs = registry.jobs.lock().map_err(|e| e.to_string())?;
    if let Some(job) = jobs.get_mut(&job_id) {
        let mut stored = job.artifacts.lock().unwrap();
        for artifact in artifacts {
            if !stored.iter().any(|a| a.path == artifact.path) {
                stored.push(artifact);
            }
        }
        return Ok(());
    }
    drop(jobs);
    let mut history = registry.history.lock().map_err(|e| e.to_string())?;
    if let Some(record) = history.iter_mut().find(|r| r.id == job_id) {
        for artifact in artifacts {
            if !record.artifacts.iter().any(|a| a.path == artifact.path) {
                record.artifacts.push(artifact);
            }
        }
    } else {
        return Err("Unknown job_id".into());
    }
    drop(history);
    if let Err(err) = registry.persist_history() {
        eprintln!(
            "failed to persist job history after artifact registration: {}",
            err
        );
    }
    Ok(())
}

#[tauri::command]
fn prune_job_history(registry: State<JobRegistry>, retain: usize) {
    registry.prune_history(retain);
}

#[tauri::command]
fn queue_musicgen_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: MusicGenJobRequest,
) -> Result<u64, String> {
    if options.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".into());
    }
    if options.duration <= 0.0 {
        return Err("Duration must be greater than zero".into());
    }

    // Always invoke the script from the project root to avoid relative path confusion.
    let script = project_root()
        .join("main_musicgen.py")
        .to_string_lossy()
        .to_string();

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let default_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jobs")
        .join("musicgen")
        .join(format!("musicgen-{}", timestamp));

    let output_dir = options
        .output_dir
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let fallback_name = format!("musicgen-{}", timestamp);
    let base_name = sanitize_musicgen_base_name(options.output_name.as_deref(), &fallback_name);

    let mut count = options.count.unwrap_or(1);
    if count == 0 {
        count = 1;
    } else if count > 10 {
        count = 10;
    }

    let width = if count > 1 {
        ((count as f32).log10().floor() as usize) + 1
    } else {
        0
    };

    let mut filenames = Vec::with_capacity(count as usize);
    for idx in 0..count {
        let mut name = if count > 1 {
            format!("{}_{:0width$}", base_name, idx + 1, width = width)
        } else {
            base_name.clone()
        };
        if !name.to_lowercase().ends_with(".wav") {
            name.push_str(".wav");
        }
        filenames.push(name);
    }

    let summary_path = output_dir.join(format!("musicgen-summary-{}.json", timestamp));

    let mut artifact_candidates = Vec::new();
    for fname in &filenames {
        let path = output_dir.join(fname);
        let display = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(fname)
            .to_string();
        artifact_candidates.push(JobArtifactCandidate {
            name: display,
            path,
        });
    }
    artifact_candidates.push(JobArtifactCandidate {
        name: "Summary JSON".into(),
        path: summary_path.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Output Directory".into(),
        path: output_dir.clone(),
    });

    let mut args = vec![script];
    args.push("--prompt".into());
    args.push(options.prompt.clone());
    args.push("--duration".into());
    args.push(format!("{}", options.duration));
    args.push("--model".into());
    args.push(options.model_name.clone());
    args.push("--temperature".into());
    args.push(format!("{}", options.temperature));
    args.push("--output-dir".into());
    args.push(output_dir.to_string_lossy().to_string());
    args.push("--count".into());
    args.push(count.to_string());
    args.push("--base-name".into());
    args.push(base_name.clone());
    args.push("--summary-path".into());
    args.push(summary_path.to_string_lossy().to_string());

    if let Some(melody) = options
        .melody_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("--melody-path".into());
        args.push(melody.to_string());
    }

    if options.force_cpu.unwrap_or(false) {
        args.push("--force-cpu".into());
    } else {
        if options.force_gpu.unwrap_or(false) {
            args.push("--force-gpu".into());
        }
        if options.use_fp16.unwrap_or(false) {
            args.push("--use-fp16".into());
        }
    }

    let label_source = options
        .output_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let prompt_trim = options.prompt.trim();
            if prompt_trim.is_empty() {
                format!("MusicGen {}", timestamp)
            } else {
                let mut preview: String = prompt_trim.chars().take(80).collect();
                if prompt_trim.chars().count() > 80 {
                    preview.push('…');
                }
                preview
            }
        });
    let label: String = label_source.chars().take(120).collect();

    let context = JobContext {
        kind: Some("musicgen".into()),
        label: Some(label),
        artifact_candidates,
    };

    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn queue_render_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: RenderJobRequest,
) -> Result<u64, String> {
    let mut args: Vec<String> = vec!["main_render.py".into(), "--verbose".into()];

    let base_output = if let Some(dir) = options.outdir.as_ref() {
        PathBuf::from(dir)
    } else {
        let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("jobs")
            .join(format!("render-{}", timestamp))
    };
    fs::create_dir_all(&base_output).map_err(|e| e.to_string())?;
    let stems_dir = base_output.join("stems");
    fs::create_dir_all(&stems_dir).map_err(|e| e.to_string())?;

    let sanitize = |s: &str| {
        let mut out = String::new();
        for ch in s.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        let trimmed = out.trim().trim_matches('.').to_string();
        if trimmed.is_empty() {
            "mix".to_string()
        } else {
            trimmed.chars().take(120).collect()
        }
    };

    let ensure_wav = |mut s: String| {
        if !s.to_lowercase().ends_with(".wav") {
            s.push_str(".wav");
        }
        s
    };

    let name = options.name.clone().unwrap_or_else(|| "mix".into());
    let mix_filename = ensure_wav(sanitize(&name));
    let mix_path = base_output.join(&mix_filename);
    let bundle_dir = base_output.clone();

    args.push("--mix".into());
    args.push(mix_path.to_string_lossy().to_string());
    args.push("--stems".into());
    args.push(stems_dir.to_string_lossy().to_string());
    args.push("--bundle".into());
    args.push(bundle_dir.to_string_lossy().to_string());

    if let Some(preset) = options.preset.filter(|s| !s.trim().is_empty()) {
        args.push("--preset".into());
        args.push(preset);
    }
    if let Some(style) = options.style.filter(|s| !s.trim().is_empty()) {
        args.push("--style".into());
        args.push(style);
    }
    if let Some(minutes) = options.minutes {
        args.push("--minutes".into());
        args.push(minutes.to_string());
    }
    if let Some(seed) = options.seed {
        args.push("--seed".into());
        args.push(seed.to_string());
    }
    if let Some(sampler_seed) = options.sampler_seed {
        args.push("--sampler-seed".into());
        args.push(sampler_seed.to_string());
    }
    if let Some(mix_preset) = options.mix_preset.filter(|s| !s.trim().is_empty()) {
        args.push("--mix-preset".into());
        args.push(mix_preset);
    }
    if let Some(arrange) = options.arrange.filter(|s| !s.trim().is_empty()) {
        args.push("--arrange".into());
        args.push(arrange);
    }
    if let Some(outro) = options.outro.filter(|s| !s.trim().is_empty()) {
        args.push("--outro".into());
        args.push(outro);
    }
    if let Some(preview) = options.preview {
        args.push("--preview".into());
        args.push(preview.to_string());
    }
    if options.bundle_stems.unwrap_or(false) {
        args.push("--bundle-stems".into());
    }
    if options.eval_only.unwrap_or(false) {
        args.push("--eval-only".into());
    }
    if options.dry_run.unwrap_or(false) {
        args.push("--dry-run".into());
    }
    if let Some(keys) = options.keys_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--keys-sfz".into());
        args.push(keys);
    }
    if let Some(pads) = options.pads_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--pads-sfz".into());
        args.push(pads);
    }
    if let Some(bass) = options.bass_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--bass-sfz".into());
        args.push(bass);
    }
    if let Some(drums) = options.drums_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--drums-sfz".into());
        args.push(drums);
    }
    if let Some(drums_model) = options.drums_model.filter(|s| !s.trim().is_empty()) {
        args.push("--drums-model".into());
        args.push(drums_model);
    }
    if let Some(bass_model) = options.bass_model.filter(|s| !s.trim().is_empty()) {
        args.push("--bass-model".into());
        args.push(bass_model);
    }
    if let Some(keys_model) = options.keys_model.filter(|s| !s.trim().is_empty()) {
        args.push("--keys-model".into());
        args.push(keys_model);
    }
    if let Some(melody) = options.melody_midi.filter(|s| !s.trim().is_empty()) {
        args.push("--melody-midi".into());
        args.push(melody);
    }
    match options.phrase {
        Some(true) => {
            args.push("--use-phrase-model".into());
            args.push("yes".into());
        }
        Some(false) => {
            args.push("--use-phrase-model".into());
            args.push("no".into());
        }
        None => {}
    }

    if let Some(mix_config) = options.mix_config.filter(|s| !s.trim().is_empty()) {
        let path = base_output.join("mix_config.json");
        fs::write(&path, mix_config).map_err(|e| e.to_string())?;
        args.push("--mix-config".into());
        args.push(path.to_string_lossy().to_string());
    }
    if let Some(arrange_config) = options.arrange_config.filter(|s| !s.trim().is_empty()) {
        let path = base_output.join("arrange_config.json");
        fs::write(&path, arrange_config).map_err(|e| e.to_string())?;
        args.push("--arrange-config".into());
        args.push(path.to_string_lossy().to_string());
    }

    let mut artifact_candidates = vec![JobArtifactCandidate {
        name: "Mix".into(),
        path: mix_path.clone(),
    }];
    let stems_mid = stems_dir.join("stems.mid");
    artifact_candidates.push(JobArtifactCandidate {
        name: "Stems MIDI".into(),
        path: stems_mid,
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Bundle ZIP".into(),
        path: bundle_dir.join("bundle.zip"),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Bundle Directory".into(),
        path: bundle_dir.clone(),
    });

    let context = JobContext {
        kind: Some("music-render".into()),
        label: Some(name),
        artifact_candidates,
    };

    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn record_manual_job(
    registry: State<JobRegistry>,
    kind: Option<String>,
    label: Option<String>,
    args: Option<Vec<String>>,
    artifacts: Option<Vec<JobArtifact>>,
    stdout: Option<Vec<String>>,
    stderr: Option<Vec<String>>,
    success: Option<bool>,
) -> u64 {
    let id = registry.next_id();
    let now = Utc::now();
    let record = JobRecord {
        id,
        kind,
        label,
        args: args.unwrap_or_default(),
        created_at: now,
        started_at: Some(now),
        finished_at: Some(now),
        success: success.or(Some(true)),
        exit_code: None,
        stdout_excerpt: stdout.unwrap_or_default(),
        stderr_excerpt: stderr.unwrap_or_default(),
        artifacts: artifacts.unwrap_or_default(),
        progress: None,
        cancelled: false,
    };
    registry.push_history(record);
    id
}

#[tauri::command]
fn discord_profile_get(guild_id: u64, channel_id: u64) -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .arg("-c")
        .arg(
            "import sys, json; from config.discord_profiles import get_profile; print(json.dumps(get_profile(int(sys.argv[1]), int(sys.argv[2]))))",
        )
        .arg(guild_id.to_string())
        .arg(channel_id.to_string())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        let data: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn discord_profile_set(guild_id: u64, channel_id: u64, profile: Value) -> Result<(), String> {
    let mut cmd = python_command();
    cmd.arg("-c").arg(
        "import sys, json; from config.discord_profiles import set_profile; set_profile(int(sys.argv[1]), int(sys.argv[2]), json.loads(sys.stdin.read()))",
    );
    cmd.arg(guild_id.to_string()).arg(channel_id.to_string());
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        let payload = serde_json::to_vec(&profile).map_err(|e| e.to_string())?;
        stdin.write_all(&payload).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn select_vault(path: String) -> Result<(), String> {
    let mut cmd = python_command();
    let status = cmd
        .arg("-c")
        .arg("import sys; from config.obsidian import select_vault; select_vault(sys.argv[1])")
        .arg(&path)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Failed to select vault".into())
    }
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if let Ok(url) = Url::parse(&path) {
        // Use new tauri_plugin_opener API which requires an optional identifier
        app.opener()
            .open_url(url, Option::<&str>::None)
            .map_err(|e| e.to_string())
    } else {
        let path_buf = PathBuf::from(&path);
        if !path_buf.exists() {
            return Err("Path does not exist".into());
        }
        let path_str = path_buf
            .to_str()
            .ok_or("Invalid Unicode in path")?
            .to_string();
        app.opener()
            .open_path(path_str, Option::<&str>::None)
            .map_err(|e| e.to_string())
    }
}

fn main() {
    if let Err(e) = fs::create_dir_all(Path::new("models")) {
        eprintln!("failed to create models directory: {}", e);
    }

    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(shell_init())
        .plugin(fs_init())
        .plugin(Builder::new().build())
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            if let Ok(dir) = app.path().app_data_dir() {
                let history_path = dir.join("jobs_history.json");
                let queue_path = dir.join("jobs_queue.json");
                let registry = app.state::<JobRegistry>();
                if let Err(err) = registry.init_persistence(history_path, queue_path) {
                    eprintln!("failed to initialize job history: {}", err);
                }
                let app_handle = app.handle();
                registry.resume_pending(&app_handle);
            }
            // Prefer a repo-root virtualenv (../.venv) when running from src-tauri
            let venv_base = if Path::new(".venv").exists() {
                PathBuf::from(".venv")
            } else {
                PathBuf::from("..").join(".venv")
            };
            let venv_dir = if cfg!(target_os = "windows") {
                venv_base.join("Scripts")
            } else {
                venv_base.join("bin")
            };
            let sep = if cfg!(target_os = "windows") {
                ';'
            } else {
                ':'
            };
            let mut path_var = env::var("PATH").unwrap_or_default();
            env::set_var("PATH", format!("{}{}{}", venv_dir.display(), sep, path_var));

            let mut version_cmd = python_command();
            let version_ok = version_cmd
                .args([
                    "-c",
                    "import sys; exit(0) if sys.version_info[:2]==(3,10) else exit(1)",
                ])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if !version_ok {
                // Resolve start.py whether current dir is repo root or src-tauri
                let start_py = if Path::new("start.py").exists() {
                    PathBuf::from("start.py")
                } else {
                    PathBuf::from("..").join("start.py")
                };
                let mut cmd = python_command();
                cmd.arg(&start_py)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                if let Some(parent) = start_py.parent() {
                    cmd.current_dir(parent);
                }
                let output = cmd.output();
                if !output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                    let mut msg = String::from("Failed to set up Python environment.");
                    if let Ok(o) = output {
                        let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if !out.is_empty() {
                            msg.push_str("\nstdout: ");
                            msg.push_str(&out);
                        }
                        if !err.is_empty() {
                            msg.push_str("\nstderr: ");
                            msg.push_str(&err);
                        }
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("Setup Error");
                        window.dialog().message(&msg);
                    }
                    return Err("Python setup failed".into());
                }
                path_var = env::var("PATH").unwrap_or_default();
                env::set_var("PATH", format!("{}{}{}", venv_dir.display(), sep, path_var));
                // Re-check the version now that setup ran
                let mut recheck_cmd = python_command();
                let version_ok_after = recheck_cmd
                    .args([
                        "-c",
                        "import sys; exit(0) if sys.version_info[:2]==(3,10) else exit(1)",
                    ])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if !version_ok_after {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("Setup Error");
                        window
                            .dialog()
                            .message("Python 3.10 environment not available after setup.");
                    }
                    return Err("Python setup failed".into());
                }
            }
            Ok(())
        })
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            inbox_list,
            inbox_read,
            dir_list,
            monster_create,
            npc_create,
            list_whisper,
            set_whisper,
            list_piper,
            set_piper,
            discover_piper_voices,
            add_piper_voice,
            list_piper_profiles,
            update_piper_profile,
            remove_piper_profile,
            piper_test,
            write_discord_token,
            musicgen_test,
            generate_musicgen,
            musicgen_env,
            resolve_resource,
            list_bundled_voices,
            commands::read_file_bytes,
            album_concat,
            list_llm,
            set_llm,
            pull_llm,
            generate_llm,
            lore_list,
            npc_list,
            npc_save,
            npc_delete,
            list_devices,
            set_devices,
            hotword_get,
            hotword_set,
            app_version,
            start_job,
            train_model,
            cancel_render,
            cancel_job,
            job_status,
            job_details,
            list_job_queue,
            list_completed_jobs,
            register_job_artifacts,
            prune_job_history,
            queue_musicgen_job,
            queue_render_job,
            record_manual_job,
            discord_profile_get,
            discord_profile_set,
            select_vault,
            open_path,
            export_loop_video,
            config::get_config,
            config::set_config,
            config::export_settings,
            config::import_settings,
            musiclang::list_musiclang_models,
            musiclang::download_model
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                let registry = app_handle.state::<JobRegistry>();
                let mut to_requeue = Vec::new();
                {
                    let mut jobs = registry.jobs.lock().unwrap();
                    for (id, job) in jobs.iter_mut() {
                        if job.cancelled || job.status.is_some() {
                            continue;
                        }
                        {
                            let mut child_guard = job.child.lock().unwrap();
                            if let Some(mut child) = child_guard.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                        }
                        job.pending = true;
                        job.started_at = None;
                        job.finished_at = None;
                        to_requeue.push(*id);
                    }
                }
                if !to_requeue.is_empty() {
                    let mut queue = registry.queue.lock().unwrap();
                    for id in to_requeue.into_iter().rev() {
                        if !queue.contains(&id) {
                            queue.push_front(id);
                        }
                    }
                }
                if let Err(err) = registry.persist_queue() {
                    eprintln!("failed to persist job queue on shutdown: {}", err);
                }
            }
        })
        .run(tauri::generate_context!())
    {
        eprintln!("error while running tauri application: {}", e);
    }
}
