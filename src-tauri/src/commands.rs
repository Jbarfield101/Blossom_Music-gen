use std::process::Command;
use std::io::Write;
use tempfile::NamedTempFile;
use std::fs;

use tauri::{async_runtime, AppHandle, Manager};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct GenResult {
    pub path: String,
    pub device: String,
    pub paths: Option<Vec<String>>,
    pub fallback: Option<bool>,
    pub fallback_reason: Option<String>,
}

#[tauri::command]
pub async fn generate_musicgen(
    app: AppHandle,
    prompt: String,
    duration: f32,
    model_name: String,
    temperature: f32,
    // Optional: force running on CPU regardless of CUDA availability
    force_cpu: Option<bool>,
    // Optional: output directory; defaults to AppData
    output_dir: Option<String>,
    // Optional: number of samples to generate
    count: Option<u32>,
) -> Result<GenResult, String> {
    // Base output directory
    let out_base = if let Some(dir) = output_dir.clone() {
        std::path::PathBuf::from(dir)
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?
    };
    fs::create_dir_all(&out_base).map_err(|e| e.to_string())?;
    // Use OS-native separators so it matches appDataDir() prefix on Windows
    let out_dir_str = out_base.to_string_lossy().to_string();
    let times: u32 = count.unwrap_or(1).max(1).min(10);
    let code = format!(
        r#"import sys
import core.musicgen_backend as m
import json
try:
    import torch
except Exception:
    torch = None
forced_cpu = {forced_cpu}
try:
    dev = 'cpu'
    if not forced_cpu and torch is not None and getattr(getattr(torch, 'cuda', object()), 'is_available', lambda: False)():
        dev = 'gpu'
    paths = []
    for _ in range({times}):
        p = m.generate_music({prompt:?}, {duration}, {model_name:?}, {temperature}, {out_dir:?})
        paths.append(p)
    path = paths[0] if paths else ""
    status = getattr(m, 'get_last_status', lambda: {{}})()
    used_device = status.get('device', dev)
    fb = status.get('fallback')
    fr = status.get('reason')
    print(json.dumps({{"path": path, "paths": paths, "device": used_device, "fallback": fb, "fallback_reason": fr}}))
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)
"#,
        prompt = prompt,
        duration = duration,
        model_name = model_name,
        temperature = temperature,
        out_dir = out_dir_str,
        forced_cpu = if force_cpu.unwrap_or(false) { "True" } else { "False" },
        times = times,
    );

    let output = async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("python");
        if force_cpu.unwrap_or(false) {
            // Force CPU by hiding CUDA devices for this process
            cmd.env("CUDA_VISIBLE_DEVICES", "");
        }
        cmd
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(["-c", &code])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Expect JSON {"path": ..., "device": ...}
    let parsed: GenResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse musicgen output: {}\nstdout: {}", e, stdout))?;
    Ok(parsed)
}

#[derive(Serialize, Deserialize)]
pub struct EnvInfo {
    pub device: String,
    pub cuda_available: bool,
    pub name: String,
    pub torch: String,
    pub cuda_version: Option<String>,
    pub total_mem: Option<u64>,
    pub free_mem: Option<u64>,
    pub error: Option<String>,
    // Extra diagnostics
    pub python_exe: Option<String>,
    pub python_version: Option<String>,
    pub device_count: Option<u32>,
    pub devices: Option<Vec<String>>,    
    pub visible_devices: Option<String>,
}

#[tauri::command]
pub async fn musicgen_env() -> Result<EnvInfo, String> {
    let code = r#"import json, os, sys
info = {
  "device": "cpu",
  "cuda_available": False,
  "name": "",
  "torch": "",
  "cuda_version": None,
  "total_mem": None,
  "free_mem": None,
  "error": None,
  "python_exe": sys.executable,
  "python_version": sys.version.split(" (", 1)[0],
  "device_count": 0,
  "devices": [],
  "visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
}
try:
    import torch
    info["torch"] = getattr(torch, "__version__", "")
    info["cuda_version"] = getattr(getattr(torch, "version", object()), "cuda", None)
    is_avail = getattr(getattr(torch, "cuda", object()), "is_available", lambda: False)()
    if is_avail:
        info["cuda_available"] = True
        info["device"] = "gpu"
        try:
            info["device_count"] = int(torch.cuda.device_count())
        except Exception:
            pass
        try:
            info["devices"] = [torch.cuda.get_device_name(i) for i in range(int(info["device_count"]))]
        except Exception:
            pass
        try:
            info["name"] = torch.cuda.get_device_name(0)
        except Exception:
            pass
        try:
            free_mem, total_mem = torch.cuda.mem_get_info(0)
            info["free_mem"] = int(free_mem)
            info["total_mem"] = int(total_mem)
        except Exception:
            pass
except Exception as exc:
    info["error"] = str(exc)
print(json.dumps(info))
"#;

    let output = async_runtime::spawn_blocking(move || {
        Command::new("python")
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(["-c", code])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: EnvInfo = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse env output: {}\nstdout: {}", e, stdout))?;
    Ok(parsed)
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn album_concat(
    files: Vec<String>,
    output_dir: String,
    output_name: Option<String>,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("No input files provided".into());
    }
    // Ensure output directory exists
    let out_dir = std::path::PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    // Build output file path
    let mut final_name = output_name.unwrap_or_else(|| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("album_{}.mp3", ts)
    });
    if !final_name.to_lowercase().ends_with(".mp3") {
        final_name.push_str(".mp3");
    }
    let out_path = out_dir.join(final_name);

    // Create concat list file
    let mut list_file = NamedTempFile::new().map_err(|e| e.to_string())?;
    for f in &files {
        let p = std::path::Path::new(f);
        if !p.exists() {
            return Err(format!("Input does not exist: {}", f));
        }
        // FFmpeg concat demuxer expects lines like: file 'path'
        // Use single quotes; this file is parsed by FFmpeg, not the OS shell.
        let line = format!("file '{}'\n", f.replace("'", "'\\''"));
        list_file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    }
    let list_path = list_file.path().to_path_buf();

    // Run ffmpeg. Prefer re-encoding to MP3 for robustness across mixed inputs.
    let out_path_for_ffmpeg = out_path.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
            ])
            .arg(list_path.as_os_str())
            .args([
                "-vn",
                "-acodec",
                "libmp3lame",
                "-b:a",
                "320k",
            ])
            .arg(out_path_for_ffmpeg.as_os_str())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not recognized") || stderr.contains("No such file or directory") {
            return Err("ffmpeg not found. Please install FFmpeg and ensure it is on your PATH.".into());
        }
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(out_path.to_string_lossy().to_string())
}
