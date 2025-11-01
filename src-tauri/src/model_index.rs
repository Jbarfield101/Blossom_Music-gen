use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::async_runtime;

use crate::config;

const MODEL_INDEX_FILENAME: &str = "model_index.json";

fn model_index_path() -> PathBuf {
    Path::new(config::DEFAULT_DREADHAVEN_ROOT).join(MODEL_INDEX_FILENAME)
}

fn ensure_parent_exists(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn read_index_file() -> Result<ModelIndexReadResult, String> {
    let path = model_index_path();
    ensure_parent_exists(&path)?;
    let contents = match fs::read_to_string(&path) {
        Ok(raw) => Some(raw),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.to_string()),
    };
    Ok(ModelIndexReadResult {
        path: path.to_string_lossy().into_owned(),
        contents,
    })
}

fn write_index_file(contents: String) -> Result<ModelIndexWriteResult, String> {
    let path = model_index_path();
    ensure_parent_exists(&path)?;
    // Validate JSON to avoid persisting malformed data.
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|err| err.to_string())?;
    fs::write(&path, contents).map_err(|err| err.to_string())?;
    Ok(ModelIndexWriteResult {
        path: path.to_string_lossy().into_owned(),
    })
}

#[derive(Serialize)]
pub struct ModelIndexReadResult {
    pub path: String,
    pub contents: Option<String>,
}

#[derive(Serialize)]
pub struct ModelIndexWriteResult {
    pub path: String,
}

#[tauri::command]
pub async fn model_index_read() -> Result<ModelIndexReadResult, String> {
    async_runtime::spawn_blocking(read_index_file)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn model_index_write(contents: String) -> Result<ModelIndexWriteResult, String> {
    async_runtime::spawn_blocking(move || write_index_file(contents))
        .await
        .map_err(|err| err.to_string())?
}

