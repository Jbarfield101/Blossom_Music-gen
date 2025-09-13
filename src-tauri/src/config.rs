use serde_json::{json, Map, Value};
use tauri::{AppHandle};
use tauri_plugin_store::{Store, StoreBuilder};

fn config_store(app: &AppHandle) -> Result<Store, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.dat");
    Ok(StoreBuilder::new(app.clone(), path).build())
}

#[tauri::command]
pub fn get_config(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let store = config_store(&app)?;
    Ok(store.get(&key).cloned())
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
pub fn export_config(app: AppHandle) -> Result<Map<String, Value>, String> {
    let store = config_store(&app)?;
    let entries = store.entries().map_err(|e| e.to_string())?;
    Ok(entries)
}
