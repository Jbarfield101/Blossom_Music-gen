use reqwest::blocking;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::{util::list_from_dir, ProgressEvent};

const INDEX_URL: &str = "https://huggingface.co/api/models?search=musiclang";

#[derive(Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub description: Option<String>,
    pub size: Option<u64>,
}

#[tauri::command]
pub fn list_musiclang_models() -> Result<Vec<ModelInfo>, String> {
    let response = blocking::get(INDEX_URL).map_err(|e| e.to_string())?;
    let json: Value = response.json().map_err(|e| e.to_string())?;
    let models = json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let model_id = item.get("modelId").and_then(|v| v.as_str())?;
                    // Only keep models from the official MusicLang namespace
                    if !(model_id.starts_with("musiclang/") || model_id.starts_with("MusicLang/")) {
                        return None;
                    }
                    // Find an ONNX asset among siblings
                    let onnx_info =
                        item.get("siblings")
                            .and_then(|s| s.as_array())
                            .and_then(|sibs| {
                                sibs.iter().find_map(|sib| {
                                    let name = sib.get("rfilename").and_then(|v| v.as_str())?;
                                    if name.ends_with(".onnx") {
                                        Some((name, sib.get("size").and_then(|v| v.as_u64())))
                                    } else {
                                        None
                                    }
                                })
                            });
                    let (onnx_name, size) = onnx_info?;
                    // Ensure the ONNX file is present
                    if onnx_name.is_empty() {
                        return None;
                    }
                    let description = item
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(ModelInfo {
                        id: model_id.to_string(),
                        description,
                        size,
                    })
                })
                .collect::<Vec<ModelInfo>>()
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
            message: Some(format!("Model {} already exists, skipping download", name)),
            eta: None,
            step: None,
            total: None,
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
            message: Some(format!("Downloading {}", name)),
            eta: None,
            step: None,
            total: None,
        };
        let _ = app.emit_all(&format!("download::progress::{}", name), event);
    }

    list_from_dir(Path::new("models"))
}
