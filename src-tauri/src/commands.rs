use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tempfile::NamedTempFile;

use crate::{project_root, settings_store};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use tauri::{async_runtime, AppHandle, Manager};
use tauri_plugin_store::Store;
use tokio::time::sleep;
use url::Url;
use uuid::Uuid;

const DEFAULT_FILE_PREFIX: &str = "audio/ComfyUI";
const DEFAULT_SECONDS: f64 = 120.0;
const TEMPLATES_KEY: &str = "stableAudioTemplates";
const COMFY_SETTINGS_KEY: &str = "comfyuiSettings";
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8188";
const DEFAULT_AUTO_LAUNCH: bool = true;
const CLIENT_NAMESPACE: &str = "blossom";
const QUEUE_ENDPOINT: &str = "/queue";
const PROMPT_ENDPOINT: &str = "/prompt";
const HISTORY_ENDPOINT: &str = "/history";
const SYSTEM_STATS_ENDPOINT: &str = "/system_stats";

fn sanitize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn canonical_string(path: PathBuf) -> String {
    match fs::canonicalize(&path) {
        Ok(canonical) => canonical.to_string_lossy().to_string(),
        Err(_) => path.to_string_lossy().to_string(),
    }
}

fn ensure_settings_defaults(settings: &mut ComfyUISettings) -> bool {
    let mut changed = false;
    if settings.base_url.is_none() {
        settings.base_url = Some(DEFAULT_BASE_URL.to_string());
        changed = true;
    }
    if settings.auto_launch.is_none() {
        settings.auto_launch = Some(DEFAULT_AUTO_LAUNCH);
        changed = true;
    }
    changed
}

