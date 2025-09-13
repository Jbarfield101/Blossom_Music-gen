use reqwest::blocking;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::{util::list_from_dir, ProgressEvent};

const INDEX_URL: &str = "https://huggingface.co/api/models?search=musiclang";

#[tauri::command]
pub fn list_musiclang_models() -> Result<Vec<String>, String> {
    let response = blocking::get(INDEX_URL).map_err(|e| e.to_string())?;
    let json: Value = response.json().map_err(|e| e.to_string())?;
    let models = json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("modelId").and_then(|v| v.as_str()))
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    Ok(models)
}

#[tauri::command]
pub fn download_model(
    app: AppHandle,
    name: &str,
    force: Option<bool>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all("models").map_err(|e| e.to_string())?;
    let file_name = name.split('/').last().unwrap_or(name);
    let path = PathBuf::from(format!("models/{}.onnx", file_name));

    if path.exists() && !force.unwrap_or(false) {
        let event = ProgressEvent {
            stage: Some("download".into()),
            percent: Some(100),
            message: format!("Model {} already exists, skipping download", name),
            eta: None,
        };
        let _ = app.emit_all(&format!("download::progress::{}", name), event);
        return list_from_dir(Path::new("models"));
    }

    let url = format!("https://huggingface.co/{}/resolve/main/model.onnx", name);
    let mut response = blocking::get(&url)
        .and_then(|res| res.error_for_status())
        .map_err(|e| {
            let msg = format!("Failed to download model from {}: {}", url, e);
            eprintln!("{}", msg);
            msg
        })?;
    let total = response.content_length();

    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 8192];
    loop {
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let percent = total.map(|t| ((downloaded * 100) / t) as u8);
        let event = ProgressEvent {
            stage: Some("download".into()),
            percent,
            message: format!("Downloading {}", name),
            eta: None,
        };
        let _ = app.emit_all(&format!("download::progress::{}", name), event);
    }

    list_from_dir(Path::new("models"))
}
