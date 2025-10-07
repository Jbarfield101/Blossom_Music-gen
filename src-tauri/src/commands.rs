use std::fs;
use std::io::Write;
use std::process::Command;
use tempfile::NamedTempFile;

use serde::{Deserialize, Serialize};
use tauri::{async_runtime, AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct GenResult {
    pub path: String,
    pub device: String,
    pub paths: Option<Vec<String>>,
    pub fallback: Option<bool>,
    pub fallback_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RiffusionResult {
    pub path: String,
}

#[tauri::command]
pub async fn riffusion_generate(
    app: AppHandle,
    prompt: Option<String>,
    negative: Option<String>,
    seed: Option<i64>,
    steps: Option<u32>,
    guidance: Option<f32>,
) -> Result<RiffusionResult, String> {
    // Output directory under AppData
    let out_base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&out_base).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out_path = out_base.join(format!("riffusion_{}.wav", ts));

    // Build command to run the CLI
    let mut args: Vec<String> = vec![
        "-m".into(),
        "blossom.audio.riffusion.cli_riffusion".into(),
        "--outfile".into(),
        out_path.to_string_lossy().to_string(),
        "--tiles".into(),
        "1".into(),
        "--width".into(),
        "512".into(),
        "--height".into(),
        "512".into(),
        "--overlap".into(),
        "32".into(),
        "--sr".into(),
        "22050".into(),
        "--hs_freq".into(),
        "5000".into(),
        "--hs_gain".into(),
        "2.0".into(),
        "--lowcut".into(),
        "35".into(),
        "--wet".into(),
        "0.12".into(),
    ];
    if let Some(s) = steps {
        args.push("--steps".into());
        args.push(s.to_string());
    }
    if let Some(g) = guidance {
        args.push("--guidance".into());
        args.push(format!("{}", g));
    }
    if let Some(n) = negative.clone() {
        args.push("--negative".into());
        args.push(n);
    }
    if let Some(sd) = seed {
        args.push("--seed".into());
        args.push(sd.to_string());
    }
    // Prefer explicit prompt if provided; otherwise rely on preset default (piano)
    if let Some(p) = prompt.clone() {
        args.push(p);
    }

    let output = async_runtime::spawn_blocking(move || {
        Command::new("python")
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(args)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(RiffusionResult {
        path: out_path.to_string_lossy().to_string(),
    })
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
    // Optional: force trying GPU (even if torch reports otherwise)
    force_gpu: Option<bool>,
    // Optional: request FP16 on GPU to reduce VRAM
    use_fp16: Option<bool>,
    // Optional: output directory; defaults to AppData
    output_dir: Option<String>,
    // Optional: desired output base name (without extension)
    output_name: Option<String>,
    // Optional: number of samples to generate
    count: Option<u32>,
    // Optional: path to a melody conditioning clip
    melody_path: Option<String>,
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
    let melody_literal = match melody_path {
        Some(path) => {
            if path.trim().is_empty() {
                "None".to_string()
            } else {
                serde_json::to_string(&path)
                    .map_err(|e| format!("Failed to encode melody path: {}", e))?
            }
        }
        None => "None".to_string(),
    };

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
        p = m.generate_music({prompt:?}, {duration}, {model_name:?}, {temperature}, {out_dir:?}, melody_path={melody})
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
        forced_cpu = if force_cpu.unwrap_or(false) {
            "True"
        } else {
            "False"
        },
        times = times,
        melody = melody_literal,
    );

    let output = async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("python");
        if force_cpu.unwrap_or(false) {
            // Force CPU by hiding CUDA devices for this process
            cmd.env("CUDA_VISIBLE_DEVICES", "");
        }
        if force_gpu.unwrap_or(false) {
            cmd.env("MUSICGEN_FORCE_GPU", "1");
        }
        if use_fp16.unwrap_or(false) {
            cmd.env("MUSICGEN_FP16", "1");
        }
        cmd.current_dir("..")
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
    // Expect JSON {"path": ..., "paths": [...], "device": ...}
    let mut parsed: GenResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse musicgen output: {}\nstdout: {}", e, stdout))?;

    // If a custom name was provided, rename the generated files accordingly.
    if let Some(name_raw) = output_name {
        let sanitize = |s: &str| {
            let mut out = String::new();
            for ch in s.chars() {
                let ok =
                    ch.is_ascii_alphanumeric() || ch == ' ' || ch == '_' || ch == '-' || ch == '.';
                out.push(if ok { ch } else { '_' });
            }
            let trimmed = out.trim().trim_matches('.').to_string();
            let cleaned = if trimmed.is_empty() {
                "track".to_string()
            } else {
                trimmed
            };
            cleaned.chars().take(120).collect::<String>()
        };
        let base_name = sanitize(&name_raw);
        let ensure_ext = |mut s: String| {
            if !s.to_lowercase().ends_with(".wav") {
                s.push_str(".wav");
            }
            s
        };

        let mut rename_one = |src: &str, target_name: String| -> Result<String, String> {
            let mut target = out_base.join(&target_name);
            // If exists, add (n)
            if target.exists() {
                let mut n = 1u32;
                let stem = std::path::Path::new(&target_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("track");
                let ext = std::path::Path::new(&target_name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("wav");
                loop {
                    let candidate = out_base.join(format!("{} ({}){}.{}", stem, n, "", ext));
                    if !candidate.exists() {
                        target = candidate;
                        break;
                    }
                    n += 1;
                    if n > 9999 {
                        break;
                    }
                }
            }
            fs::rename(src, &target).map_err(|e| e.to_string())?;
            Ok(target.to_string_lossy().to_string())
        };

        if let Some(paths) = parsed.paths.as_ref() {
            if !paths.is_empty() {
                let multiple = paths.len() > 1;
                let width = ((paths.len() as f32).log10().floor() as usize) + 1;
                let mut new_paths = Vec::with_capacity(paths.len());
                for (idx, p) in paths.iter().enumerate() {
                    let mut fname = if multiple {
                        format!("{}_{:0width$}", base_name, idx + 1, width = width)
                    } else {
                        base_name.clone()
                    };
                    fname = ensure_ext(fname);
                    match rename_one(p, fname) {
                        Ok(np) => new_paths.push(np),
                        Err(_) => new_paths.push(p.clone()),
                    }
                }
                parsed.path = new_paths
                    .get(0)
                    .cloned()
                    .unwrap_or_else(|| parsed.path.clone());
                parsed.paths = Some(new_paths);
            }
        } else if !parsed.path.is_empty() {
            let fname = ensure_ext(base_name.clone());
            if let Ok(np) = rename_one(&parsed.path, fname) {
                parsed.path = np.clone();
                parsed.paths = Some(vec![np]);
            }
        }
    }
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
    let code = r#"import json, os, sys, subprocess, shutil
info = {
  "device": "cpu",
  "cuda_available": False,
  "name": "",
  "torch": "",
  "torch_cuda": None,
  "cuda_version": None,
  "total_mem": None,
  "free_mem": None,
  "error": None,
  "python_exe": sys.executable,
  "python_version": sys.version.split(" (", 1)[0],
  "device_count": 0,
  "devices": [],
  "visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
  "nvidia_smi": None,
}
try:
    import torch
    info["torch"] = getattr(torch, "__version__", "")
    info["torch_cuda"] = getattr(getattr(torch, "version", object()), "cuda", None)
    info["cuda_version"] = info["torch_cuda"]
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

# Fallback: query nvidia-smi if available
try:
    smi = shutil.which("nvidia-smi")
    if smi:
        res = subprocess.run(
            [smi, "--query-gpu=name,memory.total,memory.free,driver_version,cuda_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3
        )
        if res.returncode == 0:
            lines = [l.strip() for l in res.stdout.splitlines() if l.strip()]
            if lines:
                first = lines[0].split(',')
                info["nvidia_smi"] = {
                    "name": first[0].strip(),
                    "total_mem": int(first[1].strip()) * 1024 * 1024,
                    "free_mem": int(first[2].strip()) * 1024 * 1024,
                    "driver": first[3].strip(),
                    "cuda": first[4].strip(),
                }
                if not info.get("cuda_available"):
                    info["device"] = "gpu"
except Exception:
    pass

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
        list_file
            .write_all(line.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let list_path = list_file.path().to_path_buf();

    // Run ffmpeg. Prefer re-encoding to MP3 for robustness across mixed inputs.
    let out_path_for_ffmpeg = out_path.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("ffmpeg")
            .args(["-y", "-f", "concat", "-safe", "0", "-i"])
            .arg(list_path.as_os_str())
            .args(["-vn", "-acodec", "libmp3lame", "-b:a", "320k"])
            .arg(out_path_for_ffmpeg.as_os_str())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not recognized") || stderr.contains("No such file or directory") {
            return Err(
                "ffmpeg not found. Please install FFmpeg and ensure it is on your PATH.".into(),
            );
        }
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(out_path.to_string_lossy().to_string())
}
