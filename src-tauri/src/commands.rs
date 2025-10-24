use std::collections::HashMap;
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
const ACE_DEFAULT_GUIDANCE: f64 = 0.99;
const ACE_DEFAULT_BPM: f64 = 120.0;
const ACE_WORKFLOW_FILENAME: &str = "audio_ace_step_1_t2a_instrumentals.json";
const LOFI_WORKFLOW_FILENAME: &str = "Lofi_Scene_Maker.json";
const VIDEO_MAKER_WORKFLOW_FILENAME: &str = "img_2_Vid.json";
const TEMPLATES_KEY: &str = "stableAudioTemplates";
const COMFY_SETTINGS_KEY: &str = "comfyuiSettings";
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8188";
const DEFAULT_AUTO_LAUNCH: bool = true;
const ALLOWED_LOFI_SEED_BEHAVIORS: &[&str] = &["fixed", "increment", "decrement", "randomize"];
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

#[cfg(windows)]
fn normalize_canonical_output(path: String) -> String {
    path.strip_prefix(r"\\?\")
        .map(|s| s.to_string())
        .unwrap_or(path)
}

#[cfg(not(windows))]
fn normalize_canonical_output(path: String) -> String {
    path
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

fn default_batch_size() -> i64 {
    1
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioPrompts {
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
    pub batch_size: i64,
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
    #[serde(default)]
    pub batch_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AceWorkflowPrompts {
    pub style_prompt: String,
    pub song_form: String,
    pub bpm: f64,
    pub guidance: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AceWorkflowPromptUpdate {
    pub style_prompt: String,
    pub song_form: String,
    #[serde(default)]
    pub bpm: Option<f64>,
    #[serde(default)]
    pub guidance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioTemplate {
    pub name: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
    #[serde(default = "default_batch_size")]
    pub batch_size: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StableAudioTemplatePayload {
    pub name: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seconds: f64,
    #[serde(default = "default_batch_size")]
    pub batch_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LofiScenePrompts {
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub seed: i64,
    pub seed_behavior: String,
    pub steps: f64,
    pub cfg: f64,
    pub batch_size: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LofiScenePromptUpdate {
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: Option<String>,
    #[serde(default)]
    pub file_name_prefix: Option<String>,
    #[serde(default)]
    pub seed: Option<i64>,
    #[serde(default)]
    pub seed_behavior: Option<String>,
    #[serde(default)]
    pub steps: Option<f64>,
    #[serde(default)]
    pub cfg: Option<f64>,
    #[serde(default)]
    pub batch_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMakerPrompts {
    pub prompt: String,
    pub negative_prompt: String,
    pub file_name_prefix: String,
    pub fps: f64,
    pub image_filename: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMakerPromptUpdate {
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: Option<String>,
    #[serde(default)]
    pub file_name_prefix: Option<String>,
    #[serde(default)]
    pub fps: Option<f64>,
    #[serde(default)]
    pub image_filename: Option<String>,
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

fn resolve_input_directory(settings: &ComfyUISettings) -> PathBuf {
    if let Some(ref working_dir) = settings
        .working_directory
        .as_ref()
        .and_then(|s| Some(s.trim().to_string()))
        .filter(|s| !s.is_empty())
    {
        return PathBuf::from(working_dir).join("input");
    }

    if let Some(ref output_dir) = settings
        .output_dir
        .as_ref()
        .and_then(|s| Some(s.trim().to_string()))
        .filter(|s| !s.is_empty())
    {
        let base = PathBuf::from(output_dir);
        if base.is_absolute() {
            if let Some(parent) = base.parent() {
                if parent.as_os_str().is_empty() {
                    return PathBuf::from("input");
                }
                return parent.join("input");
            }
            return PathBuf::from("input");
        }
        if let Some(parent) = base.parent() {
            if parent.as_os_str().is_empty() {
                return PathBuf::from("input");
            }
            return parent.to_path_buf().join("input");
        }
    }

    PathBuf::from("input")
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
            if let Some(video_items) = ui.get("video").and_then(Value::as_array) {
                for video in video_items {
                    if let Some(filename) = video.get("filename").and_then(Value::as_str) {
                        let subfolder =
                            video.get("subfolder").and_then(Value::as_str).unwrap_or("");
                        let kind = video
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

fn widget_input_names(node_type: &str) -> Option<&'static [&'static str]> {
    match node_type {
        "CLIPLoader" => Some(&["clip_name", "type", "clip"]),
        "CLIPTextEncode" => Some(&["text"]),
        "CheckpointLoaderSimple" => Some(&["ckpt_name"]),
        "EmptyLatentAudio" => Some(&["seconds", "batch_size"]),
        "EmptySD3LatentImage" => Some(&["width", "height", "batch_size"]),
        "KSampler" => Some(&[
            "seed",
            "seed_behavior",
            "steps",
            "cfg",
            "sampler_name",
            "scheduler",
            "denoise",
        ]),
        "LoraLoaderModelOnly" => Some(&["lora_name", "strength_model"]),
        "ModelSamplingAuraFlow" => Some(&["shift"]),
        "SaveAudio" => Some(&["filename_prefix"]),
        "SaveImage" => Some(&["filename_prefix"]),
        "UNETLoader" => Some(&["unet_name", "weight_dtype"]),
        "VAELoader" => Some(&["vae_name", "vae_type"]),
        _ => None,
    }
}

fn locate_ksampler_node_id(data: &Value) -> Result<i64, String> {
    data.get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?
        .iter()
        .find_map(|node| {
            if node.get("type").and_then(Value::as_str) == Some("KSampler") {
                node.get("id").and_then(Value::as_i64)
            } else {
                None
            }
        })
        .ok_or_else(|| "KSampler node not found in workflow".to_string())
}

fn extract_ksampler_settings(
    data: &Value,
    node_id: i64,
) -> Result<(i64, String, f64, f64), String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    let node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("Unable to locate KSampler node {}", node_id))?;
    let values = node
        .get("widgets_values")
        .and_then(Value::as_array)
        .ok_or_else(|| "KSampler node is missing widgets_values".to_string())?;

    let seed = values
        .get(0)
        .and_then(Value::as_i64)
        .or_else(|| values.get(0).and_then(Value::as_f64).map(|v| v as i64))
        .unwrap_or(0);
    let seed_behavior = values
        .get(1)
        .and_then(Value::as_str)
        .unwrap_or("fixed")
        .to_string();
    let steps = values
        .get(2)
        .and_then(Value::as_f64)
        .or_else(|| values.get(2).and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(20.0);
    let cfg = values
        .get(3)
        .and_then(Value::as_f64)
        .or_else(|| values.get(3).and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(2.5);

    Ok((seed, seed_behavior, steps, cfg))
}

fn set_ksampler_settings(
    data: &mut Value,
    node_id: i64,
    seed: i64,
    seed_behavior: &str,
    steps: f64,
    cfg: f64,
) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("Unable to locate KSampler node {}", node_id))?;

    let node_obj = node
        .as_object_mut()
        .ok_or_else(|| "KSampler node is not an object".to_string())?;
    let widgets_value = node_obj
        .entry("widgets_values".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let arr = widgets_value
        .as_array_mut()
        .ok_or_else(|| "KSampler widgets_values is not an array".to_string())?;

    while arr.len() < 7 {
        arr.push(Value::Null);
    }

    arr[0] = Value::Number(Number::from_i128(seed as i128).unwrap());
    arr[1] = Value::String(seed_behavior.to_string());
    arr[2] = Value::Number(
        Number::from_f64(steps).ok_or_else(|| "Invalid steps value provided".to_string())?,
    );
    arr[3] = Value::Number(
        Number::from_f64(cfg).ok_or_else(|| "Invalid cfg value provided".to_string())?,
    );

    Ok(())
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
    if matches!(node_type, "MarkdownNote" | "Note") {
        return Ok(None);
    }

    let mut prompt_node = Map::new();
    prompt_node.insert(
        "class_type".to_string(),
        Value::String(node_type.to_string()),
    );

    let mut inputs_map = Map::new();

    if let Some(inputs_value) = node_obj.get("inputs") {
        match inputs_value {
            Value::Object(inputs) => {
                for (key, value) in inputs {
                    let input_value =
                        if let Some(link_id) = value.get("link").and_then(Value::as_i64) {
                            if let Some((origin, index)) = link_map.get(&link_id) {
                                Value::Array(vec![
                                    Value::String(origin.to_string()),
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
            }
            Value::Array(items) => {
                for entry in items {
                    if let Some(name) = entry.get("name").and_then(Value::as_str) {
                        let input_value =
                            if let Some(link_id) = entry.get("link").and_then(Value::as_i64) {
                                if let Some((origin, index)) = link_map.get(&link_id) {
                                    Value::Array(vec![
                                        Value::String(origin.to_string()),
                                        Value::Number((*index).into()),
                                    ])
                                } else {
                                    Value::Null
                                }
                            } else if let Some(value) = entry.get("value") {
                                value.clone()
                            } else {
                                Value::Null
                            };
                        inputs_map.insert(name.to_string(), input_value);
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(widget_names) = widget_input_names(node_type) {
        if let Some(Value::Array(widget_values)) = node_obj.get("widgets_values") {
            for (index, name) in widget_names.iter().enumerate() {
                if let Some(value) = widget_values.get(index) {
                    inputs_map.insert(name.to_string(), value.clone());
                }
            }
        }
    }

    prompt_node.insert("inputs".to_string(), Value::Object(inputs_map.clone()));

    if let Some(widgets) = node_obj.get("widgets_values") {
        prompt_node.insert("widgets_values".to_string(), widgets.clone());
    }

    Ok(Some((node_id.to_string(), Value::Object(prompt_node))))
}

fn convert_workflow_to_prompt(workflow: &Value) -> Result<Map<String, Value>, String> {
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

fn locate_save_image_node(data: &Value) -> Result<i64, String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some("SaveImage"))
        .and_then(|node| node.get("id").and_then(Value::as_i64))
        .ok_or_else(|| "SaveImage node not found in workflow".to_string())
}

fn locate_empty_latent_image_node(data: &Value) -> Result<i64, String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;
    nodes
        .iter()
        .find(|node| node.get("type").and_then(Value::as_str) == Some("EmptySD3LatentImage"))
        .and_then(|node| node.get("id").and_then(Value::as_i64))
        .ok_or_else(|| "EmptySD3LatentImage node not found in workflow".to_string())
}

fn extract_latent_batch_size(data: &Value, node_id: i64) -> i64 {
    data.get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                if node.get("id").and_then(Value::as_i64) != Some(node_id) {
                    return None;
                }
                let index = match node.get("type").and_then(Value::as_str) {
                    Some("EmptyLatentAudio") => 1usize,
                    _ => 2usize,
                };
                node.get("widgets_values")
                    .and_then(|vals| {
                        if let Some(arr) = vals.as_array() {
                            arr.get(index).cloned()
                        } else {
                            None
                        }
                    })
                    .and_then(|value| {
                        value
                            .as_i64()
                            .or_else(|| value.as_f64().map(|v| v.round() as i64))
                    })
            })
        })
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn set_latent_batch_size(data: &mut Value, node_id: i64, batch_size: i64) -> Result<(), String> {
    if batch_size <= 0 {
        return Err("Batch size must be positive.".to_string());
    }

    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("Latent node {} not found in workflow", node_id))?;

    let node_type = node
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let obj = node
        .as_object_mut()
        .ok_or_else(|| format!("Latent node {} is not an object", node_id))?;

    let value = obj
        .entry("widgets_values".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));

    let index = match node_type.as_str() {
        "EmptyLatentAudio" => 1usize,
        _ => 2usize,
    };

    if !value.is_array() {
        let preserved = if let Value::Number(num) = value {
            Some(Value::Number(num.clone()))
        } else {
            None
        };
        *value = Value::Array(Vec::new());
        if let Some(first) = preserved {
            if let Value::Array(arr) = value {
                arr.push(first);
            }
        }
    }

    let arr = match value {
        Value::Array(arr) => arr,
        _ => unreachable!(),
    };

    while arr.len() < index + 1 {
        arr.push(Value::Null);
    }

    arr[index] = Value::Number(Number::from(batch_size));

    Ok(())
}

fn extract_save_image_prefix(data: &Value, node_id: i64) -> String {
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
        .unwrap_or_else(|| "LofiScene".to_string())
}

fn set_save_image_prefix(data: &mut Value, node_id: i64, prefix: &str) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let node = nodes
        .iter_mut()
        .find(|node| node.get("id").and_then(Value::as_i64) == Some(node_id))
        .ok_or_else(|| format!("SaveImage node {} not found in workflow", node_id))?;

    let obj = node
        .as_object_mut()
        .ok_or_else(|| format!("SaveImage node {} is not an object", node_id))?;

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

fn ace_workflow_path() -> PathBuf {
    project_root()
        .join("assets")
        .join("workflows")
        .join(ACE_WORKFLOW_FILENAME)
}

fn load_ace_workflow() -> Result<Value, String> {
    let path = ace_workflow_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", ACE_WORKFLOW_FILENAME, e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", ACE_WORKFLOW_FILENAME, e))
}

fn persist_ace_workflow(data: &Value) -> Result<(), String> {
    let path = ace_workflow_path();
    let payload = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize ACE workflow: {}", e))?;
    fs::write(&path, payload).map_err(|e| format!("Failed to write ACE workflow: {}", e))
}

fn lofi_workflow_path() -> PathBuf {
    project_root()
        .join("assets")
        .join("workflows")
        .join(LOFI_WORKFLOW_FILENAME)
}

fn load_lofi_workflow() -> Result<Value, String> {
    let path = lofi_workflow_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", LOFI_WORKFLOW_FILENAME, e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", LOFI_WORKFLOW_FILENAME, e))
}

fn persist_lofi_workflow(data: &Value) -> Result<(), String> {
    let path = lofi_workflow_path();
    let payload = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize Lofi workflow: {}", e))?;
    fs::write(&path, payload).map_err(|e| format!("Failed to write Lofi workflow: {}", e))
}

fn video_maker_workflow_path() -> PathBuf {
    project_root()
        .join("assets")
        .join("workflows")
        .join(VIDEO_MAKER_WORKFLOW_FILENAME)
}

fn load_video_maker_workflow() -> Result<Value, String> {
    let path = video_maker_workflow_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", VIDEO_MAKER_WORKFLOW_FILENAME, e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", VIDEO_MAKER_WORKFLOW_FILENAME, e))
}

fn persist_video_maker_workflow(data: &Value) -> Result<(), String> {
    let path = video_maker_workflow_path();
    let payload = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize Video Maker workflow: {}", e))?;
    fs::write(&path, payload).map_err(|e| format!("Failed to write Video Maker workflow: {}", e))
}

fn extract_video_maker_prompts(data: &Value) -> Result<VideoMakerPrompts, String> {
    let nodes = data
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let mut positive_prompt: Option<String> = None;
    let mut negative_prompt: Option<String> = None;
    let mut file_prefix: Option<String> = None;
    let mut fps: Option<f64> = None;
    let mut image_filename: Option<String> = None;

    for node in nodes {
        let node_type = node.get("type").and_then(Value::as_str).unwrap_or("");
        match node_type {
            "CLIPTextEncode" => {
                let title = node
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let values = node
                    .get("widgets_values")
                    .and_then(Value::as_array)
                    .and_then(|arr| arr.get(0))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                if title.contains("negative") {
                    if negative_prompt.is_none() {
                        negative_prompt = values;
                    }
                } else if positive_prompt.is_none() {
                    positive_prompt = values;
                }
            }
            "SaveVideo" => {
                if file_prefix.is_none() {
                    file_prefix = node
                        .get("widgets_values")
                        .and_then(Value::as_array)
                        .and_then(|arr| arr.get(0))
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                }
            }
            "CreateVideo" => {
                if fps.is_none() {
                    fps = node
                        .get("widgets_values")
                        .and_then(Value::as_array)
                        .and_then(|arr| arr.get(0))
                        .and_then(|value| {
                            if let Some(number) = value.as_f64() {
                                Some(number)
                            } else if let Some(int_val) = value.as_i64() {
                                Some(int_val as f64)
                            } else {
                                None
                            }
                        });
                }
            }
            "LoadImage" => {
                if image_filename.is_none() {
                    image_filename = node
                        .get("widgets_values")
                        .and_then(Value::as_array)
                        .and_then(|arr| arr.get(0))
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                }
            }
            _ => {}
        }
    }

    let prompt = positive_prompt
        .ok_or_else(|| "CLIPTextEncode positive prompt node not found in workflow".to_string())?;
    let negative = negative_prompt
        .ok_or_else(|| "CLIPTextEncode negative prompt node not found in workflow".to_string())?;
    let prefix = file_prefix.ok_or_else(|| "SaveVideo node not found in workflow".to_string())?;
    let fps_value = fps.ok_or_else(|| "CreateVideo node not found in workflow".to_string())?;
    let image_name =
        image_filename.ok_or_else(|| "LoadImage node not found in workflow".to_string())?;

    Ok(VideoMakerPrompts {
        prompt,
        negative_prompt: negative,
        file_name_prefix: prefix,
        fps: fps_value,
        image_filename: image_name,
    })
}

fn apply_video_maker_prompts(data: &mut Value, prompts: &VideoMakerPrompts) -> Result<(), String> {
    let nodes = data
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Workflow is missing a nodes array".to_string())?;

    let mut positive_count = 0usize;
    let mut negative_count = 0usize;
    let mut save_count = 0usize;
    let mut create_count = 0usize;
    let mut image_count = 0usize;

    let fps_number = Number::from_f64(prompts.fps)
        .ok_or_else(|| "FPS must be a finite positive number".to_string())?;

    for node in nodes.iter_mut() {
        let node_type = node.get("type").and_then(Value::as_str).unwrap_or("");
        match node_type {
            "CLIPTextEncode" => {
                let title = node
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let replacement = if title.contains("negative") {
                    negative_count += 1;
                    Value::String(prompts.negative_prompt.clone())
                } else {
                    positive_count += 1;
                    Value::String(prompts.prompt.clone())
                };
                let values = node
                    .get_mut("widgets_values")
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| "CLIPTextEncode node missing widgets_values".to_string())?;
                if values.is_empty() {
                    values.push(replacement);
                } else {
                    values[0] = replacement;
                }
            }
            "SaveVideo" => {
                save_count += 1;
                let values = node
                    .get_mut("widgets_values")
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| "SaveVideo node missing widgets_values".to_string())?;
                let replacement = Value::String(prompts.file_name_prefix.clone());
                if values.is_empty() {
                    values.push(replacement);
                } else {
                    values[0] = replacement;
                }
            }
            "CreateVideo" => {
                create_count += 1;
                let values = node
                    .get_mut("widgets_values")
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| "CreateVideo node missing widgets_values".to_string())?;
                let replacement = Value::Number(fps_number.clone());
                if values.is_empty() {
                    values.push(replacement);
                } else {
                    values[0] = replacement;
                }
            }
            "LoadImage" => {
                image_count += 1;
                let values = node
                    .get_mut("widgets_values")
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| "LoadImage node missing widgets_values".to_string())?;
                let replacement = Value::String(prompts.image_filename.clone());
                if values.is_empty() {
                    values.push(replacement);
                } else {
                    values[0] = replacement;
                }
            }
            _ => {}
        }
    }

    if positive_count == 0 {
        return Err("CLIPTextEncode positive prompt node not found in workflow".into());
    }
    if negative_count == 0 {
        return Err("CLIPTextEncode negative prompt node not found in workflow".into());
    }
    if save_count == 0 {
        return Err("SaveVideo node not found in workflow".into());
    }
    if create_count == 0 {
        return Err("CreateVideo node not found in workflow".into());
    }
    if image_count == 0 {
        return Err("LoadImage node not found in workflow".into());
    }

    Ok(())
}

fn locate_ace_text_node<'a>(data: &'a Value) -> Result<&'a Value, String> {
    data.get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find(|node| {
                node.get("type")
                    .and_then(Value::as_str)
                    .map(|value| value == "TextEncodeAceStepAudio")
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| "TextEncodeAceStepAudio node not found in workflow".to_string())
}

fn locate_ace_text_node_mut<'a>(data: &'a mut Value) -> Result<&'a mut Value, String> {
    data.get_mut("nodes")
        .and_then(Value::as_array_mut)
        .and_then(|nodes| {
            nodes.iter_mut().find(|node| {
                node.get("type")
                    .and_then(Value::as_str)
                    .map(|value| value == "TextEncodeAceStepAudio")
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| "TextEncodeAceStepAudio node not found in workflow".to_string())
}

fn locate_ace_latent_node_mut<'a>(data: &'a mut Value) -> Result<&'a mut Value, String> {
    data.get_mut("nodes")
        .and_then(Value::as_array_mut)
        .and_then(|nodes| {
            nodes.iter_mut().find(|node| {
                node.get("type")
                    .and_then(Value::as_str)
                    .map(|value| value == "EmptyAceStepLatentAudio")
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| "EmptyAceStepLatentAudio node not found in workflow".to_string())
}

fn extract_ace_prompts(data: &Value) -> Result<AceWorkflowPrompts, String> {
    let text_node = locate_ace_text_node(data)?;
    let style_prompt = text_node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|arr| arr.get(0))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_default();
    let song_form = text_node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|arr| arr.get(1))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_default();
    let guidance = text_node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|arr| arr.get(2))
        .and_then(Value::as_f64)
        .unwrap_or(ACE_DEFAULT_GUIDANCE);

    let bpm = data
        .get("nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| {
            nodes.iter().find_map(|node| {
                if node
                    .get("type")
                    .and_then(Value::as_str)
                    .map(|value| value == "EmptyAceStepLatentAudio")
                    .unwrap_or(false)
                {
                    node.get("widgets_values")
                        .and_then(Value::as_array)
                        .and_then(|arr| arr.get(0))
                        .and_then(Value::as_f64)
                } else {
                    None
                }
            })
        })
        .unwrap_or(ACE_DEFAULT_BPM);

    Ok(AceWorkflowPrompts {
        style_prompt,
        song_form,
        bpm,
        guidance,
    })
}

fn set_ace_text_fields(
    data: &mut Value,
    style_prompt: &str,
    song_form: &str,
    guidance: f64,
) -> Result<(), String> {
    let node = locate_ace_text_node_mut(data)?;
    let obj = node
        .as_object_mut()
        .ok_or_else(|| "Text node is not an object".to_string())?;
    let mut arr = match obj.get_mut("widgets_values") {
        Some(Value::Array(values)) => values.clone(),
        _ => Vec::new(),
    };
    if arr.len() < 3 {
        arr.resize(3, Value::Null);
    }
    arr[0] = Value::String(style_prompt.to_string());
    arr[1] = Value::String(song_form.to_string());
    let guidance_value = Number::from_f64(guidance)
        .or_else(|| Number::from_f64(ACE_DEFAULT_GUIDANCE))
        .ok_or_else(|| "Failed to encode guidance value".to_string())?;
    arr[2] = Value::Number(guidance_value);
    obj.insert("widgets_values".to_string(), Value::Array(arr));
    Ok(())
}

fn set_ace_bpm(data: &mut Value, bpm: f64) -> Result<(), String> {
    let node = locate_ace_latent_node_mut(data)?;
    let obj = node
        .as_object_mut()
        .ok_or_else(|| "Latent node is not an object".to_string())?;
    let mut arr = match obj.get_mut("widgets_values") {
        Some(Value::Array(values)) => values.clone(),
        _ => Vec::new(),
    };
    if arr.is_empty() {
        arr.push(Value::Null);
    }
    let bpm_value = Number::from_f64(bpm)
        .or_else(|| Number::from_f64(ACE_DEFAULT_BPM))
        .ok_or_else(|| "Failed to encode BPM value".to_string())?;
    arr[0] = Value::Number(bpm_value);
    obj.insert("widgets_values".to_string(), Value::Array(arr));
    Ok(())
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
        batch_size: extract_latent_batch_size(&data, latent_node),
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
    let current_batch_size = extract_latent_batch_size(&data, latent_node);

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
    let batch_size = match payload.batch_size {
        Some(value) if value > 0 => value,
        Some(_) => return Err("Batch size must be positive.".into()),
        None => current_batch_size,
    };

    set_prompt_text(&mut data, positive_id, &prompt)?;
    set_prompt_text(&mut data, negative_id, &negative)?;
    set_save_audio_prefix(&mut data, save_node, &prefix)?;
    set_latent_seconds(&mut data, latent_node, seconds)?;
    set_latent_batch_size(&mut data, latent_node, batch_size)?;
    persist_stable_audio_workflow(&data)?;

    Ok(StableAudioPrompts {
        prompt,
        negative_prompt: negative,
        file_name_prefix: prefix,
        seconds,
        batch_size,
    })
}

#[tauri::command]
pub fn get_lofi_scene_prompts() -> Result<LofiScenePrompts, String> {
    let data = load_lofi_workflow()?;
    let (positive_id, negative_id) = locate_stable_audio_nodes(&data)?;
    let save_node = locate_save_image_node(&data)?;
    let latent_node = locate_empty_latent_image_node(&data)?;
    let ksampler_id = locate_ksampler_node_id(&data)?;
    let (seed, behavior_raw, steps, cfg) = extract_ksampler_settings(&data, ksampler_id)?;
    let batch_size = extract_latent_batch_size(&data, latent_node);
    let normalized_behavior = {
        let lower = behavior_raw.to_lowercase();
        if ALLOWED_LOFI_SEED_BEHAVIORS.contains(&lower.as_str()) {
            lower
        } else {
            "fixed".to_string()
        }
    };
    Ok(LofiScenePrompts {
        prompt: extract_prompt_text(&data, positive_id),
        negative_prompt: extract_prompt_text(&data, negative_id),
        file_name_prefix: extract_save_image_prefix(&data, save_node),
        seed,
        seed_behavior: normalized_behavior,
        steps,
        cfg,
        batch_size,
    })
}

#[tauri::command]
pub fn update_lofi_scene_prompts(
    payload: LofiScenePromptUpdate,
) -> Result<LofiScenePrompts, String> {
    let mut data = load_lofi_workflow()?;
    let (positive_id, negative_id) = locate_stable_audio_nodes(&data)?;
    let save_node = locate_save_image_node(&data)?;
    let latent_node = locate_empty_latent_image_node(&data)?;
    let ksampler_id = locate_ksampler_node_id(&data)?;
    let (current_seed, current_behavior, current_steps, current_cfg) =
        extract_ksampler_settings(&data, ksampler_id)?;
    let current_batch_size = extract_latent_batch_size(&data, latent_node);

    let prompt = payload.prompt.trim().to_string();
    let negative = payload
        .negative_prompt
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| extract_prompt_text(&data, negative_id));
    let prefix = payload
        .file_name_prefix
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("LofiScene")
        .to_string();

    let seed = payload.seed.unwrap_or(current_seed);
    let behavior = payload
        .seed_behavior
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .filter(|value| ALLOWED_LOFI_SEED_BEHAVIORS.contains(&value.as_str()))
        .unwrap_or_else(|| {
            if ALLOWED_LOFI_SEED_BEHAVIORS.contains(&current_behavior.as_str()) {
                current_behavior.clone()
            } else {
                "fixed".to_string()
            }
        });
    let steps = payload
        .steps
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(current_steps);
    let cfg = payload
        .cfg
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(current_cfg);
    let batch_size = match payload.batch_size {
        Some(value) if value > 0 => value,
        Some(_) => return Err("Batch size must be positive.".into()),
        None => current_batch_size,
    };

    set_prompt_text(&mut data, positive_id, &prompt)?;
    set_prompt_text(&mut data, negative_id, &negative)?;
    set_save_image_prefix(&mut data, save_node, &prefix)?;
    set_ksampler_settings(&mut data, ksampler_id, seed, &behavior, steps, cfg)?;
    set_latent_batch_size(&mut data, latent_node, batch_size)?;
    persist_lofi_workflow(&data)?;

    Ok(LofiScenePrompts {
        prompt,
        negative_prompt: negative,
        file_name_prefix: prefix,
        seed,
        seed_behavior: behavior,
        steps,
        cfg,
        batch_size,
    })
}

#[tauri::command]
pub fn get_video_maker_prompts() -> Result<VideoMakerPrompts, String> {
    let data = load_video_maker_workflow()?;
    extract_video_maker_prompts(&data)
}

#[tauri::command]
pub fn update_video_maker_prompts(
    update: VideoMakerPromptUpdate,
) -> Result<VideoMakerPrompts, String> {
    let mut data = load_video_maker_workflow()?;
    let current = extract_video_maker_prompts(&data)?;

    let prompt = update.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt cannot be empty.".into());
    }

    let negative_prompt = update
        .negative_prompt
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or(current.negative_prompt);

    let file_name_prefix = update
        .file_name_prefix
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or(current.file_name_prefix);

    let fps = update.fps.unwrap_or(current.fps);
    if !fps.is_finite() || fps <= 0.0 {
        return Err("FPS must be a positive number.".into());
    }

    let image_filename = update
        .image_filename
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or(current.image_filename);

    let prompts = VideoMakerPrompts {
        prompt: prompt.to_string(),
        negative_prompt,
        file_name_prefix,
        fps,
        image_filename,
    };

    apply_video_maker_prompts(&mut data, &prompts)?;
    persist_video_maker_workflow(&data)?;

    Ok(prompts)
}

#[tauri::command]
pub fn upload_video_maker_image(
    app: AppHandle,
    source_path: String,
) -> Result<VideoMakerPrompts, String> {
    let trimmed = source_path.trim();
    if trimmed.is_empty() {
        return Err("Source path is required.".into());
    }

    let source = Path::new(trimmed);
    if !source.exists() || !source.is_file() {
        return Err(format!("Source file does not exist: {}", trimmed));
    }

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Uploaded file must have a valid filename.".to_string())?;

    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let input_dir = resolve_input_directory(&settings);
    fs::create_dir_all(&input_dir).map_err(|err| {
        format!(
            "Failed to create ComfyUI input directory {}: {}",
            input_dir.to_string_lossy(),
            err
        )
    })?;

    let mut stored_name = file_name.to_string();
    let mut target_path = input_dir.join(&stored_name);
    if target_path.exists() {
        let stem = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("input");
        let extension = source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        let mut counter = 1usize;
        loop {
            stored_name = if extension.is_empty() {
                format!("{}-{}", stem, counter)
            } else {
                format!("{}-{}.{}", stem, counter, extension)
            };
            target_path = input_dir.join(&stored_name);
            if !target_path.exists() {
                break;
            }
            counter += 1;
        }
    }

    fs::copy(source, &target_path).map_err(|err| {
        format!(
            "Failed to copy {} to {}: {}",
            source.to_string_lossy(),
            target_path.to_string_lossy(),
            err
        )
    })?;

    let mut data = load_video_maker_workflow()?;
    let mut prompts = extract_video_maker_prompts(&data)?;
    prompts.image_filename = stored_name;
    apply_video_maker_prompts(&mut data, &prompts)?;
    persist_video_maker_workflow(&data)?;

    Ok(prompts)
}

#[tauri::command]
pub fn get_ace_workflow_prompts() -> Result<AceWorkflowPrompts, String> {
    let data = load_ace_workflow()?;
    extract_ace_prompts(&data)
}

#[tauri::command]
pub fn update_ace_workflow_prompts(
    update: AceWorkflowPromptUpdate,
) -> Result<AceWorkflowPrompts, String> {
    let mut data = load_ace_workflow()?;

    let style_prompt = update.style_prompt.trim();
    if style_prompt.is_empty() {
        return Err("Style prompt cannot be empty.".into());
    }

    let cleaned_form = update
        .song_form
        .replace("\r\n", "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if cleaned_form.trim().is_empty() {
        return Err("Song form cannot be empty.".into());
    }

    let mut bpm = update.bpm.unwrap_or(ACE_DEFAULT_BPM);
    if !bpm.is_finite() || bpm <= 0.0 {
        bpm = ACE_DEFAULT_BPM;
    } else if bpm > 400.0 {
        bpm = 400.0;
    }

    let mut guidance = update.guidance.unwrap_or(ACE_DEFAULT_GUIDANCE);
    if !guidance.is_finite() {
        guidance = ACE_DEFAULT_GUIDANCE;
    }
    if guidance < 0.05 {
        guidance = 0.05;
    } else if guidance > 2.0 {
        guidance = 2.0;
    }

    set_ace_text_fields(&mut data, style_prompt, &cleaned_form, guidance)?;
    set_ace_bpm(&mut data, bpm)?;
    persist_ace_workflow(&data)?;

    Ok(AceWorkflowPrompts {
        style_prompt: style_prompt.to_string(),
        song_form: cleaned_form,
        bpm,
        guidance,
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
    let batch_size = if template.batch_size > 0 {
        template.batch_size
    } else {
        default_batch_size()
    };

    let new_template = StableAudioTemplate {
        name: name.to_string(),
        prompt: prompt.to_string(),
        negative_prompt: negative.to_string(),
        file_name_prefix: prefix,
        seconds,
        batch_size,
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
pub async fn comfyui_submit_video_maker(app: AppHandle) -> Result<ComfyUISubmitResponse, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let workflow = load_video_maker_workflow()?;
    let prompt_map = convert_workflow_to_prompt(&workflow)?;
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
pub async fn comfyui_submit_stable_audio(app: AppHandle) -> Result<ComfyUISubmitResponse, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let workflow = load_stable_audio_workflow()?;
    let prompt_map = convert_workflow_to_prompt(&workflow)?;
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
pub async fn comfyui_submit_lofi_scene(app: AppHandle) -> Result<ComfyUISubmitResponse, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let workflow = load_lofi_workflow()?;
    let prompt_map = convert_workflow_to_prompt(&workflow)?;
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
pub async fn comfyui_submit_ace_audio(app: AppHandle) -> Result<ComfyUISubmitResponse, String> {
    let store = settings_store(&app)?;
    let mut settings = load_comfyui_settings_from_store(store.as_ref());
    if ensure_settings_defaults(&mut settings) {
        persist_comfyui_settings(store.as_ref(), &settings)?;
    }

    let workflow = load_ace_workflow()?;
    let prompt_map = convert_workflow_to_prompt(&workflow)?;
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

        let rename_one = |src: &str, target_name: String| -> Result<String, String> {
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
    let path_buf = PathBuf::from(&path);
    match path_buf.canonicalize() {
        Ok(canonical) => fs::read(canonical).map_err(|e| e.to_string()),
        Err(_) => fs::read(&path_buf).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn canonicalize_path(path: String) -> Result<String, String> {
    let candidate = PathBuf::from(&path);
    candidate
        .canonicalize()
        .map(|canonical| {
            let rendered = canonical.to_string_lossy().to_string();
            normalize_canonical_output(rendered)
        })
        .map_err(|e| e.to_string())
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
