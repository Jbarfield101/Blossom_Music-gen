use reqwest::blocking;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager};

use crate::ProgressEvent;

const INDEX_URL: &str = "https://huggingface.co/api/models?search=musiclang";

#[tauri::command]
pub fn list_musiclang_models() -> Result<Vec<String>, String> {
    let response = blocking::get(INDEX_URL).map_err(|e| e.to_string())?;
    let json: Value = response.json().map_err(|e| e.to_string())?;
    let mut models = Vec::new();
    if let Some(arr) = json.as_array() {
        for item in arr {
            if let Some(name) = item
                .get("name")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("modelId").and_then(|v| v.as_str()))
                .or_else(|| item.as_str())
            {
                models.push(name.to_string());
            }
        }
    }
    Ok(models)
}

#[tauri::command]
pub fn download_model(app: AppHandle, name: &str) -> Result<String, String> {
    let url = format!("https://huggingface.co/{}/resolve/main/model.onnx", name);
    let mut response = blocking::get(&url).map_err(|e| e.to_string())?;
    let total = response.content_length();

    fs::create_dir_all("models").map_err(|e| e.to_string())?;
    let mut path = PathBuf::from("models");
    path.push(format!("{}.onnx", name));
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

    Ok(path.to_string_lossy().to_string())
}
