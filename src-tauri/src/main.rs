#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::Regex;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Instant,
};
use tauri::{Manager, State};

#[derive(Default)]
struct RenderState {
    child: Mutex<Option<Child>>,
    output: Mutex<Option<PathBuf>>,
}

#[derive(serde::Serialize)]
struct ProgressPayload {
    line: String,
    stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    eta_seconds: Option<f64>,
}

#[tauri::command]
async fn run_python_script(
    args: Vec<String>,
    window: tauri::Window,
    state: State<'_, RenderState>,
) -> Result<(), String> {
    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let out_path = temp_dir.into_path();

    let mut cmd = Command::new("python");
    cmd.arg("main_render.py")
        .args(&args)
        .arg("--bundle")
        .arg(&out_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;

    *state
        .child
        .lock()
        .map_err(|e| e.to_string())? = Some(child);
    *state
        .output
        .lock()
        .map_err(|e| e.to_string())? = Some(out_path.clone());

    let start = Instant::now();

    let win_out = window.clone();
    tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let payload = ProgressPayload {
                line,
                stream: "stdout".into(),
                eta_seconds: None,
            };
            let _ = win_out.emit("progress", payload);
        }
    });

    let win_err = window.clone();
    let state_clone = state.clone();
    tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stderr);
        let re = Regex::new(r"(\d+)/(\d+)").ok();
        for line in reader.lines().flatten() {
            let mut eta = None;
            if let Some(ref re) = re {
                if let Some(c) = re.captures(&line) {
                    let done: f64 =
                        c.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
                    let total: f64 =
                        c.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
                    if done > 0.0 && total >= done {
                        let elapsed = start.elapsed().as_secs_f64();
                        eta = Some(elapsed * (total - done) / done);
                    }
                }
            }
            let payload = ProgressPayload {
                line,
                stream: "stderr".into(),
                eta_seconds: eta,
            };
            let _ = win_err.emit("progress", payload);
        }

        if let Ok(mut child_lock) = state_clone.child.lock() {
            child_lock.take();
        }
        if let Ok(mut out_lock) = state_clone.output.lock() {
            if let Some(p) = out_lock.take() {
                let _ = std::fs::remove_dir_all(p);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_render(state: State<'_, RenderState>) -> Result<(), String> {
    if let Ok(mut child_lock) = state.child.lock() {
        if let Some(mut child) = child_lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut out_lock) = state.output.lock() {
        if let Some(p) = out_lock.take() {
            let _ = std::fs::remove_dir_all(p);
        }
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(RenderState::default())
        .invoke_handler(tauri::generate_handler![run_python_script, cancel_render])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

