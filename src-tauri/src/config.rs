use std::fs;
use serde_json::{json, Value, Map};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreBuilder;

fn config_store(app: &AppHandle) -> Result<tauri_plugin_store::Store, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    Ok(StoreBuilder::new(app.clone(), path).build())
}

#[tauri::command]
pub fn get_config(app: AppHandle, key: String) -> Result<Value, String> {
    let store = config_store(&app)?;
    Ok(store.get(key).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn set_config(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let store = config_store(&app)?;
    store.insert(key.clone(), value.clone());
    store.save().map_err(|e| e.to_string())?;
    app.emit("settings::updated", json!({"key": key, "value": value}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_config(app: AppHandle, path: String) -> Result<(), String> {
    let store = config_store(&app)?;
    let entries = store.entries().map_err(|e| e.to_string())?;
    let data: Map<String, Value> = entries.into_iter().collect();
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(())
}
