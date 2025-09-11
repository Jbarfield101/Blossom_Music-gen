#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::{Child, Command},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use tauri::State;

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
fn start_job(registry: State<JobRegistry>, args: Vec<String>) -> Result<u64, String> {
    let child = Command::new("python")
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;
    let job = JobInfo {
        child: Some(child),
        args,
        status: None,
    };
    let id = registry.add(job);
    Ok(id)
}

#[tauri::command]
fn cancel_job(registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
    let mut jobs = registry.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(&job_id) {
        if let Some(child) = job.child.as_mut() {
            let _ = child.kill();
            let status = child.wait();
            job.status = Some(status.map(|s| s.success()).unwrap_or(false));
            job.child = None;
        }
    }
    Ok(())
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

fn main() {
    tauri::Builder::default()
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            start_job,
            cancel_job,
            job_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