#[derive(Serialize, Deserialize)]
pub struct GenResult {
    pub path: String,
    pub device: String,
    pub paths: Option<Vec<String>>,
    pub fallback: Option<bool>,
    pub fallback_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RiffusionResult {
    pub path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioPrompts {
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioPromptUpdate {
    pub prompt: String,
    pub negative_prompt: String,
    #[serde(default)]
    pub file_name_prefix: Option<String>,
    #[serde(default)]
    pub seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioTemplate {
    pub name: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioTemplatePayload {
    pub name: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ComfyUISettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_launch: Option<bool>,
}

impl Default for ComfyUISettings {
    fn default() -> Self {
        Self {
            executable_path: None,
            working_directory: None,
            base_url: Some(DEFAULT_BASE_URL.to_string()),
            output_dir: None,
            auto_launch: Some(DEFAULT_AUTO_LAUNCH),
        }
    }
}

impl ComfyUISettings {
    fn base_url(&self) -> String {
        self.base_url
            .as_deref()
            .unwrap_or(DEFAULT_BASE_URL)
            .trim_end_matches('/')
            .to_string()
    }

    fn auto_launch_enabled(&self) -> bool {
        self.auto_launch.unwrap_or(DEFAULT_AUTO_LAUNCH)
    }
}

fn load_comfyui_settings_from_store(store: &Store<tauri::Wry>) -> ComfyUISettings {
    store
        .get(COMFY_SETTINGS_KEY)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

fn persist_comfyui_settings(
    store: &Store<tauri::Wry>,
    settings: &ComfyUISettings,
) -> Result<(), String> {
    let value = serde_json::to_value(settings)
        .map_err(|err| format!("Failed to encode settings: {}", err))?;
    store.set(COMFY_SETTINGS_KEY, value);
    store
        .save()
        .map_err(|err| format!("Failed to save settings: {}", err))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyUISettingsUpdate {
    pub executable_path: Option<String>,
    pub working_directory: Option<String>,
    pub base_url: Option<String>,
    pub output_dir: Option<String>,
    pub auto_launch: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ComfyUIStatusResponse {
    pub running: bool,
    pub pending: usize,
    #[serde(rename = "runningCount")]
    pub running_count: usize,
}

#[derive(Debug, Serialize)]
pub struct ComfyUIOutput {
    pub node_id: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subfolder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ComfyUIJobStatusResponse {
    pub status: String,
    pub pending: usize,
    pub running: usize,
    pub outputs: Vec<ComfyUIOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ComfyUISubmitResponse {
    pub prompt_id: String,
    pub client_id: String,
}

#[derive(Debug, Deserialize, Default)]
struct QueueSnapshot {
    #[serde(default)]
    queue_running: Vec<Value>,
    #[serde(default)]
    queue_pending: Vec<Value>,
}

#[derive(Debug, Deserialize, Default)]
struct SystemStats {
    system: Option<SystemSection>,
}

#[derive(Debug, Deserialize, Default)]
struct SystemSection {
    argv: Option<Vec<String>>,
}

#[derive(Debug, Default)]
struct SystemPaths {
    output_dir: Option<PathBuf>,
}

fn normalize_base_url_str(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_BASE_URL.to_string());
    }
    let mut url =
        Url::parse(trimmed).map_err(|err| format!("Invalid base URL '{}': {}", trimmed, err))?;
    url.set_path("");
    let normalized = url.to_string().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        Ok(DEFAULT_BASE_URL.to_string())
    } else {
        Ok(normalized)
    }
}

fn comfy_http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {}", err))
}

async fn get_json(url: String) -> Result<Value, String> {
    async_runtime::spawn_blocking(move || {
        let client = comfy_http_client(Duration::from_secs(10))?;
        let response = client
            .get(&url)
            .header(CONTENT_TYPE, "application/json")
            .send()
            .map_err(|err| format!("GET {} failed: {}", url, err))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("GET {} returned status {}", url, status));
        }
        response
            .json::<Value>()
            .map_err(|err| format!("Failed to parse response from {}: {}", url, err))
    })
    .await
    .map_err(|err| err.to_string())?
}

async fn post_json(url: String, body: Value) -> Result<Value, String> {
    async_runtime::spawn_blocking(move || {
        let client = comfy_http_client(Duration::from_secs(30))?;
        let response = client
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .map_err(|err| format!("POST {} failed: {}", url, err))?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().unwrap_or_default();
            return Err(format!("POST {} returned status {}: {}", url, status, text));
        }
        response
            .json::<Value>()
            .map_err(|err| format!("Failed to parse response from {}: {}", url, err))
    })
    .await
    .map_err(|err| err.to_string())?
}

fn extract_output_dir_from_argv(argv: &[String]) -> Option<PathBuf> {
    let mut iter = argv.iter();
    while let Some(arg) = iter.next() {
        if arg == "--output-directory" {
            if let Some(value) = iter.next() {
                if !value.trim().is_empty() {
                    return Some(PathBuf::from(value));
                }
            }
        }
    }
    None
}

async fn fetch_system_paths(base_url: &str) -> Result<SystemPaths, String> {
    let url = format!("{}{}", base_url, SYSTEM_STATS_ENDPOINT);
    let value = get_json(url).await?;
    let stats: SystemStats = serde_json::from_value(value)
        .map_err(|err| format!("Failed to parse system stats: {}", err))?;
    let mut paths = SystemPaths::default();
    if let Some(system) = stats.system {
        if let Some(argv) = system.argv {
            paths.output_dir = extract_output_dir_from_argv(&argv);
        }
    }
    Ok(paths)
}

async fn fetch_queue_snapshot(base_url: &str) -> Result<QueueSnapshot, String> {
    let url = format!("{}{}", base_url, QUEUE_ENDPOINT);
    let value = get_json(url).await?;
    serde_json::from_value(value).map_err(|err| format!("Failed to parse queue snapshot: {}", err))
}

async fn fetch_history_entry(base_url: &str, prompt_id: &str) -> Result<Option<Value>, String> {
    let url = format!(
        "{}{}{}",
        base_url,
        HISTORY_ENDPOINT,
        format!("/{}", prompt_id)
    );
    let value = get_json(url).await?;
    if let Some(obj) = value.as_object() {
        if let Some(entry) = obj.get(prompt_id) {
            return Ok(Some(entry.clone()));
        }
    }
    Ok(None)
}

fn queue_contains_prompt(entries: &[Value], target: &str) -> bool {
    entries.iter().any(|entry| match entry {
        Value::Array(items) => {
            if let Some(Value::String(id)) = items.get(1) {
                id == target
            } else if let Some(Value::Object(obj)) = items.get(1) {
                obj.get("id").and_then(Value::as_str) == Some(target)
            } else {
                false
            }
        }
        Value::Object(obj) => obj
            .get("prompt_id")
            .and_then(Value::as_str)
            .map(|id| id == target)
            .unwrap_or(false),
        _ => false,
    })
}

fn resolve_output_directory(settings: &ComfyUISettings, sys_paths: &SystemPaths) -> PathBuf {
    if let Some(ref explicit) = settings.output_dir {
        let pb = PathBuf::from(explicit);
        if pb.is_absolute() {
            return pb;
        }
        if let Some(ref working) = settings.working_directory {
            return PathBuf::from(working).join(explicit);
        }
        return pb;
    }
    if let Some(ref sys_path) = sys_paths.output_dir {
        return sys_path.clone();
    }
    if let Some(ref working) = settings.working_directory {
        return PathBuf::from(working).join("output");
    }
    PathBuf::from("output")
}

fn extract_outputs(
    outputs_value: Option<&Value>,
    settings: &ComfyUISettings,
    sys_paths: &SystemPaths,
) -> Vec<ComfyUIOutput> {
    let mut outputs = Vec::new();
    let Some(outputs_map) = outputs_value.and_then(Value::as_object) else {
        return outputs;
    };
    let base_dir = resolve_output_directory(settings, sys_paths);
    for (node_id, node_value) in outputs_map {
        if let Some(ui) = node_value.get("ui").and_then(Value::as_object) {
            if let Some(audio_items) = ui.get("audio").and_then(Value::as_array) {
                for audio in audio_items {
                    if let Some(filename) = audio.get("filename").and_then(Value::as_str) {
                        let subfolder =
                            audio.get("subfolder").and_then(Value::as_str).unwrap_or("");
                        let kind = audio
                            .get("type")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string());
                        let mut path = base_dir.clone();
                        if !subfolder.is_empty() {
                            for part in subfolder.replace('\\', "/").split('/') {
                                if !part.is_empty() {
                                    path.push(part);
                                }
                            }
                        }
                        path.push(filename);
                        let local_path = path.to_string_lossy().to_string();
                        outputs.push(ComfyUIOutput {
                            node_id: node_id.clone(),
                            filename: filename.to_string(),
                            local_path: Some(local_path),
                            subfolder: if subfolder.is_empty() {
                                None
                            } else {
                                Some(subfolder.to_string())
                            },
                            kind,
                        });
                    }
                }
            }
        }
    }
    outputs
}

fn build_link_map(links: &[Value]) -> Result<HashMap<i64, (i64, usize)>, String> {
    let mut map = HashMap::new();
    for link in links {
        let arr = link
            .as_array()
            .ok_or_else(|| "Workflow link is not an array".to_string())?;
        if arr.len() < 5 {
            continue;
        }
        let link_id = arr
            .get(0)
            .and_then(Value::as_i64)
            .ok_or_else(|| "Link missing id".to_string())?;
        let origin = arr
            .get(1)
            .and_then(Value::as_i64)
            .ok_or_else(|| "Link missing origin".to_string())?;
        let origin_index = arr.get(2).and_then(Value::as_u64).unwrap_or(0) as usize;
        map.insert(link_id, (origin, origin_index));
    }
    Ok(map)
}

fn convert_node_to_prompt(
    node: &Value,
    link_map: &HashMap<i64, (i64, usize)>,
) -> Result<Option<(String, Value)>, String> {
    let node_obj = node
        .as_object()
        .ok_or_else(|| "Workflow node is not an object".to_string())?;
    let node_id = node_obj
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Workflow node missing id".to_string())?;
    let node_type = node_obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "Workflow node missing type".to_string())?;
    if node_type == "MarkdownNote" {
        return Ok(None);
    }

    let mut prompt_node = Map::new();
    prompt_node.insert(
        "class_type".to_string(),
        Value::String(node_type.to_string()),
    );

    if let Some(inputs) = node_obj.get("inputs").and_then(Value::as_object) {
        let mut inputs_map = Map::new();
        for (key, value) in inputs {
            let input_value = if let Some(link_id) = value.get("link").and_then(Value::as_i64) {
                if let Some((origin, index)) = link_map.get(&link_id) {
                    Value::Array(vec![
                        Value::Number((*origin).into()),
                        Value::Number((*index).into()),
                    ])
                } else {
                    Value::Null
                }
            } else {
                value.clone()
            };
            inputs_map.insert(key.clone(), input_value);
        }
        prompt_node.insert("inputs".to_string(), Value::Object(inputs_map));
    }

    if let Some(widgets) = node_obj.get("widgets_values") {
        prompt_node.insert("widgets_values".to_string(), widgets.clone());
    }

    Ok(Some((node_id.to_string(), Value::Object(prompt_node))))
}

fn convert_stable_audio_workflow_to_prompt(workflow: &Value) -> Result<Map<String, Value>, String> {
    let nodes = workflow
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    let links = workflow
        .get("links")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a links array".to_string())?;
    let link_map = build_link_map(links)?;
    let mut prompt = Map::new();
    for node in nodes {
        if let Some((id, value)) = convert_node_to_prompt(node, &link_map)? {
            prompt.insert(id, value);
        }
    }
    Ok(prompt)
}
fn load_stable_audio_templates(store: &Store<tauri::Wry>) -> Vec<StableAudioTemplate> {
    store
        .get(TEMPLATES_KEY)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default()
}

fn persist_stable_audio_templates(
    store: &Store<tauri::Wry>,
    templates: &[StableAudioTemplate],
) -> Result<(), String> {
    let value = serde_json::to_value(templates)
        .map_err(|err| format!("Failed to encode templates: {}", err))?;
    store.set(TEMPLATES_KEY, value);
    store
        .save()
        .map_err(|err| format!("Failed to save templates: {}", err))
}

fn stable_audio_workflow_path() -> std::path::PathBuf {
    project_root()
        .join("assets")
        .join("workflows")
        .join("stable_audio.json")
}

fn locate_stable_audio_nodes(data: &Value) -> Result<(i64, i64), String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let sampler_id = nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some("KSampler"))
        .and_then(|node| node.get("id"))
        .and_then(Value::as_i64)
        .ok_or_else(|| "Unable to locate KSampler node in workflow".to_string())?;

    let links = data
        .get("links")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a links array".to_string())?;

    let mut positive: Option<i64> = None;
    let mut negative: Option<i64> = None;

    for link in links {
        let arr = match link.as_array() {
            Some(arr) => arr,
            None => continue,
        };
        if arr.len() < 5 {
            continue;
        }
        let target_node = arr.get(3).and_then(Value::as_i64);
        if target_node != Some(sampler_id) {
            continue;
        }
        let origin = arr.get(1).and_then(Value::as_i64);
        let target_slot = arr.get(4).and_then(Value::as_i64);
        match target_slot {
            Some(1) => positive = origin,
            Some(2) => negative = origin,
            _ => {}
        }
    }

    let positive =
        positive.ok_or_else(|| "Positive conditioning node not found in workflow".to_string())?;
    let negative =
        negative.ok_or_else(|| "Negative conditioning node not found in workflow".to_string())?;
    Ok((positive, negative))
}

