#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use regex::Regex;
use tauri::{State, Window};

struct PidState {
    pid: Arc<Mutex<Option<u32>>>,
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
    state: State<PidState>,
    preset: String,
    style: Option<String>,
    seed: i32,
    minutes: Option<f32>,
) -> Result<(), String> {
    let bundle_dir = tempfile::tempdir()
        .map_err(|e| e.to_string())?
        .into_path();

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

    let pid = child.id();
    {
        let mut lock = state.pid.lock().unwrap();
        *lock = Some(pid);
    }

    if let Some(stdout) = child.stdout.take() {
        let win = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let re = Regex::new(r"(\d+)/(\d+)").ok();
            for line in reader.lines().flatten() {
                let _ = win.emit("log", line.clone());
                if let Some(re) = &re {
                    if let Some(caps) = re.captures(&line) {
                        if let (Ok(cur), Ok(total)) =
                            (caps[1].parse::<u64>(), caps[2].parse::<u64>())
                        {
                            let pct = cur as f64 / total as f64 * 100.0;
                            let _ = win.emit("progress", pct);
                        }
                    }
                }
                if let Some(start) = line.find('<') {
                    if let Some(end) = line[start + 1..].find(',') {
                        let eta = line[start + 1..start + 1 + end].trim().to_string();
                        let _ = win.emit("eta", eta);
                    }
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let win = window.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = win.emit("log", line);
            }
        });
    }

    let win = window.clone();
    thread::spawn(move || {
        let status = child.wait();
        if let Ok(status) = status {
            if status.success() {
                let zip_path = bundle_dir.with_extension("zip");
                let _ = Command::new("python")
                    .args([
                        "-c",
                        "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[1])",
                        bundle_dir.to_str().unwrap(),
                    ])
                    .output();
                let _ = win.emit("result", zip_path.to_string_lossy().to_string());
                let _ = fs::remove_dir_all(&bundle_dir);
            } else {
                let _ = win.emit("error", "render failed");
            }
        } else {
            let _ = win.emit("error", "render failed");
        }
    });

    Ok(())
}

#[tauri::command]
fn cancel_render(state: State<PidState>) -> Result<(), String> {
    let pid_opt = { state.pid.lock().unwrap().take() };
    if let Some(pid) = pid_opt {
        #[cfg(unix)]
        let _ = Command::new("kill").arg(pid.to_string()).output();
        #[cfg(windows)]
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).output();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(PidState {
            pid: Arc::new(Mutex::new(None)),
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
