use reqwest::blocking;
use serde_json::Value;

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
