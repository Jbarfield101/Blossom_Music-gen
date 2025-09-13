use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager};

const STORE_FILE: &str = "settings.dat";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join(STORE_FILE))
}

#[tauri::command]
pub fn export_settings(app: AppHandle, path: String) -> Result<(), String> {
    let store_path = settings_path(&app)?;
    let contents = fs::read_to_string(store_path).unwrap_or_else(|_| "{}".into());
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_settings(app: AppHandle, path: String) -> Result<(), String> {
    let settings_path = settings_path(&app)?;
    let mut current: Map<String, Value> = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let import_str = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let imported: Value = serde_json::from_str(&import_str).map_err(|e| e.to_string())?;
    let import_map = imported
        .as_object()
        .ok_or_else(|| "invalid settings file".to_string())?;
    for (k, v) in import_map.iter() {
        current.insert(k.clone(), v.clone());
    }
    let merged = Value::Object(current.clone());
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&settings_path, serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    app.emit("settings::updated", merged).map_err(|e| e.to_string())?;
    Ok(())
}
