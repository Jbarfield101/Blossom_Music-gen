use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreBuilder;

const CONFIG_FILE: &str = "settings.dat";

fn settings_store(app: &AppHandle) -> Result<tauri_plugin_store::Store, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE);
    Ok(StoreBuilder::new(app.clone(), path).build())
}

#[tauri::command]
pub fn get_config(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let store = settings_store(&app)?;
    Ok(store.get(&key))
}

#[tauri::command]
pub fn set_config(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let store = settings_store(&app)?;
    let current = store.get(&key);
    if current.as_ref() != Some(&value) {
        store.insert(key.clone(), value.clone());
        store.save().map_err(|e| e.to_string())?;
        app.emit_all(
            "settings::updated",
            serde_json::json!({ "key": key, "value": value }),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn export_config(app: AppHandle) -> Result<Value, String> {
    let store = settings_store(&app)?;
    let entries = store.entries().map_err(|e| e.to_string())?;
    let map: Map<String, Value> = entries.into_iter().collect();
    Ok(Value::Object(map))
}
