use serde_json::{json, Map, Value};
use std::{fs, sync::Arc};
use tauri::Emitter;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::{Store, StoreBuilder};

fn config_store(app: &AppHandle) -> Result<Arc<Store<tauri::Wry>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_config(app: AppHandle, key: String) -> Result<Value, String> {
    let store = config_store(&app)?;
    Ok(store.get(&key).ok().flatten().unwrap_or(Value::Null))
}

#[tauri::command]
pub fn set_config(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let store = config_store(&app)?;
    store
        .set(key.clone(), value.clone())
        .map_err(|e| e.to_string())?;
    store.save().map_err(|e| e.to_string())?;
    app.emit("settings::updated", json!({"key": key, "value": value}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_settings(app: AppHandle, path: String) -> Result<(), String> {
    let store = config_store(&app)?;
    let entries = store.entries().map_err(|e| e.to_string())?;
    let data: Map<String, Value> = entries.into_iter().collect();
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_settings(app: AppHandle, path: String) -> Result<(), String> {
    let store = config_store(&app)?;
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let data: Map<String, Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    for (key, value) in data.into_iter() {
        store
            .set(key.clone(), value.clone())
            .map_err(|e| e.to_string())?;
        app.emit("settings::updated", json!({ "key": key, "value": value }))
            .map_err(|e| e.to_string())?;
    }
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
