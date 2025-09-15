#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    env, fs,
    io::{BufRead, BufReader, ErrorKind},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use regex::Regex;
use serde_json::{json, Value};
use tauri::Emitter;
use tauri::{async_runtime, AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::{Builder, Store, StoreBuilder};
use tempfile::NamedTempFile;
use url::Url;
mod config;
mod musiclang;
mod util;
use crate::util::list_from_dir;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Npc {
    name: String,
    description: String,
    prompt: String,
    voice: String,
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
    if let Ok(output) = Command::new("python")
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

struct JobInfo {
    child: Option<Child>,
    status: Option<bool>,
    stderr: Arc<Mutex<String>>,
}

struct JobRegistry {
    jobs: Mutex<HashMap<u64, JobInfo>>,
    counter: AtomicU64,
}

impl JobRegistry {
    fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
        }
    }

    fn add(&self, job: JobInfo) -> u64 {
        let id = self.counter.fetch_add(1, Ordering::SeqCst);
        self.jobs.lock().unwrap().insert(id, job);
        id
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
    let mut options = Vec::new();
    if let Ok(text) = fs::read_to_string("data/voices.json") {
        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, Value>>(&text) {
            options.extend(map.keys().cloned());
        }
    }
    if options.is_empty() {
        options.push("narrator".to_string());
    }
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
    let output = Command::new("piper-voices")
        .arg("--json")
        .output()
        .map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                "piper-voices binary not found".into()
            } else {
                e.to_string()
            }
        })?;
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
    let status = Command::new("python")
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
fn musicgen_test() -> Result<Vec<u8>, String> {
    let status = Command::new("python")
        .arg("scripts/test_musicgen.py")
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("musicgen test failed".into());
    }
    let out_path = Path::new("out/musicgen_sample.wav");
    let bytes = fs::read(out_path).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[tauri::command]
fn hotword_get() -> Result<Value, String> {
    let output = Command::new("python")
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
    let status = Command::new("python")
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
fn list_devices(app: AppHandle) -> Result<Value, String> {
    let output = Command::new("python")
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
    let output = Command::new("python")
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;
    let python = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    Ok(json!({ "app": app, "python": python }))
}

#[tauri::command]
fn start_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
) -> Result<u64, String> {
    let mut child = Command::new("python")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr_pipe {
        let stderr_buf_clone = stderr_buf.clone();
        let app_handle = app.clone();
        async_runtime::spawn(async move {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let mut buf = stderr_buf_clone.lock().unwrap();
                buf.push_str(&line);
                buf.push('\n');
                let _ = app_handle.emit("logs::line", line.clone());
            }
        });
    }
    let job = JobInfo {
        child: Some(child),
        status: None,
        stderr: stderr_buf,
    };
    let id = registry.add(job);

    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        async_runtime::spawn(async move {
            let stage_re = Regex::new(r"^\s*([\w-]+):").unwrap();
            let percent_re = Regex::new(r"(\d+)%").unwrap();
            let eta_re = Regex::new(r"ETA[:\s]+([0-9:]+)").unwrap();
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let stage = stage_re.captures(&line).map(|c| c[1].to_string());
                let percent = percent_re
                    .captures(&line)
                    .and_then(|c| c[1].parse::<u8>().ok());
                let eta = eta_re.captures(&line).map(|c| c[1].to_string());
                let event = ProgressEvent {
                    stage,
                    percent,
                    message: Some(line.clone()),
                    eta,
                    step: None,
                    total: None,
                };
                let _ = app_handle.emit("logs::line", line.clone());
                let _ = app_handle.emit(&format!("progress::{}", id), event);
            }
        });
    }

    Ok(id)
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
    let mut jobs = registry.jobs.lock().map_err(|e| e.to_string())?;
    match jobs.get_mut(&job_id) {
        Some(job) => {
            if job.status.is_some() || job.child.is_none() {
                return Err("Job already completed".into());
            }
            if let Some(child) = job.child.as_mut() {
                child.kill().map_err(|e| e.to_string())?;
                let status = child.wait().map_err(|e| e.to_string())?;
                job.status = Some(status.success());
                job.child = None;
                Ok(())
            } else {
                Err("Job already completed".into())
            }
        }
        None => Err("Unknown job_id".into()),
    }
}

#[derive(serde::Serialize)]
struct JobState {
    status: String,
    message: Option<String>,
}

#[tauri::command]
fn job_status(registry: State<JobRegistry>, job_id: u64) -> JobState {
    let mut jobs = registry.jobs.lock().unwrap();
    match jobs.get_mut(&job_id) {
        Some(job) => {
            if let Some(success) = job.status {
                JobState {
                    status: if success { "completed" } else { "error" }.into(),
                    message: if success {
                        None
                    } else {
                        let stderr = job.stderr.lock().unwrap().clone();
                        extract_error_message(&stderr).or_else(|| {
                            if stderr.is_empty() {
                                None
                            } else {
                                Some(stderr)
                            }
                        })
                    },
                }
            } else if let Some(child) = job.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let success = status.success();
                        job.status = Some(success);
                        job.child = None;
                        JobState {
                            status: if success { "completed" } else { "error" }.into(),
                            message: if success {
                                None
                            } else {
                                let stderr = job.stderr.lock().unwrap().clone();
                                extract_error_message(&stderr).or_else(|| {
                                    if stderr.is_empty() {
                                        None
                                    } else {
                                        Some(stderr)
                                    }
                                })
                            },
                        }
                    }
                    Ok(None) => JobState {
                        status: "running".into(),
                        message: None,
                    },
                    Err(_) => {
                        job.status = Some(false);
                        job.child = None;
                        let stderr = job.stderr.lock().unwrap().clone();
                        JobState {
                            status: "error".into(),
                            message: extract_error_message(&stderr).or_else(|| {
                                if stderr.is_empty() {
                                    None
                                } else {
                                    Some(stderr)
                                }
                            }),
                        }
                    }
                }
            } else {
                JobState {
                    status: "running".into(),
                    message: None,
                }
            }
        }
        None => JobState {
            status: "not-found".into(),
            message: None,
        },
    }
}

#[tauri::command]
fn discord_profile_get(guild_id: u64, channel_id: u64) -> Result<Value, String> {
    let output = Command::new("python")
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
    let mut cmd = Command::new("python");
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
    let status = Command::new("python")
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
        .plugin(Builder::new().build())
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
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

            let version_ok = Command::new("python")
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
                let mut cmd = Command::new("python");
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
                let version_ok_after = Command::new("python")
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
            musicgen_test,
            list_llm,
            set_llm,
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
            job_status,
            discord_profile_get,
            discord_profile_set,
            select_vault,
            open_path,
            config::get_config,
            config::set_config,
            config::export_settings,
            config::import_settings,
            musiclang::list_musiclang_models,
            musiclang::download_model
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let registry = window.app_handle().state::<JobRegistry>();
                let mut jobs = registry.jobs.lock().unwrap();
                for job in jobs.values_mut() {
                    if let Some(child) = job.child.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                jobs.clear();
            }
        })
        .run(tauri::generate_context!())
    {
        eprintln!("error while running tauri application: {}", e);
    }
}