fn locate_save_audio_node(data: &Value) -> Result<i64, String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some("SaveAudio"))
        .and_then(|node| node.get("id").and_then(Value::as_i64))
        .ok_or_else(|| "SaveAudio node not found in workflow".to_string())
}

fn locate_empty_latent_audio_node(data: &Value) -> Result<i64, String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some("EmptyLatentAudio"))
        .and_then(|node| node.get("id").and_then(Value::as_i64))
        .ok_or_else(|| "EmptyLatentAudio node not found in workflow".to_string())
}

fn extract_prompt_text(data: &Value, node_id: i64) -> String {
    data.get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                if node.get("id").and_then(Value::as_i64) != Some(node_id) {
                    return None;
                }
                node.get("widgets_values")
                    .and_then(Value::as_array)
                    .and_then(|vals| vals.get(0))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_default()
}

fn extract_save_audio_prefix(data: &Value, node_id: i64) -> String {
    data.get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                if node.get("id").and_then(Value::as_i64) != Some(node_id) {
                    return None;
                }
                node.get("widgets_values")
                    .and_then(Value::as_array)
                    .and_then(|vals| vals.get(0))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
        })
        .unwrap_or_else(|| DEFAULT_FILE_PREFIX.to_string())
}

fn set_prompt_text(data: &mut Value, node_id: i64, text: &str) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("Node {} not found in workflow", node_id))?;

    let obj = node
        .as_object_mut()
        .ok_or_else(|| format!("Node {} is not an object", node_id))?;

    match obj.get_mut("widgets_values") {
        Some(Value::Array(arr)) => {
            if arr.is_empty() {
                arr.push(Value::String(text.to_owned()));
            } else {
                arr[0] = Value::String(text.to_owned());
            }
        }
        _ => {
            obj.insert(
                "widgets_values".to_string(),
                Value::Array(vec![Value::String(text.to_owned())]),
            );
        }
    }

    Ok(())
}

