#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use regex::Regex;
use serde_json::json;
use tauri::{State, Window};
use tauri::api::dialog::blocking::FileDialogBuilder;

struct RenderState {
    child: Arc<Mutex<Option<Child>>>,
    bundle: Arc<Mutex<Option<PathBuf>>>,
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
fn start_render(
    window: Window,
    state: State<RenderState>,
    preset: String,
    style: Option<String>,
    seed: i32,
    minutes: Option<f32>,
) -> Result<(), String> {
    let bundle_dir = FileDialogBuilder::new()
        .pick_folder()
        .ok_or_else(|| "no folder selected".to_string())?;
    {
        let mut lock = state.bundle.lock().unwrap();
        *lock = Some(bundle_dir.clone());
    }

    let mut args = vec![
        "main_render.py".into(),
        "--preset".into(),
        preset,
        "--seed".into(),
        seed.to_string(),
        "--bundle".into(),
        bundle_dir.to_string_lossy().into_owned(),
        "--verbose".into(),
    ];
    if let Some(style) = style {
        if !style.is_empty() {
            args.push("--style".into());
            args.push(style);
        }
    }
    if let Some(m) = minutes {
        args.push("--minutes".into());
        args.push(m.to_string());
    }

    let mut child = Command::new("python")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        let win = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let re = Regex::new(r"(\d+)/(\d+)").ok();
            for line in reader.lines().flatten() {
                let mut pct = None;
                if let Some(re) = &re {
                    if let Some(caps) = re.captures(&line) {
                        if let (Ok(cur), Ok(total)) =
                            (caps[1].parse::<u64>(), caps[2].parse::<u64>())
                        {
                            pct = Some(cur as f64 / total as f64 * 100.0);
                        }
                    }
                }
                let mut eta = None;
                if let Some(start) = line.find('<') {
                    if let Some(end) = line[start + 1..].find(',') {
                        eta = Some(line[start + 1..start + 1 + end].trim().to_string());
                    }
                }
                let payload = json!({ "line": line, "percent": pct, "eta": eta });
                let _ = win.emit("progress", payload);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let win = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let payload = json!({ "line": line, "percent": null, "eta": null });
                let _ = win.emit("progress", payload);
            }
        });
    }

    {
        let mut lock = state.child.lock().unwrap();
        *lock = Some(child);
    }

    let win = window.clone();
    let child_state = state.child.clone();
    let bundle_state = state.bundle.clone();
    thread::spawn(move || loop {
        let finished = {
            let mut lock = child_state.lock().unwrap();
            if let Some(child) = lock.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        *lock = None;
                        Some(status.success())
                    }
                    Ok(None) => None,
                    Err(_) => {
                        *lock = None;
                        Some(false)
                    }
                }
            } else {
                return;
            }
        };
        if let Some(success) = finished {
            if success {
                if let Some(bundle_dir) = bundle_state.lock().unwrap().take() {
                    let zip_path = bundle_dir.with_extension("zip");
                    let _ = Command::new("python")
                        .args([
                            "-c",
                            "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[1])",
                            bundle_dir.to_str().unwrap(),
                        ])
                        .output();
                    let _ = win.emit("result", zip_path.to_string_lossy().to_string());
                }
            } else {
                let _ = win.emit("error", "render failed");
                let _ = bundle_state.lock().unwrap().take();
            }
            break;
        }
        thread::sleep(Duration::from_millis(500));
    });

    Ok(())
}

#[tauri::command]
fn cancel_render(state: State<RenderState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = state.bundle.lock().unwrap().take();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(RenderState {
            child: Arc::new(Mutex::new(None)),
            bundle: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            start_render,
            cancel_render
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
