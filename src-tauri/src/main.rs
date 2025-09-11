#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    path::Path,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use regex::Regex;
use tauri::{AppHandle, State};

#[derive(serde::Serialize)]
struct ProgressEvent {
    stage: Option<String>,
    percent: Option<u32>,
    message: String,
    eta: Option<String>,
}

#[derive(serde::Serialize)]
enum JobStatus {
    Running,
    Completed { success: bool },
    NotFound,
}

struct JobInfo {
    child: Option<Child>,
    args: Vec<String>,
    status: Option<bool>,
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

fn list_from_dir(dir: &Path) -> Result<Vec<String>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
            items.push(stem.to_string());
        }
    }
    Ok(items)
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
fn start_job(app: AppHandle, registry: State<JobRegistry>, args: Vec<String>) -> Result<u64, String> {
    let mut child = Command::new("python")
        .args(&args)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take();
    let job = JobInfo {
        child: Some(child),
        args,
        status: None,
    };
    let id = registry.add(job);

    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let percent_re = Regex::new(r"(\d+)%").unwrap();
            let eta_re = Regex::new(r"ETA[:\s]+([0-9:]+)").unwrap();
            let stage_re = Regex::new(r"^\s*([\w-]+):").unwrap();
            for line in reader.lines() {
                if let Ok(msg) = line {
                    let percent = percent_re
                        .captures(&msg)
                        .and_then(|c| c.get(1))
                        .and_then(|m| m.as_str().parse::<u32>().ok());
                    let eta = eta_re
                        .captures(&msg)
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().to_string());
                    let stage = stage_re
                        .captures(&msg)
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().to_string());
                    let payload = ProgressEvent {
                        stage,
                        percent,
                        message: msg.clone(),
                        eta,
                    };
                    let event_name = format!("progress::{}", id);
                    let _ = app_handle.emit_all(&event_name, payload);
                }
            }
        });
    }

    Ok(id)
}

#[tauri::command]
fn cancel_render(registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
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

#[tauri::command]
fn job_status(registry: State<JobRegistry>, job_id: u64) -> JobStatus {
    let mut jobs = registry.jobs.lock().unwrap();
    match jobs.get_mut(&job_id) {
        Some(job) => {
            if let Some(success) = job.status {
                JobStatus::Completed { success }
            } else if let Some(child) = job.child.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let success = status.success();
                        job.status = Some(success);
                        job.child = None;
                        JobStatus::Completed { success }
                    }
                    Ok(None) => JobStatus::Running,
                    Err(_) => {
                        job.status = Some(false);
                        job.child = None;
                        JobStatus::Completed { success: false }
                    }
                }
            } else {
                JobStatus::Running
            }
        }
        None => JobStatus::NotFound,
    }
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Path does not exist".into());
    }
    tauri::api::shell::open(&app.shell_scope(), path, None).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            start_job,
            cancel_render,
            job_status,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