fn set_save_audio_prefix(data: &mut Value, node_id: i64, prefix: &str) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("SaveAudio node {} not found in workflow", node_id))?;

    let obj = node
        .as_object_mut()
        .ok_or_else(|| format!("SaveAudio node {} is not an object", node_id))?;

    match obj.get_mut("widgets_values") {
        Some(Value::Array(arr)) => {
            if arr.is_empty() {
                arr.push(Value::String(prefix.to_owned()));
            } else {
                arr[0] = Value::String(prefix.to_owned());
            }
        }
        _ => {
            obj.insert(
                "widgets_values".to_string(),
                Value::Array(vec![Value::String(prefix.to_owned())]),
            );
        }
    }

    Ok(())
}

fn load_stable_audio_workflow() -> Result<Value, String> {
    let path = stable_audio_workflow_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read stable_audio.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse stable_audio.json: {}", e))
}

fn persist_stable_audio_workflow(data: &Value) -> Result<(), String> {
    let path = stable_audio_workflow_path();
    let payload = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
    fs::write(&path, payload).map_err(|e| format!("Failed to write workflow file: {}", e))
}

fn extract_latent_seconds(data: &Value, node_id: i64) -> f64 {
    data.get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                if node.get("id").and_then(Value::as_i64) != Some(node_id) {
                    return None;
                }
                node.get("widgets_values")
                    .and_then(Value::as_array)
                    .and_then(|vals| vals.get(0))
                    .and_then(Value::as_f64)
            })
        })
        .unwrap_or(DEFAULT_SECONDS)
}

