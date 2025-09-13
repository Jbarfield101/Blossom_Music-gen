#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::Builder;
mod musiclang;
mod util;
use crate::util::list_from_dir;

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
    args: Vec<String>,
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

#[tauri::command]
fn list_models() -> Result<Vec<String>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir("models").map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("onnx") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                items.push(stem.to_string());
            }
        }
    }
    items.sort();
    Ok(items)
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
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let mut buf = stderr_buf_clone.lock().unwrap();
                buf.push_str(&line);
                buf.push('\n');
            }
        });
    }
    let job = JobInfo {
        child: Some(child),
        args,
        status: None,
        stderr: stderr_buf,
    };
    let id = registry.add(job);

    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        std::thread::spawn(move || {
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
                let _ = app_handle.emit(&format!("progress::{}", id), event);
            }
        });
    }

    Ok(id)
}

#[tauri::command]
fn onnx_generate(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
) -> Result<u64, String> {
    let mut full_args = vec!["core/onnx_crafter_service.py".into()];
    full_args.extend(args.iter().cloned());
    let mut child = Command::new("python")
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let job = JobInfo {
        child: Some(child),
        args: full_args.clone(),
        status: None,
        stderr: stderr_buf.clone(),
    };
    let id = registry.add(job);

    if let Some(stderr) = stderr_pipe {
        let stderr_buf_clone = stderr_buf.clone();
        let app_handle = app.clone();
        let id_clone = id;
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                {
                    let mut buf = stderr_buf_clone.lock().unwrap();
                    buf.push_str(&line);
                    buf.push('\n');
                }
                let trimmed = line.trim();
                if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                    if let Some(err_msg) = val.get("error").and_then(|v| v.as_str()) {
                        let event = ProgressEvent {
                            stage: Some("error".into()),
                            percent: None,
                            message: Some(err_msg.to_string()),
                            eta: None,
                            step: None,
                            total: None,
                        };
                        let _ = app_handle.emit(&format!("onnx::progress::{}", id_clone), event);
                    }
                }
            }
        });
    }

    let (tx, rx) = std::sync::mpsc::channel();
    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        let tx2 = tx.clone();
        let id_clone = id;
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut first = true;
            for line in reader.lines().flatten() {
                if first {
                    let _ = tx2.send(());
                    first = false;
                }
                if let Ok(mut event) = serde_json::from_str::<ProgressEvent>(&line) {
                    if let (Some(step), Some(total)) = (event.step, event.total) {
                        let pct = ((step as f64 / total as f64) * 100.0).round() as u8;
                        event.percent = Some(pct);
                    }
                    let _ = app_handle.emit(&format!("onnx::progress::{}", id_clone), event);
                } else if serde_json::from_str::<Value>(&line).is_ok() {
                    let event = ProgressEvent {
                        stage: None,
                        percent: None,
                        message: Some(line.clone()),
                        eta: None,
                        step: None,
                        total: None,
                    };
                    let _ = app_handle.emit(&format!("onnx::progress::{}", id_clone), event);
                }
            }
        });
    }

    // Wait for first progress line or early failure
    loop {
        match rx.try_recv() {
            Ok(_) => break,
            Err(std::sync::mpsc::TryRecvError::Empty) => {
                let mut jobs = registry.jobs.lock().unwrap();
                if let Some(job) = jobs.get_mut(&id) {
                    if let Some(child) = job.child.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let success = status.success();
                                if !success {
                                    let err = job.stderr.lock().unwrap().clone();
                                    jobs.remove(&id);
                                    let msg = extract_error_message(&err).unwrap_or_else(|| {
                                        if err.is_empty() {
                                            "onnx generation failed".into()
                                        } else {
                                            err
                                        }
                                    });
                                    return Err(msg);
                                } else {
                                    job.status = Some(true);
                                    job.child = None;
                                    break;
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                jobs.remove(&id);
                                return Err(e.to_string());
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
        }
    }

    Ok(id)
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
                let _ = app.emit(&format!("onnx::cancelled::{}", job_id), ());
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
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Path does not exist".into());
    }
    app.opener().open(path, None).map_err(|e| e.to_string())
}

fn main() {
    if let Err(e) = fs::create_dir_all(Path::new("models")) {
        eprintln!("failed to create models directory: {}", e);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(Builder::new().build())
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            list_models,
            app_version,
            start_job,
            onnx_generate,
            cancel_render,
            job_status,
            open_path,
            musiclang::list_musiclang_models,
            musiclang::download_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