fn set_latent_seconds(data: &mut Value, node_id: i64, seconds: f64) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("EmptyLatentAudio node {} not found in workflow", node_id))?;
    let obj = node
        .as_object_mut()
        .ok_or_else(|| format!("EmptyLatentAudio node {} is not an object", node_id))?;
    let value =
        Number::from_f64(seconds).unwrap_or_else(|| Number::from_f64(DEFAULT_SECONDS).unwrap());
    match obj.get_mut("widgets_values") {
        Some(Value::Array(arr)) => {
            if arr.is_empty() {
                arr.push(Value::Number(value));
            } else {
                arr[0] = Value::Number(value);
            }
        }
        _ => {
            obj.insert(
                "widgets_values".to_string(),
                Value::Array(vec![Value::Number(value)]),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_stable_audio_prompts() -> Result<StableAudioPrompts, String> {
    let data = load_stable_audio_workflow()?;
    let (positive_id, negative_id) = locate_stable_audio_nodes(&data)?;
    let save_node = locate_save_audio_node(&data)?;
    let latent_node = locate_empty_latent_audio_node(&data)?;
    Ok(StableAudioPrompts {
        prompt: extract_prompt_text(&data, positive_id),
        negative_prompt: extract_prompt_text(&data, negative_id),
        file_name_prefix: extract_save_audio_prefix(&data, save_node),
        seconds: extract_latent_seconds(&data, latent_node),
    })
}

#[tauri::command]
pub fn update_stable_audio_prompts(
    payload: StableAudioPromptUpdate,
) -> Result<StableAudioPrompts, String> {
    let mut data = load_stable_audio_workflow()?;
    let (positive_id, negative_id) = locate_stable_audio_nodes(&data)?;
    let save_node = locate_save_audio_node(&data)?;
    let latent_node = locate_empty_latent_audio_node(&data)?;

    let prompt = payload.prompt.trim().to_string();
    let negative = payload.negative_prompt.trim().to_string();
    let prefix = payload
        .file_name_prefix
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_FILE_PREFIX)
        .to_string();
    let seconds = payload
        .seconds
        .map(|value| {
            if value.is_finite() && value > 0.0 {
                value
            } else {
                DEFAULT_SECONDS
            }
        })
        .unwrap_or(DEFAULT_SECONDS);

    set_prompt_text(&mut data, positive_id, &prompt)?;
    set_prompt_text(&mut data, negative_id, &negative)?;
    set_save_audio_prefix(&mut data, save_node, &prefix)?;
    set_latent_seconds(&mut data, latent_node, seconds)?;
    persist_stable_audio_workflow(&data)?;

    Ok(StableAudioPrompts {
        prompt,
        negative_prompt: negative,
        file_name_prefix: prefix,
        seconds,
    })
}

#[tauri::command]
pub fn get_stable_audio_templates(app: AppHandle) -> Result<Vec<StableAudioTemplate>, String> {
    let store = settings_store(&app)?;
    let mut templates = load_stable_audio_templates(store.as_ref());
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(templates)
}

#[tauri::command]
pub fn save_stable_audio_template(
    app: AppHandle,
    template: StableAudioTemplatePayload,
) -> Result<Vec<StableAudioTemplate>, String> {
    let name = template.name.trim();
    if name.is_empty() {
        return Err("Template name cannot be empty.".into());
    }

    let prompt = template.prompt.trim();
    if prompt.is_empty() {
        return Err("Template prompt cannot be empty.".into());
    }
    let negative = template.negative_prompt.trim();
    let prefix = {
        let trimmed = template.file_name_prefix.trim();
        if trimmed.is_empty() {
            DEFAULT_FILE_PREFIX.to_string()
        } else {
            trimmed.to_string()
        }
    };
    let seconds = if template.seconds.is_finite() && template.seconds > 0.0 {
        template.seconds
    } else {
        DEFAULT_SECONDS
    };

    let new_template = StableAudioTemplate {
        name: name.to_string(),
        prompt: prompt.to_string(),
        negative_prompt: negative.to_string(),
        file_name_prefix: prefix,
        seconds,
    };

    let store = settings_store(&app)?;
    let mut templates = load_stable_audio_templates(store.as_ref());
    if let Some(existing) = templates
        .iter_mut()
        .find(|item| item.name.eq_ignore_ascii_case(name))
    {
        *existing = new_template;
    } else {
        templates.push(new_template);
    }
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    persist_stable_audio_templates(store.as_ref(), &templates)?;
    Ok(templates)
}

#[tauri::command]
pub fn get_comfyui_settings(app: AppHandle) -> Result<ComfyUISettings, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_comfyui_settings(
    app: AppHandle,
    update: ComfyUISettingsUpdate,
) -> Result<ComfyUISettings, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    ensure_settings_defaults(&mut settings);

    if let Some(path) = update.executable_path {
        match sanitize_optional_string(Some(path)) {
            Some(value) => {
                let pb = PathBuf::from(&value);
                if !pb.exists() {
                    return Err(format!("ComfyUI executable not found at '{}'.", value));
                }
                settings.executable_path = Some(canonical_string(pb));
            }
            None => settings.executable_path = None,
        }
    }

    if let Some(dir) = update.working_directory {
        settings.working_directory = sanitize_optional_string(Some(dir))
            .map(|value| {
                let pb = PathBuf::from(&value);
                if !pb.is_dir() {
                    return Err(format!(
                        "Working directory '{}' does not exist or is not a directory.",
                        value
                    ));
                }
                Ok(canonical_string(pb))
            })
            .transpose()?;
    }

    if let Some(base_url) = update.base_url {
        settings.base_url = Some(normalize_base_url_str(&base_url)?);
    }

    if let Some(out_dir) = update.output_dir {
        match sanitize_optional_string(Some(out_dir)) {
            Some(value) => {
                let pb = PathBuf::from(&value);
                if !pb.exists() {
                    fs::create_dir_all(&pb).map_err(|err| {
                        format!("Failed to create output directory '{}': {}", value, err)
                    })?;
                }
                settings.output_dir = Some(canonical_string(pb));
            }
            None => settings.output_dir = None,
        }
    }

    if let Some(auto_launch) = update.auto_launch {
        settings.auto_launch = Some(auto_launch);
    }

    persist_comfyui_settings(store.as_ref(), &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn comfyui_status(
    app: AppHandle,
    ensure_running: Option<bool>,
) -> Result<ComfyUIStatusResponse, String> {
    let ensure_launch = ensure_running.unwrap_or(false);
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let base_url = settings.base_url();
    match fetch_queue_snapshot(&base_url).await {
        Ok(snapshot) => Ok(ComfyUIStatusResponse {
            running: true,
            pending: snapshot.queue_pending.len(),
            running_count: snapshot.queue_running.len(),
        }),
        Err(err) => {
            if ensure_launch && settings.auto_launch_enabled() {
                if let Some(executable) = settings.executable_path.clone() {
                    let mut command = Command::new(executable);
                    if let Some(ref dir) = settings.working_directory {
                        command.current_dir(dir);
                    }
                    command
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    command
                        .spawn()
                        .map_err(|e| format!("Failed to launch ComfyUI: {}", e))?;
                    sleep(Duration::from_secs(1)).await;
                    match fetch_queue_snapshot(&base_url).await {
                        Ok(snapshot) => {
                            return Ok(ComfyUIStatusResponse {
                                running: true,
                                pending: snapshot.queue_pending.len(),
                                running_count: snapshot.queue_running.len(),
                            });
                        }
                        Err(after_launch_err) => {
                            return Err(after_launch_err);
                        }
                    }
                }
            }
            Err(format!("Unable to reach ComfyUI at {}: {}", base_url, err))
        }
    }
}

#[tauri::command]
pub async fn comfyui_submit_stable_audio(app: AppHandle) -> Result<ComfyUISubmitResponse, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let workflow = load_stable_audio_workflow()?;
    let prompt_map = convert_stable_audio_workflow_to_prompt(&workflow)?;
    let prompt_value = Value::Object(prompt_map);
    let client_id = format!("{}-{}", CLIENT_NAMESPACE, Uuid::new_v4());
    let base_url = settings.base_url();
    let url = format!("{}{}", base_url, PROMPT_ENDPOINT);
    let response = post_json(
        url,
        json!({
            "prompt": prompt_value,
            "client_id": client_id,
        }),
    )
    .await?;
    let prompt_id = response
        .get("prompt_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "ComfyUI submission did not return a prompt_id.".to_string())?;

    Ok(ComfyUISubmitResponse {
        prompt_id: prompt_id.to_string(),
        client_id,
    })
}

#[tauri::command]
pub async fn comfyui_job_status(
    app: AppHandle,
    prompt_id: String,
) -> Result<ComfyUIJobStatusResponse, String> {
    let requested = prompt_id.trim();
    if requested.is_empty() {
        return Err("Prompt id is required.".into());
    }

    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    ensure_settings_defaults(&mut settings);
    let base_url = settings.base_url();

    match fetch_queue_snapshot(&base_url).await {
        Ok(snapshot) => {
            if queue_contains_prompt(&snapshot.queue_running, requested) {
                return Ok(ComfyUIJobStatusResponse {
                    status: "running".into(),
                    pending: snapshot.queue_pending.len(),
                    running: snapshot.queue_running.len(),
                    outputs: Vec::new(),
                    message: None,
                });
            }
            if queue_contains_prompt(&snapshot.queue_pending, requested) {
                return Ok(ComfyUIJobStatusResponse {
                    status: "queued".into(),
                    pending: snapshot.queue_pending.len(),
                    running: snapshot.queue_running.len(),
                    outputs: Vec::new(),
                    message: None,
                });
            }
        }
        Err(err) => {
            return Ok(ComfyUIJobStatusResponse {
                status: "offline".into(),
                pending: 0,
                running: 0,
                outputs: Vec::new(),
                message: Some(format!("Unable to reach ComfyUI at {}: {}", base_url, err)),
            });
        }
    }

    let history_entry = fetch_history_entry(&base_url, requested).await?;
    let Some(entry) = history_entry else {
        return Ok(ComfyUIJobStatusResponse {
            status: "error".into(),
            pending: 0,
            running: 0,
            outputs: Vec::new(),
            message: Some("Prompt not found in ComfyUI history.".into()),
        });
    };

    let status_obj = entry.get("status").and_then(Value::as_object);
    let status_str = status_obj
        .and_then(|obj| obj.get("status_str").and_then(Value::as_str))
        .unwrap_or("success");
    let completed = status_obj
        .and_then(|obj| obj.get("completed").and_then(Value::as_bool))
        .unwrap_or(false);
    let message = status_obj
        .and_then(|obj| obj.get("messages").and_then(Value::as_array))
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(
                    "
",
                )
        })
        .filter(|s| !s.is_empty());

    let final_status = if status_str.eq_ignore_ascii_case("error") {
        "error"
    } else if completed {
        "completed"
    } else if status_str.eq_ignore_ascii_case("queued") {
        "queued"
    } else if status_str.eq_ignore_ascii_case("running") {
        "running"
    } else {
        "running"
    };

    let system_paths = fetch_system_paths(&base_url).await.unwrap_or_default();
    let outputs = extract_outputs(entry.get("outputs"), &settings, &system_paths);

    Ok(ComfyUIJobStatusResponse {
        status: final_status.to_string(),
        pending: 0,
        running: 0,
        outputs,
        message,
    })
}

#[tauri::command]
pub async fn riffusion_generate(
    app: AppHandle,
    prompt: Option<String>,
    negative: Option<String>,
    seed: Option<i64>,
    steps: Option<u32>,
    guidance: Option<f32>,
) -> Result<RiffusionResult, String> {
    // Output directory under AppData
    let out_base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&out_base).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out_path = out_base.join(format!("riffusion_{}.wav", ts));

    // Build command to run the CLI
    let mut args: Vec<String> = vec![
        "-m".into(),
        "blossom.audio.riffusion.cli_riffusion".into(),
        "--outfile".into(),
        out_path.to_string_lossy().to_string(),
        "--tiles".into(),
        "1".into(),
        "--width".into(),
        "512".into(),
        "--height".into(),
        "512".into(),
        "--overlap".into(),
        "32".into(),
        "--sr".into(),
        "22050".into(),
        "--hs_freq".into(),
        "5000".into(),
        "--hs_gain".into(),
        "2.0".into(),
        "--lowcut".into(),
        "35".into(),
        "--wet".into(),
        "0.12".into(),
    ];
    if let Some(s) = steps {
        args.push("--steps".into());
        args.push(s.to_string());
    }
    if let Some(g) = guidance {
        args.push("--guidance".into());
        args.push(format!("{}", g));
    }
    if let Some(n) = negative.clone() {
        args.push("--negative".into());
        args.push(n);
    }
    if let Some(sd) = seed {
        args.push("--seed".into());
        args.push(sd.to_string());
    }
    // Prefer explicit prompt if provided; otherwise rely on preset default (piano)
    if let Some(p) = prompt.clone() {
        args.push(p);
    }

    let output = async_runtime::spawn_blocking(move || {
        Command::new("python")
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(args)
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(RiffusionResult {
        path: out_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn generate_musicgen(
    app: AppHandle,
    prompt: String,
    duration: f32,
    model_name: String,
    temperature: f32,
    // Optional: force running on CPU regardless of CUDA availability
    force_cpu: Option<bool>,
    // Optional: force trying GPU (even if torch reports otherwise)
    force_gpu: Option<bool>,
    // Optional: request FP16 on GPU to reduce VRAM
    use_fp16: Option<bool>,
    // Optional: output directory; defaults to AppData
    output_dir: Option<String>,
    // Optional: desired output base name (without extension)
    output_name: Option<String>,
    // Optional: number of samples to generate
    count: Option<u32>,
    // Optional: path to a melody conditioning clip
    melody_path: Option<String>,
) -> Result<GenResult, String> {
    // Base output directory
    let out_base = if let Some(dir) = output_dir.clone() {
        std::path::PathBuf::from(dir)
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?
    };
    fs::create_dir_all(&out_base).map_err(|e| e.to_string())?;
    // Use OS-native separators so it matches appDataDir() prefix on Windows
    let out_dir_str = out_base.to_string_lossy().to_string();
    let times: u32 = count.unwrap_or(1).max(1).min(10);
    let melody_literal = match melody_path {
        Some(path) => {
            if path.trim().is_empty() {
                "None".to_string()
            } else {
                serde_json::to_string(&path)
                    .map_err(|e| format!("Failed to encode melody path: {}", e))?
            }
        }
        None => "None".to_string(),
    };

    let code = format!(
        r#"import sys
import core.musicgen_backend as m
import json
try:
    import torch
except Exception:
    torch = None
forced_cpu = {forced_cpu}
try:
    dev = 'cpu'
    if not forced_cpu and torch is not None and getattr(getattr(torch, 'cuda', object()), 'is_available', lambda: False)():
        dev = 'gpu'
    paths = []
    for _ in range({times}):
        p = m.generate_music({prompt:?}, {duration}, {model_name:?}, {temperature}, {out_dir:?}, melody_path={melody})
        paths.append(p)
    path = paths[0] if paths else ""
    status = getattr(m, 'get_last_status', lambda: {{}})()
    used_device = status.get('device', dev)
    fb = status.get('fallback')
    fr = status.get('reason')
    print(json.dumps({{"path": path, "paths": paths, "device": used_device, "fallback": fb, "fallback_reason": fr}}))
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)
"#,
        prompt = prompt,
        duration = duration,
        model_name = model_name,
        temperature = temperature,
        out_dir = out_dir_str,
        forced_cpu = if force_cpu.unwrap_or(false) {
            "True"
        } else {
            "False"
        },
        times = times,
        melody = melody_literal,
    );

    let output = async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("python");
        if force_cpu.unwrap_or(false) {
            // Force CPU by hiding CUDA devices for this process
            cmd.env("CUDA_VISIBLE_DEVICES", "");
        }
        if force_gpu.unwrap_or(false) {
            cmd.env("MUSICGEN_FORCE_GPU", "1");
        }
        if use_fp16.unwrap_or(false) {
            cmd.env("MUSICGEN_FP16", "1");
        }
        cmd.current_dir("..")
            .env("PYTHONPATH", "..")
            .args(["-c", &code])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Expect JSON {"path": ..., "paths": [...], "device": ...}
    let mut parsed: GenResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse musicgen output: {}\nstdout: {}", e, stdout))?;

    // If a custom name was provided, rename the generated files accordingly.
    if let Some(name_raw) = output_name {
        let sanitize = |s: &str| {
            let mut out = String::new();
            for ch in s.chars() {
                let ok =
                    ch.is_ascii_alphanumeric() || ch == ' ' || ch == '_' || ch == '-' || ch == '.';
                out.push(if ok { ch } else { '_' });
            }
            let trimmed = out.trim().trim_matches('.').to_string();
            let cleaned = if trimmed.is_empty() {
                "track".to_string()
            } else {
                trimmed
            };
            cleaned.chars().take(120).collect::<String>()
        };
        let base_name = sanitize(&name_raw);
        let ensure_ext = |mut s: String| {
            if !s.to_lowercase().ends_with(".wav") {
                s.push_str(".wav");
            }
            s
        };

        let mut rename_one = |src: &str, target_name: String| -> Result<String, String> {
            let mut target = out_base.join(&target_name);
            // If exists, add (n)
            if target.exists() {
                let mut n = 1u32;
                let stem = std::path::Path::new(&target_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("track");
                let ext = std::path::Path::new(&target_name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("wav");
                loop {
                    let candidate = out_base.join(format!("{} ({}){}.{}", stem, n, "", ext));
                    if !candidate.exists() {
                        target = candidate;
                        break;
                    }
                    n += 1;
                    if n > 9999 {
                        break;
                    }
                }
            }
            fs::rename(src, &target).map_err(|e| e.to_string())?;
            Ok(target.to_string_lossy().to_string())
        };

        if let Some(paths) = parsed.paths.as_ref() {
            if !paths.is_empty() {
                let multiple = paths.len() > 1;
                let width = ((paths.len() as f32).log10().floor() as usize) + 1;
                let mut new_paths = Vec::with_capacity(paths.len());
                for (idx, p) in paths.iter().enumerate() {
                    let mut fname = if multiple {
                        format!("{}_{:0width$}", base_name, idx + 1, width = width)
                    } else {
                        base_name.clone()
                    };
                    fname = ensure_ext(fname);
                    match rename_one(p, fname) {
                        Ok(np) => new_paths.push(np),
                        Err(_) => new_paths.push(p.clone()),
                    }
                }
                parsed.path = new_paths
                    .get(0)
                    .cloned()
                    .unwrap_or_else(|| parsed.path.clone());
                parsed.paths = Some(new_paths);
            }
        } else if !parsed.path.is_empty() {
            let fname = ensure_ext(base_name.clone());
            if let Ok(np) = rename_one(&parsed.path, fname) {
                parsed.path = np.clone();
                parsed.paths = Some(vec![np]);
            }
        }
    }
    Ok(parsed)
}

#[derive(Serialize, Deserialize)]
pub struct EnvInfo {
    pub device: String,
    pub cuda_available: bool,
    pub name: String,
    pub torch: String,
    pub cuda_version: Option<String>,
    pub total_mem: Option<u64>,
    pub free_mem: Option<u64>,
    pub error: Option<String>,
    // Extra diagnostics
    pub python_exe: Option<String>,
    pub python_version: Option<String>,
    pub device_count: Option<u32>,
    pub devices: Option<Vec<String>>,
    pub visible_devices: Option<String>,
}

#[tauri::command]
pub async fn musicgen_env() -> Result<EnvInfo, String> {
    let code = r#"import json, os, sys, subprocess, shutil
info = {
  "device": "cpu",
  "cuda_available": False,
  "name": "",
  "torch": "",
  "torch_cuda": None,
  "cuda_version": None,
  "total_mem": None,
  "free_mem": None,
  "error": None,
  "python_exe": sys.executable,
  "python_version": sys.version.split(" (", 1)[0],
  "device_count": 0,
  "devices": [],
  "visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
  "nvidia_smi": None,
}
try:
    import torch
    info["torch"] = getattr(torch, "__version__", "")
    info["torch_cuda"] = getattr(getattr(torch, "version", object()), "cuda", None)
    info["cuda_version"] = info["torch_cuda"]
    is_avail = getattr(getattr(torch, "cuda", object()), "is_available", lambda: False)()
    if is_avail:
        info["cuda_available"] = True
        info["device"] = "gpu"
        try:
            info["device_count"] = int(torch.cuda.device_count())
        except Exception:
            pass
        try:
            info["devices"] = [torch.cuda.get_device_name(i) for i in range(int(info["device_count"]))]
        except Exception:
            pass
        try:
            info["name"] = torch.cuda.get_device_name(0)
        except Exception:
            pass
        try:
            free_mem, total_mem = torch.cuda.mem_get_info(0)
            info["free_mem"] = int(free_mem)
            info["total_mem"] = int(total_mem)
        except Exception:
            pass
except Exception as exc:
    info["error"] = str(exc)

# Fallback: query nvidia-smi if available
try:
    smi = shutil.which("nvidia-smi")
    if smi:
        res = subprocess.run(
            [smi, "--query-gpu=name,memory.total,memory.free,driver_version,cuda_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3
        )
        if res.returncode == 0:
            lines = [l.strip() for l in res.stdout.splitlines() if l.strip()]
            if lines:
                first = lines[0].split(',')
                info["nvidia_smi"] = {
                    "name": first[0].strip(),
                    "total_mem": int(first[1].strip()) * 1024 * 1024,
                    "free_mem": int(first[2].strip()) * 1024 * 1024,
                    "driver": first[3].strip(),
                    "cuda": first[4].strip(),
                }
                if not info.get("cuda_available"):
                    info["device"] = "gpu"
except Exception:
    pass

print(json.dumps(info))
"#;

    let output = async_runtime::spawn_blocking(move || {
        Command::new("python")
            .current_dir("..")
            .env("PYTHONPATH", "..")
            .args(["-c", code])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: EnvInfo = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse env output: {}\nstdout: {}", e, stdout))?;
    Ok(parsed)
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn album_concat(
    files: Vec<String>,
    output_dir: String,
    output_name: Option<String>,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("No input files provided".into());
    }
    // Ensure output directory exists
    let out_dir = std::path::PathBuf::from(&output_dir);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    // Build output file path
    let mut final_name = output_name.unwrap_or_else(|| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("album_{}.mp3", ts)
    });
    if !final_name.to_lowercase().ends_with(".mp3") {
        final_name.push_str(".mp3");
    }
    let out_path = out_dir.join(final_name);

    // Create concat list file
    let mut list_file = NamedTempFile::new().map_err(|e| e.to_string())?;
    for f in &files {
        let p = std::path::Path::new(f);
        if !p.exists() {
            return Err(format!("Input does not exist: {}", f));
        }
        // FFmpeg concat demuxer expects lines like: file 'path'
        // Use single quotes; this file is parsed by FFmpeg, not the OS shell.
        let line = format!("file '{}'\n", f.replace("'", "'\\''"));
        list_file
            .write_all(line.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let list_path = list_file.path().to_path_buf();

    // Run ffmpeg. Prefer re-encoding to MP3 for robustness across mixed inputs.
    let out_path_for_ffmpeg = out_path.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("ffmpeg")
            .args(["-y", "-f", "concat", "-safe", "0", "-i"])
            .arg(list_path.as_os_str())
            .args(["-vn", "-acodec", "libmp3lame", "-b:a", "320k"])
            .arg(out_path_for_ffmpeg.as_os_str())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not recognized") || stderr.contains("No such file or directory") {
            return Err(
                "ffmpeg not found. Please install FFmpeg and ensure it is on your PATH.".into(),
            );
        }
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(out_path.to_string_lossy().to_string())
}
