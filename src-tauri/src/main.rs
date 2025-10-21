#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{BufRead, BufReader, ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use serde_yaml::{Mapping as YamlMapping, Value as YamlValue};
use tauri::path::BaseDirectory;
use tauri::Emitter;
use tauri::Manager;
use tauri::{async_runtime, AppHandle, Runtime, State};
use tauri::{PhysicalPosition, PhysicalSize, Position, Size};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::init as fs_init;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::init as shell_init;
use tauri_plugin_store::{Builder, Store, StoreBuilder};
use tokio::time::sleep;
use url::Url;
use uuid::Uuid;
use walkdir::WalkDir;
mod commands;
mod config;
mod dnd_watcher;
mod musiclang;
mod util;
use crate::commands::{album_concat, generate_musicgen, musicgen_env, riffusion_generate};
use crate::util::list_from_dir;

fn dreadhaven_root() -> PathBuf {
    config::ensure_default_vault();
    PathBuf::from(config::DEFAULT_DREADHAVEN_ROOT)
}

fn default_greeting_path() -> String {
    project_root()
        .join("assets")
        .join("scripted_sounds")
        .join("Discord_Recorded _Greeting.wav")
        .to_string_lossy()
        .to_string()
}

const DISCORD_BOT_LOG_CAP: usize = 2000;

static DISCORD_BOT_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static DISCORD_BOT_LOGS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static DISCORD_BOT_EXIT: OnceLock<Mutex<Option<i32>>> = OnceLock::new();
// Controls whether the bot should be kept alive (auto-restarted) in background
static DISCORD_BOT_KEEPALIVE: OnceLock<Mutex<bool>> = OnceLock::new();

// Discord transcription listener (Whisper pipeline)
static DISCORD_LISTEN_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static DISCORD_LISTEN_LOGS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static DISCORD_LISTEN_EXIT: OnceLock<Mutex<Option<i32>>> = OnceLock::new();

static NPC_REPAIR_RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

const NPC_REPAIR_EVENT_NAME: &str = "repair::npc-progress";

fn discord_bot_store() -> &'static Mutex<Option<Child>> {
    DISCORD_BOT_CHILD.get_or_init(|| Mutex::new(None))
}

fn discord_bot_logs() -> &'static Mutex<Vec<String>> {
    DISCORD_BOT_LOGS.get_or_init(|| Mutex::new(Vec::new()))
}

fn discord_bot_exit_code() -> &'static Mutex<Option<i32>> {
    DISCORD_BOT_EXIT.get_or_init(|| Mutex::new(None))
}

fn discord_bot_keepalive() -> &'static Mutex<bool> {
    DISCORD_BOT_KEEPALIVE.get_or_init(|| Mutex::new(false))
}

fn attach_discord_bot_loggers(child: &mut Child, app: &AppHandle) {
    if let Some(out) = child.stdout.take() {
        let app_for_thread = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        {
                            let mut logs = discord_bot_logs().lock().unwrap();
                            logs.push(l.clone());
                            if logs.len() > DISCORD_BOT_LOG_CAP {
                                let drop = logs.len() - DISCORD_BOT_LOG_CAP;
                                logs.drain(0..drop);
                            }
                        }
                        let _ = app_for_thread.emit(
                            "discord::bot_log",
                            json!({"line": l.clone(), "stream": "stdout"}),
                        );
                        if let Ok(val) = serde_json::from_str::<Value>(&l) {
                            if let Some(obj) = val.get("discord_act") {
                                let _ = app_for_thread.emit("discord::act", obj.clone());
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let app_for_thread = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        {
                            let mut logs = discord_bot_logs().lock().unwrap();
                            logs.push(l.clone());
                            if logs.len() > DISCORD_BOT_LOG_CAP {
                                let drop = logs.len() - DISCORD_BOT_LOG_CAP;
                                logs.drain(0..drop);
                            }
                        }
                        let _ = app_for_thread
                            .emit("discord::bot_log", json!({"line": l, "stream": "stderr"}));
                    }
                    Err(_) => break,
                }
            }
        });
    }
}

fn discord_listen_store() -> &'static Mutex<Option<Child>> {
    DISCORD_LISTEN_CHILD.get_or_init(|| Mutex::new(None))
}

fn discord_listen_logs() -> &'static Mutex<Vec<String>> {
    DISCORD_LISTEN_LOGS.get_or_init(|| Mutex::new(Vec::new()))
}

fn discord_listen_exit_code() -> &'static Mutex<Option<i32>> {
    DISCORD_LISTEN_EXIT.get_or_init(|| Mutex::new(None))
}

fn discord_settings_path() -> std::path::PathBuf {
    project_root().join("config").join("discord_accounts.json")
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiscordSettings {
    #[serde(default)]
    current_token: Option<String>,
    #[serde(default)]
    tokens: std::collections::HashMap<String, String>,
    #[serde(default)]
    current_guild: Option<String>,
    #[serde(default)]
    guilds: std::collections::HashMap<String, u64>,
    #[serde(default = "default_self_deaf")]
    self_deaf: bool,
}

fn default_self_deaf() -> bool {
    true
}

impl Default for DiscordSettings {
    fn default() -> Self {
        DiscordSettings {
            current_token: None,
            tokens: std::collections::HashMap::new(),
            current_guild: None,
            guilds: std::collections::HashMap::new(),
            self_deaf: true,
        }
    }
}

fn read_discord_settings() -> DiscordSettings {
    let path = discord_settings_path();
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<DiscordSettings>(&text) {
            return cfg;
        }
    }
    DiscordSettings::default()
}

fn write_discord_settings(settings: &DiscordSettings) -> Result<(), String> {
    let path = discord_settings_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

fn write_discord_control(
    self_deaf: bool,
    greeting_path: Option<&str>,
    greeting_volume: Option<f32>,
) -> Result<(), String> {
    let path = project_root().join("data").join("discord_control.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let stamp = Utc::now();
    let mut map = Map::new();
    map.insert("self_deaf".into(), Value::Bool(self_deaf));
    map.insert(
        "nonce".into(),
        Value::String(format!(
            "self-deaf-{}-{}",
            self_deaf,
            stamp.timestamp_millis()
        )),
    );
    map.insert("updated_at".into(), Value::String(stamp.to_rfc3339()));
    if let Some(path) = greeting_path {
        if !path.trim().is_empty() {
            map.insert(
                "greeting_path".into(),
                Value::String(path.trim().to_string()),
            );
        }
    }
    if let Some(vol) = greeting_volume {
        map.insert("greeting_volume".into(), Value::from(vol));
    }
    let payload = Value::Object(map);
    let body = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

#[tauri::command]
fn discord_settings_get() -> Result<DiscordSettings, String> {
    Ok(read_discord_settings())
}

#[tauri::command]
fn get_dreadhaven_root() -> String {
    config::ensure_default_vault();
    config::DEFAULT_DREADHAVEN_ROOT.to_string()
}

#[tauri::command]
fn discord_token_add(name: String, token: String) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    s.tokens.insert(name.clone(), token);
    if s.current_token.is_none() {
        s.current_token = Some(name);
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_token_remove(name: String) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    let cur = s.current_token.clone();
    s.tokens.remove(&name);
    if cur.as_deref() == Some(&name) {
        s.current_token = s.tokens.keys().next().cloned();
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_token_select(name: String) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    if s.tokens.contains_key(&name) {
        s.current_token = Some(name);
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_guild_add(name: String, id: u64) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    s.guilds.insert(name.clone(), id);
    if s.current_guild.is_none() {
        s.current_guild = Some(name);
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_guild_remove(name: String) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    let cur = s.current_guild.clone();
    s.guilds.remove(&name);
    if cur.as_deref() == Some(&name) {
        s.current_guild = s.guilds.keys().next().cloned();
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_guild_select(name: String) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    if s.guilds.contains_key(&name) {
        s.current_guild = Some(name);
    }
    write_discord_settings(&s)?;
    Ok(s)
}

#[tauri::command]
fn discord_set_self_deaf(value: bool) -> Result<DiscordSettings, String> {
    let mut s = read_discord_settings();
    s.self_deaf = value;
    write_discord_settings(&s)?;
    let greeting_path = std::env::var("DISCORD_GREETING_PATH")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default_greeting_path());
    let greeting_volume = std::env::var("DISCORD_GREETING_VOLUME")
        .ok()
        .and_then(|v| v.parse::<f32>().ok())
        .unwrap_or(1.0);
    write_discord_control(value, Some(&greeting_path), Some(greeting_volume))?;
    Ok(s)
}

#[derive(Serialize)]
struct TokenSource {
    source: String,
    length: usize,
    path: String,
}

#[tauri::command]
fn discord_detect_token_sources() -> Result<Vec<TokenSource>, String> {
    let mut out: Vec<TokenSource> = Vec::new();
    // config/discord_token.txt
    let token_file = project_root().join("config").join("discord_token.txt");
    if let Ok(text) = std::fs::read_to_string(&token_file) {
        let t = text.trim().to_string();
        if !t.is_empty() {
            out.push(TokenSource {
                source: "discord_token.txt".into(),
                length: t.len(),
                path: token_file.to_string_lossy().to_string(),
            });
        }
    }
    // secrets.json at repo root
    let secrets = project_root().join("secrets.json");
    if let Ok(text) = std::fs::read_to_string(&secrets) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(tok) = val
                .get("discord")
                .and_then(|d| d.get("botToken"))
                .and_then(|v| v.as_str())
            {
                let tok = tok.trim();
                if !tok.is_empty() {
                    out.push(TokenSource {
                        source: "secrets.json".into(),
                        length: tok.len(),
                        path: secrets.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn discord_listen_status() -> Result<String, String> {
    let running = discord_listen_store().lock().unwrap().is_some();
    Ok(if running {
        "running".into()
    } else {
        "stopped".into()
    })
}

#[tauri::command]
fn discord_listen_stop() -> Result<(), String> {
    let mut guard = discord_listen_store().lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *discord_listen_exit_code().lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
fn discord_listen_start(app: AppHandle, channel_id: u64) -> Result<u32, String> {
    // Stop prior listener if any
    {
        let mut g = discord_listen_store().lock().unwrap();
        if let Some(mut child) = g.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // Select Whisper model
    let model = models_store::<tauri::Wry>(&app)
        .and_then(|s| {
            Ok(s.get("whisper")
                .and_then(|v| v.as_str().map(|s| s.to_string())))
        })
        .unwrap_or(None)
        .unwrap_or_else(|| "small".into());

    // Build Python snippet which runs ears.pipeline.run_bot and prints JSON lines for segments
    let code = format!(
        r#"
import os, asyncio, json, sys
from ears.pipeline import run_bot

MODEL = {model:?}
CHANNEL = {channel}

async def emit_segment(part, speaker):
    try:
        obj = {{
            "text": part.text,
            "is_final": bool(getattr(part, 'is_final', False)),
            "speaker": speaker or "",
            "timestamp": float(getattr(part, 'start', 0.0)),
            "language": getattr(part, 'language', '') or '',
            "confidence": float(getattr(part, 'confidence', 0.0)),
        }}
        sys.stdout.write(json.dumps({{"whisper": obj}}) + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stdout.write(json.dumps({{"whisper_error": str(e)}}) + "\n"); sys.stdout.flush()

async def on_part(part, speaker):
    await emit_segment(part, speaker)

async def main():
    await run_bot(None, CHANNEL, model_path=MODEL, part_callback=on_part, rate_limit=0.25)

asyncio.run(main())
"#,
        model = model,
        channel = channel_id
    );

    let mut cmd = python_command();
    // Inject selected Discord token (from UI settings) so the listener can authenticate
    {
        let settings = read_discord_settings();
        if let Some(name) = settings.current_token.as_ref() {
            if let Some(tok) = settings.tokens.get(name) {
                cmd.env("DISCORD_TOKEN", tok);
            }
        }
    }
    // Ensure relative imports resolve
    cmd.current_dir(project_root())
        .env("PYTHONPATH", project_root())
        .args(["-c", &code])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *discord_listen_exit_code().lock().unwrap() = None;
    {
        let app_for_thread = app.clone();
        let logs_arc = discord_listen_logs();
        tauri::async_runtime::spawn(async move {
            // Stdout reader
            if let Some(out) = stdout {
                let reader = std::io::BufReader::new(out);
                for line in reader.lines().flatten() {
                    // Store raw logs
                    {
                        let mut logs = logs_arc.lock().unwrap();
                        logs.push(line.clone());
                        if logs.len() > 1000 {
                            let drain = logs.len() - 1000;
                            logs.drain(0..drain);
                        }
                    }
                    // Try to parse JSON whisper event
                    if let Ok(val) = serde_json::from_str::<Value>(&line) {
                        if let Some(obj) = val.get("whisper") {
                            let _ = app_for_thread.emit("whisper::segment", obj.clone());
                        } else if let Some(err) = val.get("whisper_error") {
                            let _ = app_for_thread.emit("whisper::error", err.clone());
                        }
                    }
                }
            }
        });
    }
    {
        let logs_arc = discord_listen_logs();
        tauri::async_runtime::spawn(async move {
            if let Some(err) = stderr {
                for line in std::io::BufReader::new(err).lines().flatten() {
                    let tagged = format!("[stderr] {}", line);
                    let mut logs = logs_arc.lock().unwrap();
                    logs.push(tagged.clone());
                    if logs.len() > 1000 {
                        let drain = logs.len() - 1000;
                        logs.drain(0..drain);
                    }
                    // Emit stderr lines to the UI for debugging
                    let _ = app.emit("whisper::stderr", json!({"line": tagged}));
                }
            }
        });
    }

    *discord_listen_store().lock().unwrap() = Some(child);
    Ok(pid)
}

#[tauri::command]
fn discord_bot_start(app: tauri::AppHandle) -> Result<u32, String> {
    // If already running, stop it first
    {
        let mut guard = discord_bot_store().lock().unwrap();
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
            *guard = None;
        }
    }

    // reset logs/exit
    {
        let mut logs = discord_bot_logs().lock().unwrap();
        logs.clear();
    }
    {
        let mut exitc = discord_bot_exit_code().lock().unwrap();
        *exitc = None;
    }

    // spawn for logs capture, injecting selected token/guild
    let spawn_once = || -> Result<Child, String> {
        let mut cmd = python_command();
        // Load selected token/guild from settings
        let settings = read_discord_settings();
        if let Some(name) = settings.current_token.as_ref() {
            if let Some(tok) = settings.tokens.get(name) {
                cmd.env("DISCORD_TOKEN", tok);
            }
        }
        if let Some(name) = settings.current_guild.as_ref() {
            if let Some(gid) = settings.guilds.get(name) {
                cmd.env("DISCORD_GUILD_ID", gid.to_string());
            }
        }
        let greeting_path = std::env::var("DISCORD_GREETING_PATH")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| default_greeting_path());
        let greeting_volume = std::env::var("DISCORD_GREETING_VOLUME")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(1.0);
        if let Err(err) = write_discord_control(
            settings.self_deaf,
            Some(&greeting_path),
            Some(greeting_volume),
        ) {
            eprintln!("failed to write discord control file: {}", err);
        }
        println!(
            "[discord-tauri] Launching bot: self_deaf={} greeting_path={} volume={:.2}",
            settings.self_deaf, greeting_path, greeting_volume
        );
        cmd.env(
            "DISCORD_SELF_DEAF",
            if settings.self_deaf { "1" } else { "0" },
        )
        .env("DISCORD_GREETING_PATH", &greeting_path)
        .env("DISCORD_GREETING_VOLUME", greeting_volume.to_string());
        cmd.arg("discord_bot.py")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.spawn().map_err(|e| e.to_string())
    };

    // Enable keepalive so bot stays running
    {
        let mut ka = discord_bot_keepalive().lock().unwrap();
        *ka = true;
    }

    let mut log_child = spawn_once()?;
    attach_discord_bot_loggers(&mut log_child, &app);
    // store child handle
    let pid = log_child.id();
    let mut guard = discord_bot_store().lock().unwrap();
    *guard = Some(log_child);
    // quick exit check
    std::thread::sleep(std::time::Duration::from_millis(800));
    if let Some(c) = guard.as_mut() {
        if let Ok(Some(status)) = c.try_wait() {
            let code = status.code().unwrap_or(-1);
            let logs = discord_bot_logs().lock().unwrap();
            let tail: Vec<String> = logs
                .iter()
                .rev()
                .take(12)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let joined = tail.join("\n");
            return Err(format!(
                "Discord bot exited immediately (code {}). Logs:\n{}",
                code, joined
            ));
        }
    }

    // Spawn a watcher thread that auto-restarts the bot if it exits unexpectedly
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let app_handle = app_handle;
            loop {
                // Poll until the current child exits, without holding the lock while waiting
                let mut code_opt: Option<i32> = None;
                loop {
                    let still_running = {
                        let mut guard = discord_bot_store().lock().unwrap();
                        if let Some(child) = guard.as_mut() {
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    code_opt = status.code();
                                    false
                                }
                                Ok(None) => true,
                                Err(_) => {
                                    code_opt = Some(-1);
                                    false
                                }
                            }
                        } else {
                            // No child to watch
                            break;
                        }
                    };
                    if !still_running {
                        break;
                    }
                    // Allow stop() or app shutdown to proceed
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    // If keepalive disabled during wait and process still running, just continue polling;
                    // stop() will kill the process and the next loop will observe exit.
                }
                {
                    let mut exitc = discord_bot_exit_code().lock().unwrap();
                    *exitc = code_opt;
                }
                // Check keepalive flag
                let keepalive = { *discord_bot_keepalive().lock().unwrap() };
                if !keepalive {
                    // Do not restart; ensure store is cleared and exit watcher
                    let mut guard = discord_bot_store().lock().unwrap();
                    *guard = None;
                    break;
                }
                // Attempt restart after a short delay
                std::thread::sleep(std::time::Duration::from_millis(1200));
                match (|| -> Result<(), String> {
                    let mut child = spawn_once()?;
                    attach_discord_bot_loggers(&mut child, &app_handle);
                    let mut guard = discord_bot_store().lock().unwrap();
                    *guard = Some(child);
                    Ok(())
                })() {
                    Ok(()) => {}
                    Err(_) => {
                        // Could not restart; clear store and exit
                        let mut guard = discord_bot_store().lock().unwrap();
                        *guard = None;
                        break;
                    }
                }
            }
        });
    }
    Ok(pid)
}

#[tauri::command]
fn discord_bot_stop() -> Result<(), String> {
    // Disable keepalive so watcher will not auto-restart
    {
        let mut ka = discord_bot_keepalive().lock().unwrap();
        *ka = false;
    }
    let mut guard = discord_bot_store().lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[derive(Serialize)]
struct DiscordBotStatus {
    running: bool,
    pid: Option<u32>,
    exit_code: Option<i32>,
}

#[tauri::command]
fn discord_bot_status() -> Result<DiscordBotStatus, String> {
    let mut running = false;
    let mut pid = None;
    {
        let mut guard = discord_bot_store().lock().unwrap();
        if let Some(child) = guard.as_mut() {
            pid = Some(child.id());
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                running = true;
            }
        }
    }
    let code = { *discord_bot_exit_code().lock().unwrap() };
    Ok(DiscordBotStatus {
        running,
        pid,
        exit_code: code,
    })
}

#[tauri::command]
fn discord_bot_logs_tail(lines: Option<usize>) -> Result<Vec<String>, String> {
    let count = lines
        .unwrap_or(DISCORD_BOT_LOG_CAP)
        .min(DISCORD_BOT_LOG_CAP);
    let logs = discord_bot_logs().lock().unwrap();
    let n = logs.len();
    let start = n.saturating_sub(count);
    Ok(logs[start..].to_vec())
}

fn strip_code_fence(s: &str) -> &str {
    let mut trimmed = s.trim();
    if !trimmed.starts_with("```") {
        return trimmed;
    }

    trimmed = &trimmed[3..];

    if let Some(without_close) = trimmed.strip_suffix("```") {
        trimmed = without_close;
    }

    trimmed = trimmed.trim_matches(|c| c == '\r' || c == '\n');

    if let Some(idx) = trimmed.find('\n') {
        let (first_line, remainder) = trimmed.split_at(idx + 1);
        let first_line_trimmed = first_line.trim_matches(|c| c == '\r' || c == '\n');
        let remainder_trimmed = remainder.trim_start_matches(|c| c == '\r' || c == '\n');
        let remainder_head = remainder_trimmed.trim_start();
        let remainder_is_markdown = remainder_head.starts_with("---")
            || remainder_head.starts_with('#')
            || remainder_head.starts_with('*')
            || remainder_head.starts_with('-')
            || remainder_head.starts_with('>')
            || remainder_head.starts_with('[')
            || remainder_head.starts_with('!')
            || remainder_head
                .chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false);
        let first_line_looks_like_lang = !first_line_trimmed.is_empty()
            && first_line_trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric());

        if first_line_trimmed.is_empty()
            || (first_line_looks_like_lang
                && (remainder_trimmed.is_empty() || remainder_is_markdown))
        {
            return remainder_trimmed.trim();
        }
    }

    trimmed.trim()
}

#[cfg(test)]
mod tests {
    use super::{add_establishment_metadata, merge_player_template, strip_code_fence};

    #[test]
    fn preserves_plain_text() {
        assert_eq!(strip_code_fence("  Hello world  "), "Hello world");
    }

    #[test]
    fn strips_markdown_fence_with_language() {
        let input = "```markdown\n---\nTitle: Example\n```\n";
        assert_eq!(strip_code_fence(input), "---\nTitle: Example");
    }

    #[test]
    fn strips_basic_fence() {
        let input = "```\n# Heading\n```";
        assert_eq!(strip_code_fence(input), "# Heading");
    }

    #[test]
    fn player_template_inserts_sheet() {
        let template = "---\nTitle: {{NAME}}\nClass: {{CLASS}}\n---\n\n{{PLAYER_SHEET}}\n";
        let replacements = vec![
            ("NAME".to_string(), "Lyra".to_string()),
            ("CLASS".to_string(), "Wizard".to_string()),
        ];
        let sheet = "# Lyra Dawn\n\n## Notes\nArcane prodigy.";
        let merged = merge_player_template(template, sheet, &replacements);
        assert!(merged.contains("Title: Lyra"));
        assert!(merged.contains("Class: Wizard"));
        assert!(merged.contains("# Lyra Dawn"));
    }

    #[test]
    fn player_template_appends_when_placeholder_missing() {
        let template = "# Heading\n";
        let replacements = vec![];
        let sheet = "## Details\nAdventurer.";
        let merged = merge_player_template(template, sheet, &replacements);
        assert!(merged.contains("# Heading"));
        assert!(merged.contains("## Details"));
    }

    #[test]
    fn adds_establishment_metadata_to_plain_markdown() {
        let input = "# Adventurer";
        let result =
            add_establishment_metadata(input, Some("World/Shop.md"), Some("The Gilded Griffin"));
        assert!(result.starts_with("---\n"));
        assert!(result.contains("establishment_path: \"World/Shop.md\""));
        assert!(result.contains("establishment_name: \"The Gilded Griffin\""));
        assert!(result.contains("# Adventurer"));
    }

    #[test]
    fn updates_existing_frontmatter_with_establishment_metadata() {
        let input = "---\nTitle: Shopkeep\n---\nNotes";
        let result =
            add_establishment_metadata(input, Some("World/Shop.md"), Some("Gilded Griffin"));
        assert!(result.contains("Title: Shopkeep"));
        assert!(result.contains("establishment_path: \"World/Shop.md\""));
        assert!(result.contains("establishment_name: \"Gilded Griffin\""));
    }
}

#[derive(Debug, Clone, Deserialize)]
struct TagSectionConfig {
    id: String,
    label: String,
    #[serde(rename = "relativePath")]
    relative_path: String,
    #[allow(dead_code)]
    prompt: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    includes: Vec<String>,
    #[serde(default)]
    fallbacks: Vec<String>,
}

fn tag_sections() -> &'static [TagSectionConfig] {
    static SECTIONS: OnceLock<Vec<TagSectionConfig>> = OnceLock::new();
    SECTIONS
        .get_or_init(|| {
            let raw = include_str!("../../ui/src/lib/dndTagSections.json");
            serde_json::from_str(raw).expect("invalid dnd tag section metadata")
        })
        .as_slice()
}

fn tag_section_map() -> &'static HashMap<String, TagSectionConfig> {
    static MAP: OnceLock<HashMap<String, TagSectionConfig>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut out = HashMap::new();
        for section in tag_sections() {
            out.insert(section.id.clone(), section.clone());
        }
        out
    })
}

fn join_relative_folder(base: &Path, subfolder: &str) -> PathBuf {
    let mut path = PathBuf::from(base);
    for segment in subfolder.split(['/', '\\']) {
        let trimmed = segment.trim();
        if !trimmed.is_empty() {
            path.push(trimmed);
        }
    }
    path
}

fn clamp_text(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out = String::with_capacity(max_chars + 1);
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_chars {
            out.push('\u{2026}');
            break;
        }
        out.push(ch);
    }
    out
}

fn relative_display(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn parse_frontmatter(text: &str) -> Result<(YamlMapping, String, String), String> {
    static FRONTMATTER_RE: OnceLock<Regex> = OnceLock::new();
    let re = FRONTMATTER_RE.get_or_init(|| {
        Regex::new(r"(?s)^\u{feff}?---\s*\r?\n(.*?)\r?\n---\s*\r?\n?")
            .expect("invalid frontmatter regex")
    });
    if let Some(caps) = re.captures(text) {
        let full = caps.get(0).unwrap();
        let yaml_src = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let value: YamlValue = serde_yaml::from_str(yaml_src)
            .map_err(|err| format!("failed to parse YAML frontmatter: {}", err))?;
        let mapping = match value {
            YamlValue::Mapping(map) => map,
            _ => YamlMapping::new(),
        };
        let body = text[full.end()..].to_string();
        Ok((mapping, body, yaml_src.to_string()))
    } else {
        Ok((YamlMapping::new(), text.to_string(), String::new()))
    }
}

fn serialize_frontmatter(mapping: &YamlMapping) -> Result<String, String> {
    let mut yaml = serde_yaml::to_string(mapping).map_err(|e| e.to_string())?;
    if yaml.ends_with("\n...") {
        let new_len = yaml.len() - 4;
        yaml.truncate(new_len);
        if !yaml.ends_with('\n') {
            yaml.push('\n');
        }
    }
    if !yaml.ends_with('\n') {
        yaml.push('\n');
    }
    Ok(yaml)
}

fn upsert_frontmatter_string(mapping: &mut YamlMapping, key: &str, value: Option<&str>) {
    let key_value = YamlValue::String(key.to_string());
    if let Some(v) = value {
        mapping.insert(key_value, YamlValue::String(v.to_string()));
    } else {
        mapping.remove(&key_value);
    }
}

fn add_establishment_metadata(content: &str, path: Option<&str>, name: Option<&str>) -> String {
    if path.is_none() && name.is_none() {
        return content.to_string();
    }
    match parse_frontmatter(content) {
        Ok((mut mapping, body, _raw)) => {
            upsert_frontmatter_string(&mut mapping, "establishment_path", path);
            upsert_frontmatter_string(&mut mapping, "establishment_name", name);
            match serialize_frontmatter(&mapping) {
                Ok(frontmatter_src) => {
                    let mut out = String::with_capacity(content.len() + frontmatter_src.len() + 16);
                    out.push_str("---\n");
                    out.push_str(&frontmatter_src);
                    out.push_str("---\n");
                    out.push_str(&body);
                    out
                }
                Err(err) => {
                    eprintln!(
                        "[blossom] npc_create: failed to serialize frontmatter with establishment metadata: {}",
                        err
                    );
                    content.to_string()
                }
            }
        }
        Err(err) => {
            eprintln!(
                "[blossom] npc_create: failed to parse frontmatter for establishment metadata: {}",
                err
            );
            content.to_string()
        }
    }
}

fn extract_tags(mapping: &YamlMapping) -> Vec<String> {
    let key = YamlValue::String("tags".to_string());
    let mut tags = Vec::new();
    if let Some(value) = mapping.get(&key) {
        match value {
            YamlValue::Sequence(seq) => {
                for item in seq {
                    match item {
                        YamlValue::String(s) => tags.push(s.clone()),
                        other => {
                            let maybe_tag = match other {
                                YamlValue::Bool(_) | YamlValue::Number(_) => {
                                    match serde_yaml::to_string(other) {
                                        Ok(serialized) => {
                                            let trimmed = serialized.trim();
                                            let trimmed = trimmed
                                                .strip_prefix("---")
                                                .map(|rest| rest.trim_start())
                                                .unwrap_or(trimmed);
                                            let trimmed = trimmed
                                                .strip_suffix("...")
                                                .map(|rest| rest.trim_end())
                                                .unwrap_or(trimmed);
                                            if trimmed.is_empty() {
                                                None
                                            } else if trimmed.contains('\n') {
                                                eprintln!(
                                                    "[blossom] extract_tags: skipping non-string tag value: {:?}",
                                                    other
                                                );
                                                None
                                            } else {
                                                Some(trimmed.to_string())
                                            }
                                        }
                                        Err(err) => {
                                            eprintln!(
                                                "[blossom] extract_tags: failed to serialize tag value {:?}: {}",
                                                other, err
                                            );
                                            None
                                        }
                                    }
                                }
                                YamlValue::Null => {
                                    eprintln!("[blossom] extract_tags: skipping null tag value");
                                    None
                                }
                                _ => {
                                    eprintln!(
                                        "[blossom] extract_tags: skipping unsupported tag value: {:?}",
                                        other
                                    );
                                    None
                                }
                            };
                            if let Some(tag) = maybe_tag {
                                tags.push(tag);
                            }
                        }
                    }
                }
            }
            YamlValue::String(s) => tags.push(s.clone()),
            _ => {}
        }
    }
    tags
}

fn normalize_tag(tag: &str) -> Option<String> {
    let trimmed = tag.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut out = String::new();
    let mut last_dash = false;
    for ch in trimmed.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            last_dash = false;
        } else if matches!(lower, '-' | '_' | ' ' | '/' | '\\' | '&') {
            if !last_dash && !out.is_empty() {
                out.push('-');
                last_dash = true;
            }
        } else {
            if !last_dash && !out.is_empty() {
                out.push('-');
                last_dash = true;
            }
        }
    }
    let normalized = out.trim_matches('-').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for tag in tags {
        if let Some(normalized) = normalize_tag(tag) {
            if seen.insert(normalized.clone()) {
                out.push(normalized);
            }
        }
    }
    out
}

fn parse_model_tags(response: &str) -> Result<Vec<String>, String> {
    let cleaned = strip_code_fence(response).trim();
    if cleaned.is_empty() {
        return Err("model returned an empty response".into());
    }
    if let Ok(tags) = serde_json::from_str::<Vec<String>>(cleaned) {
        return Ok(tags);
    }
    if let (Some(start), Some(end)) = (cleaned.find('['), cleaned.rfind(']')) {
        if end > start {
            let slice = &cleaned[start..=end];
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(slice) {
                return Ok(tags);
            }
        }
    }
    Err("model response was not valid JSON".into())
}

#[derive(Serialize)]
struct TagUpdateSummary {
    section: String,
    label: String,
    base_path: String,
    total_notes: usize,
    updated_notes: usize,
    skipped_notes: usize,
    failed_notes: usize,
    duration_ms: u64,
}

#[derive(Serialize, Clone)]
struct TagUpdateEvent {
    section: String,
    label: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rel_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failed: Option<usize>,
}

fn emit_tag_event(app: &AppHandle, payload: TagUpdateEvent) {
    if let Err(err) = app.emit("tag-update::progress", payload) {
        eprintln!("failed to emit tag update event: {}", err);
    }
}

fn persistence_enabled() -> bool {
    env::var("BLOSSOM_DISABLE_PERSIST").ok().as_deref() != Some("1")
}

#[tauri::command]
async fn generate_llm(
    prompt: String,
    system: Option<String>,
    temperature: Option<f64>,
    seed: Option<i64>,
) -> Result<String, String> {
    eprintln!(
        "[llm] generate_llm: prompt_len={}, system_present={}",
        prompt.len(),
        system
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
    );
    if let Some(temp) = temperature {
        eprintln!("[llm] temperature={:.3}", temp);
    }
    if let Some(seed_val) = seed {
        eprintln!("[llm] seed={}", seed_val);
    }
    let preview = prompt
        .chars()
        .take(160)
        .collect::<String>()
        .replace('\n', " ");
    eprintln!("[llm] prompt_preview: {}", preview);
    async_runtime::spawn_blocking(move || -> Result<String, String> {
        // Use the Python helper which streams from Ollama and concatenates the result
        let mut cmd = python_command();
        // Safely embed the prompt as a Python string literal
        let prompt_literal =
            serde_json::to_string(&prompt).unwrap_or_else(|_| format!("{:?}", prompt));
        let system_literal = system
            .as_ref()
            .and_then(|s| serde_json::to_string(s).ok())
            .unwrap_or_else(|| "null".to_string());
        let temperature_literal =
            serde_json::to_string(&temperature).unwrap_or_else(|_| "null".to_string());
        let seed_literal = serde_json::to_string(&seed).unwrap_or_else(|_| "null".to_string());
        let py = format!(
            r#"import os, json, requests, sys
url = "http://localhost:11434/api/generate"
model = os.getenv("LLM_MODEL", os.getenv("OLLAMA_MODEL", "mistral"))
payload = {{"model": model, "prompt": {prompt}, "stream": False}}
system = {system}
if isinstance(system, str) and system.strip():
    payload["system"] = system
temperature = {temperature}
seed = {seed}
options = payload.get("options") or {{}}
if temperature is not None:
    try:
        options["temperature"] = float(temperature)
    except (TypeError, ValueError):
        pass
if seed is not None:
    try:
        options["seed"] = int(seed)
    except (TypeError, ValueError):
        pass
if options:
    payload["options"] = options
try:
    resp = requests.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    text = data.get("response", "")
    if not isinstance(text, str):
        text = str(text)
    # Write UTF-8 bytes directly to avoid Windows console encoding issues
    sys.stdout.buffer.write(text.encode("utf-8", errors="ignore"))
    sys.stdout.flush()
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"#,
            prompt = prompt_literal,
            system = system_literal,
            temperature = temperature_literal,
            seed = seed_literal,
        );
        let output = cmd
            .env("PYTHONIOENCODING", "utf-8")
            .arg("-c")
            .arg(py)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        let out = String::from_utf8_lossy(&output.stdout).to_string();
        eprintln!(
            "[llm] response_len={} preview='{}'",
            out.len(),
            out.chars().take(120).collect::<String>().replace('\n', " ")
        );
        Ok(out)
    })
    .await
    .map_err(|e| format!("Failed to join blocking task: {}", e))?
}

fn looks_like_project_root(dir: &Path) -> bool {
    [
        "pyproject.toml",
        "package.json",
        "requirements.txt",
        "blossom.py",
    ]
    .iter()
    .any(|marker| dir.join(marker).exists())
}

fn find_project_root() -> Option<PathBuf> {
    if let Ok(mut dir) = env::current_dir() {
        loop {
            if looks_like_project_root(&dir) {
                return Some(dir);
            }
            if !dir.pop() {
                break;
            }
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if looks_like_project_root(&manifest_dir) {
        return Some(manifest_dir);
    }
    if let Some(parent) = manifest_dir.parent() {
        let candidate = parent.to_path_buf();
        if looks_like_project_root(&candidate) {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn project_root() -> PathBuf {
    static ROOT: OnceLock<PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        let candidate = find_project_root().unwrap_or_else(|| PathBuf::from("."));
        candidate.canonicalize().unwrap_or(candidate)
    })
    .clone()
}

fn configure_python_command(cmd: &mut Command) {
    let root = project_root();
    cmd.current_dir(&root);
    // Ensure unbuffered I/O so logs stream promptly to the UI
    cmd.env("PYTHONUNBUFFERED", "1");
    // Optional debug: print Python working directory and PYTHONPATH
    if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
        eprintln!("[blossom] python cwd: {}", root.to_string_lossy());
    }
    let mut pythonpath = root.clone().into_os_string();
    if let Some(existing) = env::var_os("PYTHONPATH") {
        if !existing.is_empty() {
            pythonpath.push(if cfg!(target_os = "windows") {
                ";"
            } else {
                ":"
            });
            pythonpath.push(existing);
        }
    }
    // Capture a debug copy before moving into env
    let pythonpath_dbg = pythonpath.to_string_lossy().to_string();
    cmd.env("PYTHONPATH", pythonpath);
    // Map deprecated TRANSFORMERS_CACHE to HF_HOME to silence deprecation warning
    if let Ok(cache) = env::var("TRANSFORMERS_CACHE") {
        if !cache.trim().is_empty() {
            cmd.env("HF_HOME", cache);
        }
        // Remove deprecated var to avoid deprecation warning downstream
        cmd.env_remove("TRANSFORMERS_CACHE");
    }
    if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
        eprintln!("[blossom] PYTHONPATH: {}", pythonpath_dbg);
    }
}

#[tauri::command]
fn write_discord_token(token: String) -> Result<(), String> {
    let root = project_root();
    let dir = root.join("config");
    if let Err(e) = fs::create_dir_all(&dir) {
        // Continue if directory exists or cannot be created; file write may still succeed when dir exists.
        if e.kind() != ErrorKind::AlreadyExists {
            return Err(e.to_string());
        }
    }
    let path = dir.join("discord_token.txt");
    fs::write(&path, token).map_err(|e| e.to_string())?;
    // Best-effort set read-only; ignore errors on platforms that disallow it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o444));
    }
    Ok(())
}

pub(crate) fn python_command() -> Command {
    // Resolution priority:
    // 1) BLOSSOM_PY (explicit override)
    // 2) VIRTUAL_ENV python (active venv)
    // 2b) Project-local .venv under repo root
    // 3) Windows: py -3.10 -u (explicit 3.10)
    // 4) Fallback: python -u
    if let Ok(custom) = env::var("BLOSSOM_PY") {
        let mut cmd = Command::new(custom);
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using BLOSSOM_PY interpreter");
        }
        return cmd;
    }

    if let Ok(venv) = env::var("VIRTUAL_ENV") {
        #[cfg(target_os = "windows")]
        let python_path = PathBuf::from(&venv).join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let python_path = PathBuf::from(&venv).join("bin").join("python");
        let mut cmd = Command::new(python_path);
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using VIRTUAL_ENV interpreter");
        }
        return cmd;
    }

    // Project-local .venv fallback
    let root = project_root();
    #[cfg(target_os = "windows")]
    let local_python = root.join(".venv").join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let local_python = root.join(".venv").join("bin").join("python");
    if local_python.exists() {
        let mut cmd = Command::new(local_python);
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using project-local .venv interpreter");
        }
        return cmd;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("py");
        cmd.arg("-3.10").arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using Windows py launcher for Python 3.10");
        }
        return cmd;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("python");
        cmd.arg("-u");
        configure_python_command(&mut cmd);
        if env::var("BLOSSOM_DEBUG").ok().as_deref() == Some("1") {
            eprintln!("[blossom] using system 'python' interpreter");
        }
        return cmd;
    }
}

#[tauri::command]
fn resolve_resource(app: AppHandle, path: String) -> Result<String, String> {
    use std::path::PathBuf;

    fn normalize_path_string(p: &Path) -> Result<String, String> {
        let mut s = p.to_string_lossy().to_string();
        if s.starts_with(r"\\?\") {
            s = s.trim_start_matches(r"\\?\").to_string();
        }
        Ok(s)
    }

    let input = PathBuf::from(&path);
    if input.is_absolute() && input.exists() {
        return normalize_path_string(&input);
    }

    // Prefer project-root relative paths in dev
    let root = project_root();
    let candidates = [root.join(&path), root.join("src-tauri").join(&path)];
    for c in &candidates {
        if c.exists() {
            return normalize_path_string(c);
        }
    }

    // Fallback to resource resolution (prod bundles)
    if let Ok(resolved) = app.path().resolve(&path, BaseDirectory::Resource) {
        if resolved.exists() {
            return normalize_path_string(&resolved);
        }
        // Return the resolved string even if it doesn't exist, as a last resort
        return normalize_path_string(&resolved);
    }

    Err(format!("Unable to resolve resource path: {}", path))
}

#[tauri::command]
fn list_bundled_voices(app: AppHandle) -> Result<Value, String> {
    // Candidate roots for voices in dev/prod
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app
        .path()
        .resolve("assets/voice_models", BaseDirectory::Resource)
    {
        roots.push(res);
    }
    let proj = project_root();
    roots.push(proj.join("assets/voice_models"));
    roots.push(proj.join("src-tauri").join("assets/voice_models"));
    // Also support alternate capitalizations or separate folder names
    roots.push(proj.join("assets/Voice_Models"));
    roots.push(proj.join("src-tauri").join("assets/Voice_Models"));
    roots.push(proj.join("Voice_Models"));

    // Deduplicate and keep only existing dirs
    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| p.exists() && seen.insert(p.canonicalize().unwrap_or(p.clone())));

    let mut items = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    for base in roots {
        for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            // Find model/config filenames
            let mut model_file = None::<String>;
            let mut config_file = None::<String>;
            for f in fs::read_dir(&path).map_err(|e| e.to_string())? {
                let f = f.map_err(|e| e.to_string())?;
                if !f.file_type().map_err(|e| e.to_string())?.is_file() {
                    continue;
                }
                if let Some(name) = f.file_name().to_str() {
                    let lower = name.to_lowercase();
                    if model_file.is_none() && lower.ends_with(".onnx") {
                        model_file = Some(name.to_string());
                    }
                    if config_file.is_none() && lower.ends_with(".onnx.json") {
                        config_file = Some(name.to_string());
                    }
                }
            }
            let (model_file, config_file) = match (model_file, config_file) {
                (Some(m), Some(c)) => (m, c),
                _ => continue,
            };
            // Build a relative resource path when possible, otherwise absolute path
            let rel_prefix = "assets/voice_models";
            let model_path = if path.starts_with(rel_prefix) {
                format!("{}/{}/{}", rel_prefix, id, model_file)
            } else if let Some(pos) = path.to_string_lossy().find(rel_prefix) {
                let suffix = &path.to_string_lossy()[pos + rel_prefix.len() + 1..];
                format!("{}/{}/{}", rel_prefix, suffix, model_file)
            } else {
                path.join(&model_file).to_string_lossy().to_string()
            };
            let config_path = if path.starts_with(rel_prefix) {
                format!("{}/{}/{}", rel_prefix, id, config_file)
            } else if let Some(pos) = path.to_string_lossy().find(rel_prefix) {
                let suffix = &path.to_string_lossy()[pos + rel_prefix.len() + 1..];
                format!("{}/{}/{}", rel_prefix, suffix, config_file)
            } else {
                path.join(&config_file).to_string_lossy().to_string()
            };

            // Attempt to read language/speaker from the config
            let mut lang: Option<String> = None;
            let mut speaker: Option<Value> = None;
            // Read config using absolute path if relative resolution fails
            let text =
                if let Ok(cfg_abs) = app.path().resolve(&config_path, BaseDirectory::Resource) {
                    fs::read_to_string(cfg_abs)
                } else {
                    fs::read_to_string(path.join(&config_file))
                };
            if let Ok(text) = text {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    if let Some(espeak) = val.get("espeak") {
                        if let Some(v) = espeak.get("voice").and_then(|v| v.as_str()) {
                            lang = Some(v.to_string());
                        }
                    }
                    if lang.is_none() {
                        if let Some(l) = val.get("language").and_then(|v| v.as_str()) {
                            lang = Some(l.to_string());
                        }
                    }
                    if let Some(s) = val.get("default_speaker") {
                        speaker = Some(s.clone());
                    }
                }
            }

            // Build a friendly label and a dedup key based on model metadata
            let mut label: Option<String> = None;
            let mut dedup_key: Option<String> = None;
            if let Ok(text) = fs::read_to_string(&path.join(&config_file)) {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    let dataset = val
                        .get("dataset")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let quality = val
                        .get("audio")
                        .and_then(|a| a.get("quality"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let lang_code = val
                        .get("language")
                        .and_then(|l| l.get("code"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            val.get("language")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        });
                    if let Some(ds) = dataset.clone() {
                        let mut name = ds[..1].to_uppercase();
                        name.push_str(&ds[1..]);
                        if let Some(q) = quality.clone() {
                            let q_title = {
                                let mut qq = q.clone();
                                if !qq.is_empty() {
                                    qq.replace_range(0..1, &qq[0..1].to_uppercase());
                                }
                                qq
                            };
                            name = format!("{} ({})", name, q_title);
                        }
                        if let Some(lc) = lang_code.clone() {
                            name = format!("{} [{}]", name, lc);
                        }
                        label = Some(name);
                    }
                    // Create a metadata-based dedup key if possible
                    if let Some(ds) = dataset {
                        let q = quality.unwrap_or_else(|| "".into());
                        let lc = lang_code.unwrap_or_else(|| "".into());
                        dedup_key = Some(format!(
                            "{}|{}|{}",
                            ds.to_lowercase(),
                            q.to_lowercase(),
                            lc.to_lowercase()
                        ));
                    }
                }
            }

            // Deduplicate across different folder IDs by using metadata-based key when available,
            // falling back to a normalized id (underscores/hyphens treated the same).
            let norm_id = id.to_lowercase().replace('-', "_");

            let mut obj = serde_json::Map::new();
            obj.insert("id".into(), Value::String(id.clone()));
            obj.insert("modelPath".into(), Value::String(model_path));
            obj.insert("configPath".into(), Value::String(config_path));
            if let Some(l) = lang {
                obj.insert("lang".into(), Value::String(l));
            }
            if let Some(s) = speaker {
                obj.insert("speaker".into(), s);
            }
            if let Some(lbl) = label {
                obj.insert("label".into(), Value::String(lbl));
            }
            let key = dedup_key.clone().unwrap_or(norm_id);
            if seen_keys.insert(key) {
                items.push(Value::Object(obj));
            }
        }
    }
    // Sort by id for stable UI
    items.sort_by(|a, b| {
        a["id"]
            .as_str()
            .unwrap_or("")
            .cmp(b["id"].as_str().unwrap_or(""))
    });
    Ok(Value::Array(items))
}

const NPC_ID_ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
const NPC_ID_SHORT_LEN: usize = 4;
const NPC_ID_PREFIX: &str = "npc";
const NPC_ID_SLUG_MAX_LEN: usize = 24;
static NPC_ID_REGEX: OnceLock<Regex> = OnceLock::new();

fn npc_id_regex() -> &'static Regex {
    NPC_ID_REGEX.get_or_init(|| {
        Regex::new(r"^npc_[a-z0-9-]{1,24}_[a-z0-9]{4}$").expect("valid npc id regex")
    })
}

fn is_valid_npc_id(id: &str) -> bool {
    npc_id_regex().is_match(id)
}

fn npc_slug(name: &str) -> String {
    let base = name.trim().to_ascii_lowercase();
    if base.is_empty() {
        return "entity".to_string();
    }
    let mut replaced = String::with_capacity(base.len());
    for ch in base.chars() {
        match ch {
            'a'..='z' | '0'..='9' => replaced.push(ch),
            '-' => replaced.push('-'),
            ' ' | '_' => replaced.push('-'),
            _ => replaced.push('-'),
        }
    }
    let mut collapsed = String::with_capacity(replaced.len());
    let mut prev_dash = false;
    for ch in replaced.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push('-');
                prev_dash = true;
            }
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }
    let mut slug = collapsed.trim_matches('-').to_string();
    if slug.is_empty() {
        slug = "entity".to_string();
    }
    if slug.len() > NPC_ID_SLUG_MAX_LEN {
        slug.truncate(NPC_ID_SLUG_MAX_LEN);
        while slug.ends_with('-') {
            slug.pop();
        }
        if slug.is_empty() {
            slug = "entity".to_string();
        }
    }
    slug
}

fn make_short_id(len: usize) -> String {
    if len == 0 {
        return String::new();
    }
    let mut out = String::with_capacity(len);
    let mut pool: Vec<u8> = Vec::new();
    while out.len() < len {
        if pool.is_empty() {
            pool.extend_from_slice(Uuid::new_v4().as_bytes());
        }
        if let Some(byte) = pool.pop() {
            let idx = (byte as usize) % NPC_ID_ALPHABET.len();
            out.push(NPC_ID_ALPHABET[idx] as char);
        }
    }
    out
}

fn generate_unique_npc_id(name: &str, existing: &mut HashSet<String>) -> String {
    let slug = npc_slug(name);
    for _ in 0..5 {
        let candidate = format!(
            "{prefix}_{slug}_{short}",
            prefix = NPC_ID_PREFIX,
            slug = slug,
            short = make_short_id(NPC_ID_SHORT_LEN)
        );
        if existing.insert(candidate.clone()) {
            return candidate;
        }
    }
    loop {
        let candidate = format!(
            "{prefix}_{slug}_{short}",
            prefix = NPC_ID_PREFIX,
            slug = slug,
            short = make_short_id(NPC_ID_SHORT_LEN + 4)
        );
        if existing.insert(candidate.clone()) {
            return candidate;
        }
    }
}

fn normalize_npc_id(
    candidate: Option<String>,
    name: &str,
    existing: &mut HashSet<String>,
) -> (String, bool) {
    if let Some(raw) = candidate {
        let trimmed = raw.trim().to_string();
        if is_valid_npc_id(&trimmed) && !existing.contains(&trimmed) {
            existing.insert(trimmed.clone());
            return (trimmed, false);
        }
    }
    let generated = generate_unique_npc_id(name, existing);
    (generated, true)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct Npc {
    id: String,
    name: String,
    description: String,
    prompt: String,
    voice: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct StoredNpc {
    #[serde(default)]
    id: Option<String>,
    name: String,
    description: String,
    prompt: String,
    voice: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct LoreItem {
    path: String,
    title: String,
    summary: String,
    content: String,
    tags: Vec<String>,
    aliases: Vec<String>,
    fields: Map<String, Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct PiperProfile {
    name: String,
    voice_id: String,
    tags: Vec<String>,
}

fn read_npcs(app: &AppHandle) -> Result<Vec<Npc>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("npcs.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stored = serde_json::from_str::<Vec<StoredNpc>>(&text).map_err(|e| e.to_string())?;
    let mut existing_ids: HashSet<String> = HashSet::new();
    let mut changed = false;
    let mut npcs: Vec<Npc> = Vec::with_capacity(stored.len());
    for entry in stored {
        let (id, generated) = normalize_npc_id(entry.id, &entry.name, &mut existing_ids);
        if generated {
            changed = true;
        }
        npcs.push(Npc {
            id,
            name: entry.name,
            description: entry.description,
            prompt: entry.prompt,
            voice: entry.voice,
        });
    }
    if changed {
        let _ = write_npcs(app, &npcs);
    }
    Ok(npcs)
}

#[tauri::command]
fn discord_listen_logs_tail(lines: Option<usize>) -> Result<Vec<String>, String> {
    let count = lines.unwrap_or(100).min(1000);
    let logs = discord_listen_logs().lock().unwrap();
    let n = logs.len();
    if n == 0 {
        return Ok(Vec::new());
    }
    let start = if n > count { n - count } else { 0 };
    Ok(logs[start..].to_vec())
}

fn write_npcs(app: &AppHandle, npcs: &[Npc]) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("npcs.json");
    let text = serde_json::to_string_pretty(npcs).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

fn normalize_npc_display_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let normalized = trimmed.replace('\\', "/");
    let candidate = normalized.rsplit('/').next().unwrap_or(trimmed);
    if let Some(idx) = candidate.rfind('.') {
        if idx > 0 {
            return candidate[..idx].to_string();
        }
    }
    candidate.to_string()
}

fn filesystem_npc_names(_app: &AppHandle) -> Result<Vec<String>, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let base = dreadhaven_root();
    let joined = join_relative_folder(&base, "20_DM/NPC");
    if !candidates.iter().any(|p| p == &joined) {
        candidates.push(joined);
    }

    if let Some(section) = tag_section_map().get("npcs") {
        for fallback in &section.fallbacks {
            let path = PathBuf::from(fallback);
            if !candidates.iter().any(|p| p == &path) {
                candidates.push(path);
            }
        }
    } else {
        let default = PathBuf::from(r"D:\\Documents\\DreadHaven\\20_DM\\NPC");
        if !candidates.iter().any(|p| p == &default) {
            candidates.push(default);
        }
    }

    let mut names: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for dir in candidates {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase());
            if !matches!(ext.as_deref(), Some("md" | "markdown" | "mdx")) {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            let display = normalize_npc_display_name(file_name);
            if display.is_empty() {
                continue;
            }
            let key = display.to_ascii_lowercase();
            if seen.insert(key) {
                names.push(display);
            }
        }
    }
    names.sort_by(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()));
    Ok(names)
}

#[tauri::command]
fn npc_list(app: AppHandle) -> Result<Vec<Npc>, String> {
    let mut npcs = read_npcs(&app)?;
    let mut seen: HashSet<String> = npcs
        .iter()
        .map(|npc| npc.name.to_ascii_lowercase())
        .collect();
    let mut existing_ids: HashSet<String> = npcs.iter().map(|npc| npc.id.clone()).collect();

    let mut service_had_entries = false;
    let mut cmd = python_command();
    if let Ok(output) = cmd
        .args([
            "-c",
            "import json, service_api; print(json.dumps(service_api.list_npcs()))",
        ])
        .output()
    {
        if output.status.success() {
            if let Ok(notes) = serde_json::from_slice::<Vec<Value>>(&output.stdout) {
                service_had_entries = !notes.is_empty();
                for note in notes {
                    let alias_name = note
                        .get("aliases")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.get(0))
                        .and_then(|v| v.as_str())
                        .map(normalize_npc_display_name)
                        .filter(|s| !s.is_empty());
                    let path_name = note
                        .get("path")
                        .and_then(|v| v.as_str())
                        .map(normalize_npc_display_name)
                        .filter(|s| !s.is_empty());
                    if let Some(name) = alias_name.or(path_name) {
                        let key = name.to_ascii_lowercase();
                        if seen.insert(key) {
                            let fields = note.get("fields").and_then(|v| v.as_object());
                            let description = fields
                                .and_then(|f| f.get("description"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let prompt = fields
                                .and_then(|f| f.get("prompt"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let voice = fields
                                .and_then(|f| f.get("voice"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let candidate_id = note
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| {
                                    note.get("npcId")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                })
                                .or_else(|| {
                                    fields
                                        .and_then(|f| f.get("id"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                })
                                .or_else(|| {
                                    fields
                                        .and_then(|f| f.get("npcId"))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                });
                            let (id, _) = normalize_npc_id(candidate_id, &name, &mut existing_ids);
                            npcs.push(Npc {
                                id,
                                name,
                                description,
                                prompt,
                                voice,
                            });
                        }
                    }
                }
            }
        }
    }

    if !service_had_entries {
        match filesystem_npc_names(&app) {
            Ok(fallback_names) => {
                for name in fallback_names {
                    let key = name.to_ascii_lowercase();
                    if seen.insert(key) {
                        let (id, _) = normalize_npc_id(None, &name, &mut existing_ids);
                        npcs.push(Npc {
                            id,
                            name,
                            description: String::new(),
                            prompt: String::new(),
                            voice: String::new(),
                        });
                    }
                }
            }
            Err(err) => {
                eprintln!("[blossom] npc_list: fallback scan failed: {}", err);
            }
        }
    }

    Ok(npcs)
}

#[tauri::command]
fn lore_list() -> Result<Vec<LoreItem>, String> {
    let mut cmd = python_command();
    let output = cmd
        .args([
            "-c",
            "import json, service_api; print(json.dumps(service_api.list_lore()))",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let notes = serde_json::from_slice::<Vec<Value>>(&output.stdout).map_err(|e| e.to_string())?;

    let mut lore_items = Vec::new();
    for note in notes {
        let path = note
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let title = note
            .get("title")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                note.get("aliases")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.get(0))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| {
                Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&path)
                    .to_string()
            });
        let summary = note
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let content = note
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let tags = note
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let aliases = note
            .get("aliases")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|value| value.as_str().map(|s| s.to_string()))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let fields = note
            .get("fields")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_else(Map::new);

        lore_items.push(LoreItem {
            path,
            title,
            summary,
            content,
            tags,
            aliases,
            fields,
        });
    }

    Ok(lore_items)
}

#[tauri::command]
fn dnd_chat_message(message: String) -> Result<String, String> {
    let mut cmd = python_command();
    let message_literal =
        serde_json::to_string(&message).unwrap_or_else(|_| format!("{:?}", message));
    let script = format!(
        r#"import sys
from brain import dnd_chat
try:
    sys.stdout.write(dnd_chat.chat({message}))
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)
"#,
        message = message_literal,
    );
    let output = cmd
        .arg("-c")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn npc_save(app: AppHandle, mut npc: Npc) -> Result<(), String> {
    let mut npcs = read_npcs(&app)?;
    let trimmed_id = npc.id.trim().to_string();
    if !trimmed_id.is_empty() {
        if let Some(existing) = npcs.iter_mut().find(|n| n.id == trimmed_id) {
            npc.id = trimmed_id;
            *existing = npc;
            return write_npcs(&app, &npcs);
        }
    }
    if let Some(existing) = npcs.iter_mut().find(|n| n.name == npc.name) {
        npc.id = existing.id.clone();
        *existing = npc;
        return write_npcs(&app, &npcs);
    }
    let mut existing_ids: HashSet<String> = npcs.iter().map(|n| n.id.clone()).collect();
    let candidate = if trimmed_id.is_empty() {
        None
    } else {
        Some(trimmed_id)
    };
    let (id, _) = normalize_npc_id(candidate, &npc.name, &mut existing_ids);
    npc.id = id;
    npcs.push(npc);
    write_npcs(&app, &npcs)
}

#[tauri::command]
fn npc_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut npcs = read_npcs(&app)?;
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let original_len = npcs.len();
    if is_valid_npc_id(trimmed) {
        npcs.retain(|n| n.id != trimmed);
    } else {
        npcs.retain(|n| n.name != trimmed);
    }
    if npcs.len() != original_len {
        write_npcs(&app, &npcs)
    } else {
        Ok(())
    }
}

#[derive(Serialize, Clone)]
struct NpcRepairProgressPayload {
    run_id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    npc_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<NpcRepairSummary>,
}

#[derive(Serialize, Clone)]
struct NpcRepairSummary {
    run_id: u64,
    total: usize,
    requested: Vec<String>,
    status_map: HashMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    verified: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    failed: Vec<String>,
    duration_ms: u64,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    errors: HashMap<String, String>,
}

#[derive(Serialize)]
struct NpcRepairLaunch {
    run_id: u64,
    requested: Vec<String>,
}

#[derive(Serialize)]
struct NpcRepairRequest {
    run_id: u64,
    npc_ids: Vec<String>,
}

fn emit_npc_repair_event(app: &AppHandle, payload: NpcRepairProgressPayload) {
    if let Err(err) = app.emit(NPC_REPAIR_EVENT_NAME, payload) {
        eprintln!("[npc_repair] failed to emit event: {}", err);
    }
}

fn normalize_repair_status_text(status: &str) -> &'static str {
    let normalized = status.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "verified" | "complete" | "completed" | "success" | "succeeded" | "done" => "verified",
        "error" | "failed" | "failure" | "invalid" | "broken" | "missing" => "error",
        "not_verified" | "unverified" | "idle" | "unknown" => "not_verified",
        "pending" | "running" | "processing" | "queued" | "in-progress" | "working" | "started"
        | "starting" => "pending",
        other => {
            if other.is_empty() {
                "not_verified"
            } else {
                "pending"
            }
        }
    }
}

fn extract_string_field(map: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn derive_repair_status(map: &Map<String, Value>) -> String {
    if map
        .get("verified")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return "verified".to_string();
    }
    if map
        .get("failed")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return "error".to_string();
    }
    if let Some(value) = map.get("error") {
        match value {
            Value::Bool(true) => return "error".to_string(),
            Value::String(text) if !text.trim().is_empty() => {
                return "error".to_string()
            }
            _ => {}
        }
    }
    if map
        .get("pending")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return "pending".to_string();
    }
    if let Some(value) = map.get("status").and_then(|value| value.as_str()) {
        return normalize_repair_status_text(value).to_string();
    }
    if let Some(value) = map.get("state").and_then(|value| value.as_str()) {
        return normalize_repair_status_text(value).to_string();
    }
    if let Some(value) = map.get("stage").and_then(|value| value.as_str()) {
        return normalize_repair_status_text(value).to_string();
    }
    if map
        .get("not_verified")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return "not_verified".to_string();
    }
    "pending".to_string()
}

fn extract_repair_error(map: &Map<String, Value>) -> Option<String> {
    if let Some(value) = map.get("error") {
        match value {
            Value::String(text) if !text.trim().is_empty() => {
                return Some(text.trim().to_string());
            }
            Value::Bool(true) => return Some("Repair failed".to_string()),
            _ => {}
        }
    }
    if let Some(value) = map.get("failure") {
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if value.as_bool().unwrap_or(false) {
            return Some("Repair failed".to_string());
        }
    }
    extract_string_field(
        map,
        &["errorMessage", "error_message", "failure_reason", "failureReason"],
    )
}

fn extract_repair_message(map: &Map<String, Value>) -> Option<String> {
    extract_string_field(map, &["message", "detail", "details", "note", "description"])
}

fn fail_entire_repair_run(
    app: &AppHandle,
    run_id: u64,
    npc_ids: &[String],
    message: &str,
    duration_ms: u64,
) {
    let mut status_map = HashMap::new();
    let mut errors = HashMap::new();
    for id in npc_ids {
        status_map.insert(id.clone(), "error".to_string());
        errors.insert(id.clone(), message.to_string());
        emit_npc_repair_event(
            app,
            NpcRepairProgressPayload {
                run_id,
                npc_id: Some(id.clone()),
                status: Some("error".to_string()),
                message: Some(message.to_string()),
                error: Some(message.to_string()),
                summary: None,
            },
        );
    }
    let summary = NpcRepairSummary {
        run_id,
        total: npc_ids.len(),
        requested: npc_ids.to_vec(),
        status_map: status_map.clone(),
        verified: Vec::new(),
        failed: npc_ids.to_vec(),
        duration_ms,
        errors,
    };
    emit_npc_repair_event(
        app,
        NpcRepairProgressPayload {
            run_id,
            npc_id: None,
            status: Some("error".to_string()),
            message: Some(message.to_string()),
            error: Some(message.to_string()),
            summary: Some(summary),
        },
    );
}

fn spawn_npc_repair_job(app: AppHandle, helper_path: PathBuf, run_id: u64, npc_ids: Vec<String>) {
    std::thread::spawn(move || {
        run_npc_repair_job(app, helper_path, run_id, npc_ids);
    });
}

fn run_npc_repair_job(app: AppHandle, helper_path: PathBuf, run_id: u64, npc_ids: Vec<String>) {
    if npc_ids.is_empty() {
        return;
    }
    let start = Instant::now();
    for id in &npc_ids {
        emit_npc_repair_event(
            &app,
            NpcRepairProgressPayload {
                run_id,
                npc_id: Some(id.clone()),
                status: Some("pending".to_string()),
                message: Some("Starting repair".to_string()),
                error: None,
                summary: None,
            },
        );
    }

    let mut cmd = python_command();
    cmd.arg(&helper_path);
    let mut child = match cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            let msg = format!("Failed to start repair helper: {}", err);
            let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            fail_entire_repair_run(&app, run_id, &npc_ids, &msg, elapsed_ms);
            return;
        }
    };

    let request = NpcRepairRequest {
        run_id,
        npc_ids: npc_ids.clone(),
    };
    if let Some(stdin) = child.stdin.as_mut() {
        if let Err(err) = serde_json::to_vec(&request)
            .map_err(|e| e.to_string())
            .and_then(|payload| {
                stdin.write_all(&payload).map_err(|e| e.to_string())
            })
        {
            let msg = format!("Failed to communicate with repair helper: {}", err);
            let _ = child.kill();
            let _ = child.wait();
            let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            fail_entire_repair_run(&app, run_id, &npc_ids, &msg, elapsed_ms);
            return;
        }
    }
    drop(child.stdin.take());

    let stdout = match child.stdout.take() {
        Some(pipe) => pipe,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            fail_entire_repair_run(
                &app,
                run_id,
                &npc_ids,
                "Repair helper did not provide stdout",
                elapsed_ms,
            );
            return;
        }
    };
    let stderr_pipe = child.stderr.take();

    let statuses: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(
        npc_ids
            .iter()
            .map(|id| (id.clone(), "pending".to_string()))
            .collect(),
    ));
    let errors: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));

    let stdout_statuses = statuses.clone();
    let stdout_errors = errors.clone();
    let stdout_app = app.clone();
    let stdout_handle = std::thread::spawn(move || -> Result<(), String> {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(Value::Object(map)) => {
                    if let Some(npc_id) = map
                        .get("npc_id")
                        .or_else(|| map.get("npcId"))
                        .or_else(|| map.get("id"))
                        .and_then(|value| value.as_str())
                    {
                        let id = npc_id.trim();
                        if id.is_empty() {
                            continue;
                        }
                        let status = derive_repair_status(&map);
                        let message = extract_repair_message(&map);
                        let error_text = extract_repair_error(&map);
                        {
                            let mut guard = stdout_statuses.lock().unwrap();
                            guard.insert(id.to_string(), status.clone());
                        }
                        if let Some(ref err) = error_text {
                            let mut guard = stdout_errors.lock().unwrap();
                            guard.insert(id.to_string(), err.clone());
                        }
                        emit_npc_repair_event(
                            &stdout_app,
                            NpcRepairProgressPayload {
                                run_id,
                                npc_id: Some(id.to_string()),
                                status: Some(status),
                                message,
                                error: error_text,
                                summary: None,
                            },
                        );
                    } else if let Some(summary) = map.get("summary").and_then(|value| value.as_object()) {
                        if let Some(status_map) = summary.get("status_map").and_then(|value| value.as_object()) {
                            let mut updates = Vec::new();
                            for (id, value) in status_map {
                                if let Some(text) = value.as_str() {
                                    updates.push((id.clone(), normalize_repair_status_text(text).to_string()));
                                }
                            }
                            if !updates.is_empty() {
                                let mut guard = stdout_statuses.lock().unwrap();
                                for (id, status) in updates {
                                    guard.insert(id, status);
                                }
                            }
                        }
                        if let Some(verified) = summary.get("verified").and_then(|value| value.as_array()) {
                            let mut guard = stdout_statuses.lock().unwrap();
                            for entry in verified {
                                if let Some(id) = entry.as_str() {
                                    guard.insert(id.to_string(), "verified".to_string());
                                }
                            }
                        }
                        if let Some(failed) = summary.get("failed").and_then(|value| value.as_array()) {
                            let mut guard = stdout_statuses.lock().unwrap();
                            for entry in failed {
                                if let Some(id) = entry.as_str() {
                                    guard.insert(id.to_string(), "error".to_string());
                                }
                            }
                        }
                        if let Some(errors_obj) = summary.get("errors").and_then(|value| value.as_object()) {
                            let mut guard = stdout_errors.lock().unwrap();
                            for (id, value) in errors_obj {
                                if let Some(text) = value.as_str() {
                                    guard.insert(id.clone(), text.to_string());
                                }
                            }
                        }
                    } else {
                        eprintln!("[npc_repair] helper log: {}", trimmed);
                    }
                }
                Ok(other) => {
                    eprintln!("[npc_repair] unexpected helper output: {:?}", other);
                }
                Err(_) => {
                    eprintln!("[npc_repair] non-JSON helper output: {}", trimmed);
                }
            }
        }
        Ok(())
    });

    let stderr_buffer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_buffer_clone = stderr_buffer.clone();
    let stderr_handle = std::thread::spawn(move || {
        if let Some(pipe) = stderr_pipe {
            let reader = BufReader::new(pipe);
            for line in reader.lines().flatten() {
                eprintln!("[npc_repair stderr] {}", line);
                let mut guard = stderr_buffer_clone.lock().unwrap();
                guard.push_str(&line);
                guard.push('\n');
            }
        }
    });

    let exit_status = match child.wait() {
        Ok(status) => status,
        Err(err) => {
            let msg = format!("Failed to wait for repair helper: {}", err);
            let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
            fail_entire_repair_run(&app, run_id, &npc_ids, &msg, elapsed_ms);
            return;
        }
    };

    let mut run_error: Option<String> = None;
    match stdout_handle.join() {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            run_error = Some(err);
        }
        Err(_) => {
            run_error = Some("Repair helper thread panicked".to_string());
        }
    }
    let _ = stderr_handle.join();
    let stderr_output = stderr_buffer.lock().unwrap().clone();
    if !exit_status.success() {
        let status_text = exit_status
            .code()
            .map(|code| format!("Repair helper exited with code {}", code))
            .unwrap_or_else(|| "Repair helper terminated by signal".to_string());
        if let Some(existing) = run_error.as_mut() {
            existing.push_str("; ");
            existing.push_str(&status_text);
        } else {
            run_error = Some(status_text);
        }
    }
    let stderr_trimmed = stderr_output.trim();
    if let Some((first_line, _)) = stderr_trimmed.split_once('\n') {
        if let Some(existing) = run_error.as_mut() {
            existing.push_str("; stderr: ");
            existing.push_str(first_line);
        }
    } else if !stderr_trimmed.is_empty() {
        if let Some(existing) = run_error.as_mut() {
            existing.push_str("; stderr: ");
            existing.push_str(stderr_trimmed);
        } else {
            run_error = Some(stderr_trimmed.to_string());
        }
    }

    let mut status_map = statuses.lock().unwrap().clone();
    let mut error_map = errors.lock().unwrap().clone();

    if let Some(err_msg) = run_error.as_ref() {
        for id in &npc_ids {
            if !error_map.contains_key(id) {
                error_map.insert(id.clone(), err_msg.clone());
                status_map.insert(id.clone(), "error".to_string());
            }
        }
    }
    let mut final_status_map = HashMap::new();
    let mut verified = Vec::new();
    let mut failed = Vec::new();

    for id in &npc_ids {
        let raw = status_map
            .get(id)
            .cloned()
            .unwrap_or_else(|| "pending".to_string());
        let mut final_status = match raw.as_str() {
            "verified" => "verified".to_string(),
            "error" => "error".to_string(),
            "not_verified" => "error".to_string(),
            _ => {
                if !error_map.contains_key(id) {
                    let msg = match raw.as_str() {
                        "pending" => "Repair did not complete for this record".to_string(),
                        other => format!("Repair ended with status '{}'.", other),
                    };
                    error_map.insert(id.clone(), msg);
                }
                "error".to_string()
            }
        };
        if final_status == "verified" {
            verified.push(id.clone());
        } else {
            failed.push(id.clone());
            if !error_map.contains_key(id) {
                error_map.insert(id.clone(), "Repair failed".to_string());
            }
            final_status = "error".to_string();
        }
        let is_error = final_status == "error";
        let error_entry = error_map.get(id).cloned();
        final_status_map.insert(id.clone(), final_status.clone());
        emit_npc_repair_event(
            &app,
            NpcRepairProgressPayload {
                run_id,
                npc_id: Some(id.clone()),
                status: Some(final_status),
                message: if is_error {
                    error_entry.clone()
                } else {
                    None
                },
                error: error_entry,
                summary: None,
            },
        );
    }

    let duration_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let summary = NpcRepairSummary {
        run_id,
        total: npc_ids.len(),
        requested: npc_ids.clone(),
        status_map: final_status_map,
        verified: verified.clone(),
        failed: failed.clone(),
        duration_ms,
        errors: error_map.clone(),
    };

    let (run_status, run_message, run_error_field) = if let Some(err) = run_error.clone() {
        ("error".to_string(), Some(err.clone()), Some(err))
    } else if failed.is_empty() {
        (
            "completed".to_string(),
            Some("Repair run completed successfully.".to_string()),
            None,
        )
    } else {
        (
            "completed".to_string(),
            Some("Repair run completed with failures.".to_string()),
            None,
        )
    };

    emit_npc_repair_event(
        &app,
        NpcRepairProgressPayload {
            run_id,
            npc_id: None,
            status: Some(run_status),
            message: run_message,
            error: run_error_field,
            summary: Some(summary),
        },
    );
}

#[tauri::command]
async fn npc_repair_run(app: AppHandle, npc_ids: Vec<String>) -> Result<NpcRepairLaunch, String> {
    let mut normalized: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for id in npc_ids {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = trimmed.to_string();
        if seen.insert(candidate.clone()) {
            normalized.push(candidate);
        }
    }
    if normalized.is_empty() {
        return Err("At least one NPC must be selected for repair.".to_string());
    }

    let helper_path = env::var("BLOSSOM_REPAIR_HELPER")
        .map(PathBuf::from)
        .unwrap_or_else(|_| project_root().join("scripts").join("dnd_repair_helper.py"));
    if !helper_path.exists() {
        return Err(format!(
            "Repair helper not found at {}. Install the helper before running repairs.",
            helper_path.display()
        ));
    }

    let run_id = NPC_REPAIR_RUN_COUNTER.fetch_add(1, Ordering::SeqCst);
    for id in &normalized {
        emit_npc_repair_event(
            &app,
            NpcRepairProgressPayload {
                run_id,
                npc_id: Some(id.clone()),
                status: Some("not_verified".to_string()),
                message: Some("Queued for repair".to_string()),
                error: None,
                summary: None,
            },
        );
    }

    spawn_npc_repair_job(app, helper_path, run_id, normalized.clone());

    Ok(NpcRepairLaunch {
        run_id,
        requested: normalized,
    })
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ProgressEvent {
    stage: Option<String>,
    percent: Option<u8>,
    message: Option<String>,
    eta: Option<String>,
    step: Option<u64>,
    total: Option<u64>,
    queue_position: Option<usize>,
    queue_eta_seconds: Option<u64>,
}

fn extract_error_message(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .find_map(|v| {
            v.get("error")
                .and_then(|e| e.as_str())
                .map(|s| s.to_string())
        })
}

const MAX_LOG_LINES: usize = 200;
const MAX_HISTORY: usize = 200;

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct JobProgressSnapshot {
    stage: Option<String>,
    percent: Option<u8>,
    message: Option<String>,
    eta: Option<String>,
    step: Option<u64>,
    total: Option<u64>,
    queue_position: Option<usize>,
    queue_eta_seconds: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct JobArtifact {
    name: String,
    path: String,
}

#[derive(Clone, Debug)]
struct JobArtifactCandidate {
    name: String,
    path: PathBuf,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct JobRecord {
    id: u64,
    kind: Option<String>,
    label: Option<String>,
    #[serde(default)]
    source: Option<String>,
    args: Vec<String>,
    created_at: DateTime<Utc>,
    #[serde(default)]
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    success: Option<bool>,
    exit_code: Option<i32>,
    stdout_excerpt: Vec<String>,
    stderr_excerpt: Vec<String>,
    artifacts: Vec<JobArtifact>,
    progress: Option<JobProgressSnapshot>,
    #[serde(default)]
    cancelled: bool,
}

impl JobRecord {
    fn status_text(&self) -> String {
        if self.cancelled {
            "cancelled".to_string()
        } else {
            match self.success {
                Some(true) => "completed".to_string(),
                Some(false) => "error".to_string(),
                None => "running".to_string(),
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct QueueRecord {
    id: u64,
    args: Vec<String>,
    kind: Option<String>,
    label: Option<String>,
    #[serde(default)]
    source: Option<String>,
    artifact_candidates: Vec<JobArtifact>,
    created_at: DateTime<Utc>,
    queued_at: DateTime<Utc>,
}

#[derive(Clone, Default)]
struct JobContext {
    kind: Option<String>,
    label: Option<String>,
    source: Option<String>,
    artifact_candidates: Vec<JobArtifactCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MusicGenJobRequest {
    prompt: String,
    duration: f32,
    model_name: String,
    temperature: f32,
    force_cpu: Option<bool>,
    force_gpu: Option<bool>,
    use_fp16: Option<bool>,
    output_dir: Option<String>,
    output_name: Option<String>,
    count: Option<u32>,
    melody_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RenderJobRequest {
    preset: Option<String>,
    style: Option<String>,
    minutes: Option<f64>,
    #[allow(dead_code)]
    sections: Option<u32>,
    seed: Option<i64>,
    sampler_seed: Option<i64>,
    mix_preset: Option<String>,
    name: Option<String>,
    outdir: Option<String>,
    mix_config: Option<String>,
    arrange_config: Option<String>,
    bundle_stems: Option<bool>,
    eval_only: Option<bool>,
    dry_run: Option<bool>,
    keys_sfz: Option<String>,
    pads_sfz: Option<String>,
    bass_sfz: Option<String>,
    drums_sfz: Option<String>,
    melody_midi: Option<String>,
    drums_model: Option<String>,
    bass_model: Option<String>,
    keys_model: Option<String>,
    arrange: Option<String>,
    outro: Option<String>,
    preview: Option<u32>,
    phrase: Option<bool>,
}

struct JobInfo {
    child: Arc<Mutex<Option<Child>>>,
    pending: bool,
    cancelled: bool,
    status: Option<bool>,
    stderr_full: Arc<Mutex<String>>,
    stdout_excerpt: Arc<Mutex<VecDeque<String>>>,
    stderr_excerpt: Arc<Mutex<VecDeque<String>>>,
    artifacts: Arc<Mutex<Vec<JobArtifact>>>,
    artifact_candidates: Vec<JobArtifactCandidate>,
    created_at: DateTime<Utc>,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    args: Vec<String>,
    exit_code: Option<i32>,
    progress: Arc<Mutex<Option<JobProgressSnapshot>>>,
    kind: Option<String>,
    label: Option<String>,
    source: Option<String>,
}

impl JobInfo {
    fn new_pending(args: Vec<String>, context: &JobContext) -> Self {
        let now = Utc::now();
        JobInfo {
            child: Arc::new(Mutex::new(None)),
            pending: true,
            cancelled: false,
            status: None,
            stderr_full: Arc::new(Mutex::new(String::new())),
            stdout_excerpt: Arc::new(Mutex::new(VecDeque::new())),
            stderr_excerpt: Arc::new(Mutex::new(VecDeque::new())),
            artifacts: Arc::new(Mutex::new(Vec::new())),
            artifact_candidates: context.artifact_candidates.clone(),
            created_at: now,
            queued_at: now,
            started_at: None,
            finished_at: None,
            args,
            exit_code: None,
            progress: Arc::new(Mutex::new(None)),
            kind: context.kind.clone(),
            label: context.label.clone(),
            source: context.source.clone(),
        }
    }

    #[allow(dead_code)]
    fn to_record(&self, id: u64) -> JobRecord {
        let stdout = self
            .stdout_excerpt
            .lock()
            .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let stderr_lines = self
            .stderr_excerpt
            .lock()
            .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let artifacts = self
            .artifacts
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        let progress = self
            .progress
            .lock()
            .map(|p| (*p).clone())
            .unwrap_or_default();
        JobRecord {
            id,
            kind: self.kind.clone(),
            label: self.label.clone(),
            source: self.source.clone(),
            args: self.args.clone(),
            created_at: self.created_at,
            started_at: self.started_at,
            finished_at: self.finished_at,
            success: self.status,
            exit_code: self.exit_code,
            stdout_excerpt: stdout,
            stderr_excerpt: stderr_lines,
            artifacts,
            progress,
            cancelled: self.cancelled,
        }
    }
}

struct JobRegistry {
    jobs: Mutex<HashMap<u64, JobInfo>>,
    history: Mutex<VecDeque<JobRecord>>,
    queue: Mutex<VecDeque<u64>>,
    counter: AtomicU64,
    history_path: OnceLock<PathBuf>,
    queue_path: OnceLock<PathBuf>,
    concurrency_limit: AtomicUsize,
}

impl JobRegistry {
    fn new() -> Self {
        let concurrency = env::var("BLOSSOM_JOB_CONCURRENCY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(1);
        Self {
            jobs: Mutex::new(HashMap::new()),
            history: Mutex::new(VecDeque::new()),
            queue: Mutex::new(VecDeque::new()),
            counter: AtomicU64::new(1),
            history_path: OnceLock::new(),
            queue_path: OnceLock::new(),
            concurrency_limit: AtomicUsize::new(concurrency),
        }
    }

    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::SeqCst)
    }

    fn init_persistence(&self, history_path: PathBuf, queue_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = history_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if let Some(parent) = queue_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if self.history_path.set(history_path.clone()).is_ok() {
            if history_path.exists() {
                let data = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
                if !data.trim().is_empty() {
                    let parsed: Vec<JobRecord> =
                        serde_json::from_str(&data).map_err(|e| e.to_string())?;
                    let mut history = self.history.lock().unwrap();
                    history.extend(parsed.into_iter());
                }
            }
        }

        if self.queue_path.set(queue_path.clone()).is_ok() {
            if queue_path.exists() {
                let data = fs::read_to_string(&queue_path).map_err(|e| e.to_string())?;
                if !data.trim().is_empty() {
                    let parsed: Vec<QueueRecord> =
                        serde_json::from_str(&data).map_err(|e| e.to_string())?;
                    let mut jobs = self.jobs.lock().unwrap();
                    let mut queue = self.queue.lock().unwrap();
                    for record in parsed {
                        let artifact_candidates = record
                            .artifact_candidates
                            .iter()
                            .map(|candidate| JobArtifactCandidate {
                                name: candidate.name.clone(),
                                path: PathBuf::from(&candidate.path),
                            })
                            .collect();
                        let job = JobInfo {
                            child: Arc::new(Mutex::new(None)),
                            pending: true,
                            cancelled: false,
                            status: None,
                            stderr_full: Arc::new(Mutex::new(String::new())),
                            stdout_excerpt: Arc::new(Mutex::new(VecDeque::new())),
                            stderr_excerpt: Arc::new(Mutex::new(VecDeque::new())),
                            artifacts: Arc::new(Mutex::new(Vec::new())),
                            artifact_candidates,
                            created_at: record.created_at,
                            queued_at: record.queued_at,
                            started_at: None,
                            finished_at: None,
                            args: record.args.clone(),
                            exit_code: None,
                            progress: Arc::new(Mutex::new(None)),
                            kind: record.kind.clone(),
                            label: record.label.clone(),
                            source: record.source.clone(),
                        };
                        jobs.insert(record.id, job);
                        queue.push_back(record.id);
                    }
                }
            }
        }

        let mut max_id = None;
        {
            let history = self.history.lock().unwrap();
            if let Some(history_max) = history.iter().map(|r| r.id).max() {
                max_id = Some(history_max);
            }
        }
        {
            let queue = self.queue.lock().unwrap();
            if let Some(queue_max) = queue.iter().copied().max() {
                max_id = Some(max_id.map_or(queue_max, |m| m.max(queue_max)));
            }
        }
        if let Some(max_id) = max_id {
            let next = max_id.saturating_add(1);
            let current = self.counter.load(Ordering::SeqCst);
            if next > current {
                self.counter.store(next, Ordering::SeqCst);
            }
        }

        Ok(())
    }

    fn persist_history(&self) -> Result<(), String> {
        let path = match self.history_path.get() {
            Some(p) => p.clone(),
            None => return Ok(()),
        };
        let history = self.history.lock().unwrap();
        let data = serde_json::to_string_pretty(&history.iter().cloned().collect::<Vec<_>>())
            .map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    fn persist_queue(&self) -> Result<(), String> {
        let path = match self.queue_path.get() {
            Some(p) => p.clone(),
            None => return Ok(()),
        };
        let queue_ids: Vec<u64> = self.queue.lock().unwrap().iter().copied().collect();
        let jobs = self.jobs.lock().unwrap();
        let records: Vec<QueueRecord> = queue_ids
            .into_iter()
            .filter_map(|id| {
                jobs.get(&id).and_then(|job| {
                    if job.pending && !job.cancelled && job.status.is_none() {
                        Some(QueueRecord {
                            id,
                            args: job.args.clone(),
                            kind: job.kind.clone(),
                            label: job.label.clone(),
                            source: job.source.clone(),
                            artifact_candidates: job
                                .artifact_candidates
                                .iter()
                                .map(|candidate| JobArtifact {
                                    name: candidate.name.clone(),
                                    path: candidate.path.to_string_lossy().to_string(),
                                })
                                .collect(),
                            created_at: job.created_at,
                            queued_at: job.queued_at,
                        })
                    } else {
                        None
                    }
                })
            })
            .collect();
        let data = serde_json::to_string_pretty(&records).map_err(|e| e.to_string())?;
        fs::write(path, data).map_err(|e| e.to_string())
    }

    fn remove_from_queue(&self, id: u64) -> bool {
        let mut queue = self.queue.lock().unwrap();
        if let Some(pos) = queue.iter().position(|candidate| *candidate == id) {
            queue.remove(pos);
            true
        } else {
            false
        }
    }

    fn concurrency_limit_value(&self) -> usize {
        self.concurrency_limit.load(Ordering::SeqCst)
    }

    fn count_active_jobs(&self) -> usize {
        let jobs = self.jobs.lock().unwrap();
        jobs.values()
            .filter(|job| !job.pending && !job.cancelled && job.status.is_none())
            .count()
    }

    fn is_job_done(&self, id: u64) -> bool {
        self.jobs
            .lock()
            .unwrap()
            .get(&id)
            .map(|job| job.cancelled || job.status.is_some())
            .unwrap_or(true)
    }

    fn average_job_duration_seconds(&self) -> Option<u64> {
        let history = self.history.lock().unwrap();
        let mut durations = Vec::new();
        for record in history.iter().rev() {
            if record.success == Some(true) {
                if let Some(finished) = record.finished_at {
                    let start = record.started_at.unwrap_or(record.created_at);
                    let delta = finished.signed_duration_since(start);
                    let seconds = delta.num_seconds();
                    if seconds > 0 {
                        durations.push(seconds as u64);
                    }
                }
            }
            if durations.len() >= 20 {
                break;
            }
        }
        if durations.is_empty() {
            None
        } else {
            let total: u64 = durations.iter().copied().sum();
            Some(total / durations.len() as u64)
        }
    }

    fn estimate_queue_eta_seconds(&self, queue_index: usize, running_count: usize) -> Option<u64> {
        let average = self.average_job_duration_seconds()?;
        let limit = self.concurrency_limit_value();
        if limit == 0 {
            return Some(0);
        }
        let slots = limit.max(1);
        let jobs_before = running_count + queue_index;
        let rounds = jobs_before / slots;
        Some(average.saturating_mul(rounds as u64))
    }

    fn update_queue_positions(&self, app: &AppHandle) {
        let queue_ids: Vec<u64> = self.queue.lock().unwrap().iter().copied().collect();
        if queue_ids.is_empty() {
            return;
        }
        let running = self.count_active_jobs();
        let mut updates = Vec::new();
        {
            let jobs = self.jobs.lock().unwrap();
            for (idx, id) in queue_ids.iter().enumerate() {
                if let Some(job) = jobs.get(id) {
                    if !job.pending || job.cancelled || job.status.is_some() {
                        continue;
                    }
                    let eta_seconds = self.estimate_queue_eta_seconds(idx, running);
                    let ahead = running + idx;
                    let snapshot = JobProgressSnapshot {
                        stage: Some("queued".into()),
                        percent: Some(0),
                        message: Some(if ahead > 0 {
                            format!("Queued ({} ahead)", ahead)
                        } else {
                            "Queued".to_string()
                        }),
                        eta: eta_seconds.map(format_eta_string),
                        step: None,
                        total: None,
                        queue_position: Some(idx),
                        queue_eta_seconds: eta_seconds,
                    };
                    {
                        let mut stored = job.progress.lock().unwrap();
                        *stored = Some(snapshot.clone());
                    }
                    updates.push((*id, snapshot));
                }
            }
        }
        for (id, snapshot) in updates {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            let _ = app.emit(&format!("progress::{}", id), event);
        }
    }

    fn enqueue_job(&self, id: u64, job: JobInfo) -> Result<(), String> {
        {
            let mut jobs = self.jobs.lock().unwrap();
            jobs.insert(id, job);
        }
        {
            let mut queue = self.queue.lock().unwrap();
            queue.push_back(id);
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_queue() {
                eprintln!("failed to persist job queue: {}", err);
                return Err(err);
            }
        } else {
            eprintln!("[blossom] persistence disabled; skipping persist_queue on enqueue");
        }
        Ok(())
    }

    fn register_running_job(
        &self,
        app: &AppHandle,
        id: u64,
        mut job: JobInfo,
        initial_progress: JobProgressSnapshot,
    ) {
        job.pending = false;
        job.started_at = Some(Utc::now());
        {
            let mut progress = job.progress.lock().unwrap();
            *progress = Some(initial_progress.clone());
        }
        {
            let mut jobs = self.jobs.lock().unwrap();
            jobs.insert(id, job);
        }
        let event = ProgressEvent {
            stage: initial_progress.stage.clone(),
            percent: initial_progress.percent,
            message: initial_progress.message.clone(),
            eta: initial_progress.eta.clone(),
            step: initial_progress.step,
            total: initial_progress.total,
            queue_position: initial_progress.queue_position,
            queue_eta_seconds: initial_progress.queue_eta_seconds,
        };
        let _ = app.emit(&format!("progress::{}", id), event);
    }

    fn update_job_progress(&self, app: &AppHandle, id: u64, snapshot: JobProgressSnapshot) {
        let progress_arc = {
            let jobs = self.jobs.lock().unwrap();
            jobs.get(&id).map(|job| job.progress.clone())
        };
        if let Some(progress_arc) = progress_arc {
            {
                let mut guard = progress_arc.lock().unwrap();
                *guard = Some(snapshot.clone());
            }
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            let _ = app.emit(&format!("progress::{}", id), event);
        }
    }

    fn append_job_stdout(&self, id: u64, line: &str) {
        let arc = {
            let jobs = self.jobs.lock().unwrap();
            jobs.get(&id).map(|job| job.stdout_excerpt.clone())
        };
        if let Some(buffer_arc) = arc {
            let mut buffer = buffer_arc.lock().unwrap();
            buffer.push_back(line.to_string());
            while buffer.len() > MAX_LOG_LINES {
                buffer.pop_front();
            }
        }
    }

    fn append_job_stderr(&self, id: u64, line: &str) {
        let handles = {
            let jobs = self.jobs.lock().unwrap();
            jobs.get(&id)
                .map(|job| (job.stderr_excerpt.clone(), job.stderr_full.clone()))
        };
        if let Some((excerpt_arc, full_arc)) = handles {
            {
                let mut buffer = excerpt_arc.lock().unwrap();
                buffer.push_back(line.to_string());
                while buffer.len() > MAX_LOG_LINES {
                    buffer.pop_front();
                }
            }
            {
                let mut full = full_arc.lock().unwrap();
                full.push_str(line);
                if !line.ends_with('\n') {
                    full.push('\n');
                }
            }
        }
    }

    fn spawn_completion_watcher(
        &self,
        app: &AppHandle,
        id: u64,
        child_arc: Arc<Mutex<Option<Child>>>,
    ) {
        let app_handle = app.clone();
        async_runtime::spawn(async move {
            loop {
                let result = {
                    let mut guard = child_arc.lock().unwrap();
                    if let Some(child) = guard.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                let success = status.success();
                                let code = status.code();
                                *guard = None;
                                Some((success, code))
                            }
                            Ok(None) => None,
                            Err(err) => {
                                eprintln!("failed to check job {} status: {}", id, err);
                                Some((false, None))
                            }
                        }
                    } else {
                        None
                    }
                };
                if let Some((success, code)) = result {
                    eprintln!(
                        "[blossom] job {} exited (success={}, code={:?})",
                        id, success, code
                    );
                    let registry = app_handle.state::<JobRegistry>();
                    registry.complete_job(&app_handle, id, success, code, false);
                    registry.maybe_start_jobs(&app_handle);
                    break;
                }
                let registry = app_handle.state::<JobRegistry>();
                if registry.is_job_done(id) {
                    break;
                }
                sleep(Duration::from_secs(1)).await;
            }
        });
    }

    fn start_job_process(&self, app: &AppHandle, id: u64) -> Result<(), String> {
        let (args, stderr_full, stdout_excerpt, stderr_excerpt, progress_arc, child_arc) = {
            let mut jobs = self.jobs.lock().unwrap();
            let job = jobs
                .get_mut(&id)
                .ok_or_else(|| format!("Unknown job {}", id))?;
            if job.cancelled || job.status.is_some() {
                return Err("Job already completed".into());
            }
            job.pending = false;
            job.started_at = Some(Utc::now());
            let progress_arc = job.progress.clone();
            {
                let mut progress = progress_arc.lock().unwrap();
                let snapshot = JobProgressSnapshot {
                    stage: Some("starting".into()),
                    percent: Some(0),
                    message: Some("Starting job...".into()),
                    eta: None,
                    step: None,
                    total: None,
                    queue_position: None,
                    queue_eta_seconds: None,
                };
                *progress = Some(snapshot);
            }
            (
                job.args.clone(),
                job.stderr_full.clone(),
                job.stdout_excerpt.clone(),
                job.stderr_excerpt.clone(),
                progress_arc,
                job.child.clone(),
            )
        };

        let mut cmd = python_command();
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        eprintln!("[blossom] starting job {} with args: {:?}", id, args);
        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("Failed to spawn python process for job {}: {}", id, e);
            eprintln!("[blossom] {}", msg);
            msg
        })?;
        let stdout_pipe = child.stdout.take();
        let stderr_pipe = child.stderr.take();
        {
            let mut guard = child_arc.lock().unwrap();
            *guard = Some(child);
        }

        if let Some(stderr) = stderr_pipe {
            let stderr_buf_clone = stderr_full.clone();
            let stderr_excerpt_clone = stderr_excerpt.clone();
            let app_handle = app.clone();
            async_runtime::spawn(async move {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    {
                        let mut buf = stderr_buf_clone.lock().unwrap();
                        buf.push_str(&line);
                        buf.push('\n');
                    }
                    {
                        let mut lines = stderr_excerpt_clone.lock().unwrap();
                        if lines.len() >= MAX_LOG_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line.clone());
                    }
                    // Also mirror to terminal stderr for troubleshooting
                    eprintln!("[job {} stderr] {}", id, line);
                    let _ = app_handle.emit("logs::line", line.clone());
                }
            });
        }

        if let Some(stdout) = stdout_pipe {
            let app_handle = app.clone();
            let stdout_excerpt_clone = stdout_excerpt.clone();
            let progress_clone = progress_arc.clone();
            async_runtime::spawn(async move {
                let stage_re = Regex::new(r"^\s*([\w-]+):").unwrap();
                let percent_re = Regex::new(r"(\d+)%").unwrap();
                let eta_re = Regex::new(r"ETA[:\s]+([0-9:]+)").unwrap();
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    {
                        let mut lines = stdout_excerpt_clone.lock().unwrap();
                        if lines.len() >= MAX_LOG_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line.clone());
                    }
                    let stage = stage_re.captures(&line).map(|c| c[1].to_string());
                    let percent = percent_re
                        .captures(&line)
                        .and_then(|c| c[1].parse::<u8>().ok());
                    let eta = eta_re.captures(&line).map(|c| c[1].to_string());
                    let event = ProgressEvent {
                        stage: stage.clone(),
                        percent,
                        message: Some(line.clone()),
                        eta: eta.clone(),
                        step: None,
                        total: None,
                        queue_position: None,
                        queue_eta_seconds: None,
                    };
                    {
                        let mut snapshot = progress_clone.lock().unwrap();
                        *snapshot = Some(JobProgressSnapshot {
                            stage,
                            percent,
                            message: event.message.clone(),
                            eta,
                            step: event.step,
                            total: event.total,
                            queue_position: None,
                            queue_eta_seconds: None,
                        });
                    }
                    // Mirror to terminal stdout for troubleshooting
                    eprintln!("[job {} stdout] {}", id, line);
                    let _ = app_handle.emit("logs::line", line.clone());
                    let _ = app_handle.emit(&format!("progress::{}", id), event);
                }
            });
        }

        self.spawn_completion_watcher(app, id, child_arc.clone());

        if let Some(snapshot) = progress_arc.lock().unwrap().clone() {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            let _ = app.emit(&format!("progress::{}", id), event);
        }

        Ok(())
    }

    fn maybe_start_jobs(&self, app: &AppHandle) {
        loop {
            let limit = self.concurrency_limit_value();
            let slots = if limit == 0 { usize::MAX } else { limit.max(1) };
            if slots != usize::MAX && self.count_active_jobs() >= slots {
                break;
            }
            let next_id = {
                let mut queue = self.queue.lock().unwrap();
                queue.pop_front()
            };
            let Some(id) = next_id else {
                break;
            };
            if persistence_enabled() {
                if let Err(err) = self.persist_queue() {
                    eprintln!("failed to persist job queue after dequeue: {}", err);
                }
            }
            if let Err(err) = self.start_job_process(app, id) {
                eprintln!("failed to start job {}: {}", id, err);
                self.complete_job(app, id, false, None, false);
            }
        }
        self.update_queue_positions(app);
    }

    fn complete_job(
        &self,
        app: &AppHandle,
        id: u64,
        success: bool,
        exit_code: Option<i32>,
        cancelled: bool,
    ) {
        eprintln!(
            "[blossom] complete_job(id={}, success={}, cancelled={}, code={:?})",
            id, success, cancelled, exit_code
        );
        eprintln!("[blossom] complete_job: remove_from_queue start id={}", id);
        if self.remove_from_queue(id) {
            if persistence_enabled() {
                if let Err(err) = self.persist_queue() {
                    eprintln!("failed to persist job queue after removal: {}", err);
                }
            } else {
                eprintln!("[blossom] persistence disabled; skipping queue persist after removal");
            }
        }
        eprintln!("[blossom] complete_job: removed from queue id={}", id);
        let mut maybe_record: Option<JobRecord> = None;
        let mut progress_update = None;
        eprintln!("[blossom] complete_job: acquiring jobs lock id={}", id);
        let mut captured: Option<(
            Arc<Mutex<VecDeque<String>>>,
            Arc<Mutex<VecDeque<String>>>,
            Arc<Mutex<Vec<JobArtifact>>>,
            Arc<Mutex<Option<JobProgressSnapshot>>>,
            (
                Option<String>,
                Option<String>,
                Option<String>,
                Vec<String>,
                DateTime<Utc>,
                Option<DateTime<Utc>>,
                Option<DateTime<Utc>>,
                Option<bool>,
                Option<i32>,
                bool,
            ),
        )> = None;
        {
            let mut jobs = self.jobs.lock().unwrap();
            eprintln!("[blossom] complete_job: jobs lock acquired id={}", id);
            if let Some(job) = jobs.get_mut(&id) {
                if job.finished_at.is_some() {
                    return;
                }
                job.pending = false;
                job.status = Some(success);
                job.cancelled = cancelled;
                job.exit_code = exit_code;
                job.finished_at.get_or_insert_with(Utc::now);
                if job.started_at.is_none() {
                    job.started_at = Some(job.created_at);
                }
                {
                    let mut child_guard = job.child.lock().unwrap();
                    *child_guard = None;
                }
                eprintln!(
                    "[blossom] complete_job: checking artifact candidates id={}",
                    id
                );
                if job.artifacts.lock().map(|a| a.is_empty()).unwrap_or(true) {
                    let mut artifacts = job.artifacts.lock().unwrap();
                    for candidate in &job.artifact_candidates {
                        if candidate.path.exists() {
                            artifacts.push(JobArtifact {
                                name: candidate.name.clone(),
                                path: candidate.path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
                eprintln!(
                    "[blossom] complete_job: building progress snapshot id={}",
                    id
                );
                let mut progress = job.progress.lock().unwrap();
                let mut snapshot = progress.clone().unwrap_or_default();
                snapshot.queue_position = None;
                snapshot.queue_eta_seconds = None;
                snapshot.eta = None;
                snapshot.step = None;
                snapshot.total = None;
                snapshot.percent = Some(100);
                snapshot.stage = Some(if cancelled {
                    "cancelled".into()
                } else if success {
                    "completed".into()
                } else {
                    "error".into()
                });
                if cancelled {
                    snapshot.message = Some("Job cancelled by user".into());
                    let mut stderr = job.stderr_full.lock().unwrap();
                    if !stderr.contains("Job cancelled by user") {
                        if !stderr.is_empty() && !stderr.ends_with('\n') {
                            stderr.push('\n');
                        }
                        stderr.push_str("Job cancelled by user\n");
                    }
                }
                *progress = Some(snapshot.clone());
                progress_update = Some(snapshot);
                eprintln!("[blossom] complete_job: preparing record fields id={}", id);
                // Capture data and Arc handles, then build record after releasing jobs lock
                captured = Some((
                    job.stdout_excerpt.clone(),
                    job.stderr_excerpt.clone(),
                    job.artifacts.clone(),
                    job.progress.clone(),
                    (
                        job.kind.clone(),
                        job.label.clone(),
                        job.source.clone(),
                        job.args.clone(),
                        job.created_at,
                        job.started_at,
                        job.finished_at,
                        job.status,
                        job.exit_code,
                        job.cancelled,
                    ),
                ));
            }
        }
        // If we captured handles, build the record outside of the jobs lock to avoid deadlocks
        if let Some((
            stdout_arc,
            stderr_arc,
            artifacts_arc,
            progress_arc2,
            (
                kind,
                label,
                source,
                args_clone,
                created_at,
                started_at,
                finished_at,
                success_val,
                exit_code_val,
                cancelled_val,
            ),
        )) = captured
        {
            eprintln!(
                "[blossom] complete_job: building record outside lock id={}",
                id
            );
            let stdout = stdout_arc
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let stderr_lines = stderr_arc
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let artifacts = artifacts_arc
                .lock()
                .map(|items| items.clone())
                .unwrap_or_default();
            let progress = progress_arc2
                .lock()
                .map(|p| (*p).clone())
                .unwrap_or_default();
            maybe_record = Some(JobRecord {
                id,
                kind,
                label,
                source,
                args: args_clone,
                created_at,
                started_at,
                finished_at,
                success: success_val,
                exit_code: exit_code_val,
                stdout_excerpt: stdout,
                stderr_excerpt: stderr_lines,
                artifacts,
                progress,
                cancelled: cancelled_val,
            });
            eprintln!("[blossom] complete_job: record built id={}", id);
        }
        if let Some(record) = maybe_record {
            if persistence_enabled() {
                eprintln!("[blossom] complete_job: pushing history id={}", id);
                self.push_history(record);
                eprintln!("[blossom] complete_job: pushed history id={}", id);
            } else {
                eprintln!("[blossom] persistence disabled; skipping push_history");
            }
        }
        if let Some(snapshot) = progress_update {
            let event = ProgressEvent {
                stage: snapshot.stage.clone(),
                percent: snapshot.percent,
                message: snapshot.message.clone(),
                eta: snapshot.eta.clone(),
                step: snapshot.step,
                total: snapshot.total,
                queue_position: snapshot.queue_position,
                queue_eta_seconds: snapshot.queue_eta_seconds,
            };
            eprintln!("[blossom] complete_job: emitting final progress id={}", id);
            let _ = app.emit(&format!("progress::{}", id), event);
            eprintln!("[blossom] complete_job: emitted final progress id={}", id);
        }
        eprintln!("[blossom] complete_job: updating queue positions id={}", id);
        self.update_queue_positions(app);
        eprintln!("[blossom] complete_job finished for id={}", id);
    }

    fn cancel_job(&self, app: &AppHandle, job_id: u64) -> Result<(), String> {
        let mut child_to_kill: Option<Child> = None;
        let was_pending: bool;
        {
            let mut jobs = self.jobs.lock().unwrap();
            let job = jobs
                .get_mut(&job_id)
                .ok_or_else(|| "Unknown job_id".to_string())?;
            if job.status.is_some() || job.cancelled {
                return Err("Job already completed".into());
            }
            was_pending = job.pending;
            job.pending = false;
            job.cancelled = true;
            job.finished_at.get_or_insert_with(Utc::now);
            if !was_pending {
                let mut child_guard = job.child.lock().unwrap();
                if let Some(child) = child_guard.take() {
                    child_to_kill = Some(child);
                }
            }
        }
        if was_pending && self.remove_from_queue(job_id) {
            if persistence_enabled() {
                if let Err(err) = self.persist_queue() {
                    eprintln!("failed to persist job queue after cancellation: {}", err);
                }
            }
        }
        if let Some(mut child) = child_to_kill {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.complete_job(app, job_id, false, None, true);
        self.maybe_start_jobs(app);
        Ok(())
    }

    fn resume_pending(&self, app: &AppHandle) {
        self.update_queue_positions(app);
        self.maybe_start_jobs(app);
    }

    fn push_history(&self, record: JobRecord) {
        {
            let mut history = self.history.lock().unwrap();
            history.push_back(record);
            while history.len() > MAX_HISTORY {
                history.pop_front();
            }
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_history() {
                eprintln!("failed to persist job history: {}", err);
            }
        }
    }

    fn list_history(&self) -> Vec<JobRecord> {
        self.history.lock().unwrap().iter().cloned().collect()
    }

    fn prune_history(&self, retain: usize) {
        {
            let mut history = self.history.lock().unwrap();
            if retain == 0 {
                history.clear();
            } else if history.len() > retain {
                let drop = history.len() - retain;
                for _ in 0..drop {
                    history.pop_front();
                }
            }
        }
        if persistence_enabled() {
            if let Err(err) = self.persist_history() {
                eprintln!("failed to persist job history after prune: {}", err);
            }
        }
    }
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
fn list_presets() -> Result<Vec<String>, String> {
    list_from_dir(Path::new("assets/presets"))
}

#[tauri::command]
fn list_styles() -> Result<Vec<String>, String> {
    list_from_dir(Path::new("assets/styles"))
}

// Settings store accessor (shared with config.rs pattern)
fn settings_store(app: &AppHandle) -> Result<Arc<Store<tauri::Wry>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Unable to resolve app config directory".to_string())?
        .join("settings.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_section_tags(
    app: AppHandle,
    registry: State<'_, JobRegistry>,
    section: String,
) -> Result<TagUpdateSummary, String> {
    let trimmed = section.trim();
    let section_cfg = tag_section_map()
        .get(trimmed)
        .cloned()
        .ok_or_else(|| format!("Unknown tag section '{}'.", trimmed))?;

    let job_label = format!("D&D Tags · {}", section_cfg.label);
    let args = vec!["dnd:update_section_tags".into(), section_cfg.id.clone()];
    let context = JobContext {
        kind: Some("dnd_update_section_tags".into()),
        label: Some(job_label.clone()),
        source: Some("D&D".into()),
        artifact_candidates: Vec::new(),
    };
    let job_id = registry.next_id();
    let job = JobInfo::new_pending(args, &context);
    let initial_snapshot = JobProgressSnapshot {
        stage: Some("starting".into()),
        percent: Some(0),
        message: Some(format!("Preparing tag refresh for {}", section_cfg.label)),
        eta: None,
        step: None,
        total: None,
        queue_position: None,
        queue_eta_seconds: None,
    };
    registry.register_running_job(&app, job_id, job, initial_snapshot);

    let fail_job = |message: String| -> Result<TagUpdateSummary, String> {
        registry.append_job_stderr(job_id, &message);
        registry.update_job_progress(
            &app,
            job_id,
            JobProgressSnapshot {
                stage: Some("error".into()),
                percent: Some(100),
                message: Some(message.clone()),
                eta: None,
                step: None,
                total: None,
                queue_position: None,
                queue_eta_seconds: None,
            },
        );
        registry.complete_job(&app, job_id, false, Some(1), false);
        Err(message)
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    let default_base = dreadhaven_root();
    let default_candidate = join_relative_folder(&default_base, &section_cfg.relative_path);
    if !candidates.iter().any(|p| p == &default_candidate) {
        candidates.push(default_candidate);
    }
    for fallback in &section_cfg.fallbacks {
        let candidate = PathBuf::from(fallback);
        if !candidates.iter().any(|p| p == &candidate) {
            candidates.push(candidate);
        }
    }
    if candidates.is_empty() {
        return fail_job(format!(
            "No folder mapping configured for section '{}'. Ensure the DreadHaven directory exists at {}.",
            section_cfg.label,
            config::DEFAULT_DREADHAVEN_ROOT
        ));
    }

    let mut base_dir: Option<PathBuf> = None;
    for candidate in &candidates {
        if candidate.exists() && candidate.is_dir() {
            base_dir = Some(candidate.clone());
            break;
        }
    }
    let base_dir = match base_dir {
        Some(dir) => dir,
        None => {
            let searched = candidates
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            return fail_job(format!(
                "Folder for '{}' not found. Checked: {}.",
                section_cfg.label, searched
            ));
        }
    };

    let base_display = base_dir.to_string_lossy().to_string();
    registry.append_job_stdout(job_id, &format!("Scanning {}", base_display));
    let label = section_cfg.label.clone();

    let mut files: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&base_dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !matches!(ext.as_deref(), Some("md" | "markdown" | "mdx")) {
            continue;
        }
        if !section_cfg.includes.is_empty() {
            let rel = path.strip_prefix(&base_dir).unwrap_or(path);
            let rel_str = rel.to_string_lossy();
            if !section_cfg
                .includes
                .iter()
                .all(|needle| rel_str.contains(needle))
            {
                continue;
            }
        }
        files.push(path.to_path_buf());
    }
    files.sort();

    let total = files.len();
    let start = Instant::now();

    let queue_message = if total == 1 {
        "Processing 1 note.".to_string()
    } else {
        format!("Processing {} notes.", total)
    };
    registry.update_job_progress(
        &app,
        job_id,
        JobProgressSnapshot {
            stage: Some("running".into()),
            percent: Some(if total == 0 { 100 } else { 0 }),
            message: Some(queue_message.clone()),
            eta: None,
            step: Some(0),
            total: Some(total as u64),
            queue_position: None,
            queue_eta_seconds: None,
        },
    );
    emit_tag_event(
        &app,
        TagUpdateEvent {
            section: section_cfg.id.clone(),
            label: label.clone(),
            status: "started".into(),
            index: None,
            total: Some(total),
            rel_path: Some(base_display.clone()),
            tags: None,
            message: Some(queue_message),
            updated: None,
            skipped: None,
            failed: None,
        },
    );

    let mut updated_notes = 0usize;
    let mut skipped_notes = 0usize;
    let mut failed_notes = 0usize;

    for (index, path) in files.iter().enumerate() {
        let rel = relative_display(&base_dir, path);
        let percent_val = if total == 0 {
            100
        } else {
            (((index + 1) * 100) / total).min(100)
        };
        let running_percent = if percent_val >= 100 {
            99u8
        } else {
            percent_val as u8
        };
        registry.update_job_progress(
            &app,
            job_id,
            JobProgressSnapshot {
                stage: Some("running".into()),
                percent: Some(running_percent),
                message: Some(format!("{} ({}/{})", label, index + 1, total)),
                eta: None,
                step: Some((index + 1) as u64),
                total: Some(total as u64),
                queue_position: None,
                queue_eta_seconds: None,
            },
        );

        emit_tag_event(
            &app,
            TagUpdateEvent {
                section: section_cfg.id.clone(),
                label: label.clone(),
                status: "inspecting".into(),
                index: Some(index),
                total: Some(total),
                rel_path: Some(rel.clone()),
                tags: None,
                message: None,
                updated: None,
                skipped: None,
                failed: None,
            },
        );

        let file_text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(err) => {
                failed_notes += 1;
                let msg = format!("Failed to read file: {}", err);
                registry.append_job_stderr(job_id, &format!("{}: {}", rel, msg));
                emit_tag_event(
                    &app,
                    TagUpdateEvent {
                        section: section_cfg.id.clone(),
                        label: label.clone(),
                        status: "error".into(),
                        index: Some(index),
                        total: Some(total),
                        rel_path: Some(rel.clone()),
                        tags: None,
                        message: Some(msg),
                        updated: None,
                        skipped: None,
                        failed: None,
                    },
                );
                continue;
            }
        };

        let (mut mapping, body, raw_frontmatter) = match parse_frontmatter(&file_text) {
            Ok(parts) => parts,
            Err(err) => {
                failed_notes += 1;
                registry.append_job_stderr(job_id, &format!("{}: {}", rel, err));
                emit_tag_event(
                    &app,
                    TagUpdateEvent {
                        section: section_cfg.id.clone(),
                        label: label.clone(),
                        status: "error".into(),
                        index: Some(index),
                        total: Some(total),
                        rel_path: Some(rel.clone()),
                        tags: None,
                        message: Some(err),
                        updated: None,
                        skipped: None,
                        failed: None,
                    },
                );
                continue;
            }
        };

        let frontmatter_text = if raw_frontmatter.is_empty() {
            match serialize_frontmatter(&mapping) {
                Ok(s) => s,
                Err(err) => {
                    failed_notes += 1;
                    let msg = format!("Failed to serialize frontmatter: {}", err);
                    registry.append_job_stderr(job_id, &format!("{}: {}", rel, msg));
                    emit_tag_event(
                        &app,
                        TagUpdateEvent {
                            section: section_cfg.id.clone(),
                            label: label.clone(),
                            status: "error".into(),
                            index: Some(index),
                            total: Some(total),
                            rel_path: Some(rel.clone()),
                            tags: None,
                            message: Some(msg),
                            updated: None,
                            skipped: None,
                            failed: None,
                        },
                    );
                    continue;
                }
            }
        } else {
            raw_frontmatter.clone()
        };

        let existing_tags = extract_tags(&mapping);
        let existing_normalized = normalize_tags(&existing_tags);

        let canonical_line = if section_cfg.tags.is_empty() {
            "- Prefer concise, campaign-consistent tags.".to_string()
        } else {
            format!(
                "- Prioritize these canonical tags when relevant: {}.",
                section_cfg.tags.join(", ")
            )
        };
        let existing_line = if existing_normalized.is_empty() {
            "- Current tags: (none).".to_string()
        } else {
            format!("- Current tags: {}.", existing_normalized.join(", "))
        };

        let prompt = format!(
            "You refresh the YAML `tags` array for a Dungeons & Dragons knowledge base.\n\
Section: {label}\n\
File: {rel}\n\
Rules:\n\
- Output only a JSON array of lower-case kebab-case tags.\n\
- Keep relevant existing tags and remove ones no longer supported.\n\
{existing_line}\n\
{canonical_line}\n\
- Suggest new tags only when clearly supported by the content.\n\
\n\
Frontmatter:\n{frontmatter}\n---\nBody excerpt:\n{body}",
            label = label,
            rel = rel,
            existing_line = existing_line,
            canonical_line = canonical_line,
            frontmatter = clamp_text(&frontmatter_text, 1200),
            body = clamp_text(&body, 1500),
        );

        let system = "You return only compact JSON arrays of tags.";
        let response = match generate_llm(prompt, Some(system.to_string()), None, None).await {
            Ok(text) => text,
            Err(err) => {
                failed_notes += 1;
                let msg = format!("Model call failed: {}", err);
                registry.append_job_stderr(job_id, &format!("{}: {}", rel, msg));
                emit_tag_event(
                    &app,
                    TagUpdateEvent {
                        section: section_cfg.id.clone(),
                        label: label.clone(),
                        status: "error".into(),
                        index: Some(index),
                        total: Some(total),
                        rel_path: Some(rel.clone()),
                        tags: None,
                        message: Some(msg),
                        updated: None,
                        skipped: None,
                        failed: None,
                    },
                );
                continue;
            }
        };

        let candidate_tags = match parse_model_tags(&response) {
            Ok(tags) => tags,
            Err(err) => {
                failed_notes += 1;
                registry.append_job_stderr(job_id, &format!("{}: {}", rel, err));
                emit_tag_event(
                    &app,
                    TagUpdateEvent {
                        section: section_cfg.id.clone(),
                        label: label.clone(),
                        status: "error".into(),
                        index: Some(index),
                        total: Some(total),
                        rel_path: Some(rel.clone()),
                        tags: None,
                        message: Some(err),
                        updated: None,
                        skipped: None,
                        failed: None,
                    },
                );
                continue;
            }
        };

        let normalized = normalize_tags(&candidate_tags);
        if normalized.is_empty() {
            skipped_notes += 1;
            emit_tag_event(
                &app,
                TagUpdateEvent {
                    section: section_cfg.id.clone(),
                    label: label.clone(),
                    status: "skipped".into(),
                    index: Some(index),
                    total: Some(total),
                    rel_path: Some(rel.clone()),
                    tags: None,
                    message: Some(
                        "Model returned no tags; existing values were left unchanged.".into(),
                    ),
                    updated: None,
                    skipped: None,
                    failed: None,
                },
            );
            continue;
        }

        if normalized == existing_normalized {
            skipped_notes += 1;
            emit_tag_event(
                &app,
                TagUpdateEvent {
                    section: section_cfg.id.clone(),
                    label: label.clone(),
                    status: "skipped".into(),
                    index: Some(index),
                    total: Some(total),
                    rel_path: Some(rel.clone()),
                    tags: None,
                    message: Some("Tags already up to date.".into()),
                    updated: None,
                    skipped: None,
                    failed: None,
                },
            );
            continue;
        }

        let yaml_tags: Vec<YamlValue> = normalized
            .iter()
            .map(|tag| YamlValue::String(tag.clone()))
            .collect();
        mapping.insert(
            YamlValue::String("tags".to_string()),
            YamlValue::Sequence(yaml_tags),
        );

        let serialized = match serialize_frontmatter(&mapping) {
            Ok(s) => s,
            Err(err) => {
                failed_notes += 1;
                let msg = format!("Failed to serialize updated frontmatter: {}", err);
                registry.append_job_stderr(job_id, &format!("{}: {}", rel, msg));
                emit_tag_event(
                    &app,
                    TagUpdateEvent {
                        section: section_cfg.id.clone(),
                        label: label.clone(),
                        status: "error".into(),
                        index: Some(index),
                        total: Some(total),
                        rel_path: Some(rel.clone()),
                        tags: None,
                        message: Some(msg),
                        updated: None,
                        skipped: None,
                        failed: None,
                    },
                );
                continue;
            }
        };

        let mut new_content = String::with_capacity(serialized.len() + body.len() + 8);
        new_content.push_str("---\n");
        new_content.push_str(&serialized);
        new_content.push_str("---\n");
        new_content.push_str(&body);

        if let Err(err) = fs::write(path, new_content) {
            failed_notes += 1;
            let msg = format!("Failed to write file: {}", err);
            registry.append_job_stderr(job_id, &format!("{}: {}", rel, msg));
            emit_tag_event(
                &app,
                TagUpdateEvent {
                    section: section_cfg.id.clone(),
                    label: label.clone(),
                    status: "error".into(),
                    index: Some(index),
                    total: Some(total),
                    rel_path: Some(rel.clone()),
                    tags: Some(normalized.clone()),
                    message: Some(msg),
                    updated: None,
                    skipped: None,
                    failed: None,
                },
            );
            continue;
        }

        updated_notes += 1;
        emit_tag_event(
            &app,
            TagUpdateEvent {
                section: section_cfg.id.clone(),
                label: label.clone(),
                status: "updated".into(),
                index: Some(index),
                total: Some(total),
                rel_path: Some(rel),
                tags: Some(normalized),
                message: None,
                updated: None,
                skipped: None,
                failed: None,
            },
        );
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    emit_tag_event(
        &app,
        TagUpdateEvent {
            section: section_cfg.id.clone(),
            label: label.clone(),
            status: "finished".into(),
            index: None,
            total: Some(total),
            rel_path: Some(base_display.clone()),
            tags: None,
            message: Some("Tag refresh complete.".into()),
            updated: Some(updated_notes),
            skipped: Some(skipped_notes),
            failed: Some(failed_notes),
        },
    );

    registry.append_job_stdout(
        job_id,
        &format!(
            "Processed {} notes · updated {}, skipped {}, failed {} · {:.1}s",
            total,
            updated_notes,
            skipped_notes,
            failed_notes,
            duration_ms as f32 / 1000.0
        ),
    );
    registry.complete_job(&app, job_id, true, Some(0), false);

    Ok(TagUpdateSummary {
        section: section_cfg.id,
        label,
        base_path: base_display,
        total_notes: total,
        updated_notes,
        skipped_notes,
        failed_notes,
        duration_ms,
    })
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct InboxItem {
    path: String,
    name: String,
    title: String,
    size: u64,
    modified_ms: i64,
    preview: Option<String>,
    #[serde(default)]
    markers: Vec<String>,
}

#[derive(Deserialize)]
struct InboxMoveArgs {
    path: String,
    target: String,
    title: Option<String>,
    tags: Option<Vec<String>>,
    frontmatter: Option<HashMap<String, String>>,
    content: Option<String>,
}

struct InboxMoveConfig {
    relative_dir: &'static str,
    default_type: &'static str,
    default_tags: &'static [&'static str],
    ensure_id: bool,
}

fn inbox_move_config(target: &str) -> Option<InboxMoveConfig> {
    match target {
        "npc" => Some(InboxMoveConfig {
            relative_dir: "20_DM/NPC",
            default_type: "npc",
            default_tags: &["npc"],
            ensure_id: true,
        }),
        "lore" => Some(InboxMoveConfig {
            relative_dir: "10_Lore",
            default_type: "lore",
            default_tags: &["lore"],
            ensure_id: false,
        }),
        "quest" => Some(InboxMoveConfig {
            relative_dir: "20_DM/Quests",
            default_type: "quest",
            default_tags: &["quest"],
            ensure_id: false,
        }),
        "faction" => Some(InboxMoveConfig {
            relative_dir: "10_World/Factions",
            default_type: "faction",
            default_tags: &["faction"],
            ensure_id: false,
        }),
        "location" => Some(InboxMoveConfig {
            relative_dir: "10_World/Regions",
            default_type: "loc",
            default_tags: &["location"],
            ensure_id: false,
        }),
        "session" => Some(InboxMoveConfig {
            relative_dir: "20_DM/Sessions",
            default_type: "session",
            default_tags: &["session"],
            ensure_id: false,
        }),
        _ => None,
    }
}

fn collect_existing_npc_ids(base_dir: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    if !base_dir.exists() {
        return ids;
    }
    for entry in WalkDir::new(base_dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_markdown = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("md"))
            .unwrap_or(false);
        if !is_markdown {
            continue;
        }
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok((mapping, _body, _raw)) = parse_frontmatter(&text) {
                let key = YamlValue::String("id".to_string());
                if let Some(YamlValue::String(id)) = mapping.get(&key) {
                    let trimmed = id.trim();
                    if !trimmed.is_empty() {
                        ids.insert(trimmed.to_string());
                    }
                }
            }
        }
    }
    ids
}

fn sanitize_file_stem(name: &str, fallback: &str) -> String {
    fn normalize(value: &str) -> String {
        let cleaned: String = value
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let trimmed = cleaned.trim().replace(' ', "_");
        let mut limited: String = trimmed.chars().take(120).collect();
        // Remove any lingering leading or trailing dots that might have slipped through
        // (for instance, when sanitizing stems derived from file names).
        limited = limited.trim_matches('.').to_string();
        limited
    }

    let primary = normalize(name);
    if primary.is_empty() {
        let fallback = normalize(fallback);
        if fallback.is_empty() {
            "loop".to_string()
        } else {
            fallback
        }
    } else {
        primary
    }
}

fn read_first_paragraph(text: &str, max_len: usize) -> Option<String> {
    let norm = text.replace("\r\n", "\n");
    let mut parts = norm.splitn(2, "\n\n");
    let first = parts.next().unwrap_or("").trim();
    if first.is_empty() {
        return None;
    }
    let snippet = if first.len() > max_len {
        let mut s = first[..max_len].to_string();
        s.push_str("...");
        s
    } else {
        first.to_string()
    };
    Some(snippet)
}

fn detect_inbox_markers(text: &str) -> Vec<String> {
    let mut markers = Vec::new();
    if text.contains("![[") {
        markers.push("embed".to_string());
    }
    if text.contains("```") {
        markers.push("code".to_string());
    }
    if text.contains("http://") || text.contains("https://") {
        markers.push("link".to_string());
    }
    markers
}

#[tauri::command]
fn inbox_list(_app: AppHandle, path: Option<String>) -> Result<Vec<InboxItem>, String> {
    // Resolve base path: explicit param > vaultPath + 00_Inbox
    let base_dir = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else {
        dreadhaven_root().join("00_Inbox")
    };

    if !base_dir.exists() {
        return Err(format!(
            "Inbox folder does not exist: {}",
            base_dir.to_string_lossy()
        ));
    }
    if !base_dir.is_dir() {
        return Err(format!(
            "Inbox path is not a directory: {}",
            base_dir.to_string_lossy()
        ));
    }

    let mut items: Vec<InboxItem> = Vec::new();
    for entry in fs::read_dir(&base_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&name)
            .to_string();
        let size = meta.len();
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|e| {
                // Convert to an approximate ms since now - elapsed
                let now = Utc::now();
                let ago =
                    ChronoDuration::from_std(e).unwrap_or_else(|_| ChronoDuration::seconds(0));
                (now - ago).timestamp_millis()
            })
            .unwrap_or_else(|| Utc::now().timestamp_millis());

        // Try to read small preview and detect lightweight markers
        let (preview, markers) = if let Ok(text) = fs::read_to_string(&path) {
            let preview = read_first_paragraph(&text, 280);
            let markers = detect_inbox_markers(&text);
            (preview, markers)
        } else {
            (None, Vec::new())
        };

        items.push(InboxItem {
            path: path.to_string_lossy().to_string(),
            name,
            title,
            size,
            modified_ms,
            preview,
            markers,
        });
    }

    // Sort by modified desc, then name
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
    Ok(items)
}

#[tauri::command]
async fn npc_create(
    app: AppHandle,
    npc_id: String,
    name: String,
    region: Option<String>,
    purpose: Option<String>,
    template: Option<String>,
    random_name: Option<bool>,
    establishment_path: Option<String>,
    establishment_name: Option<String>,
) -> Result<String, String> {
    let npc_id = npc_id.trim().to_string();
    if !is_valid_npc_id(&npc_id) {
        return Err("Invalid NPC id".to_string());
    }
    let establishment_path = establishment_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let establishment_name = establishment_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    eprintln!(
        "[blossom] npc_create: start id='{}', name='{}', region={:?}, purpose={:?}, template={:?}, establishment_path={:?}, establishment_name={:?}",
        npc_id,
        name,
        &region,
        &purpose,
        &template,
        &establishment_path,
        &establishment_name
    );
    // Resolve NPC base directory
    let vault_root = dreadhaven_root();
    let base_dir = vault_root.join("20_DM").join("NPC");
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    }

    // Build target directory from region (can be nested like "Bree/Inn")
    let mut target_dir = base_dir.clone();
    if let Some(r) = region.and_then(|s| if s.trim().is_empty() { None } else { Some(s) }) {
        for part in r.replace("\\", "/").split('/') {
            if part.trim().is_empty() {
                continue;
            }
            target_dir = target_dir.join(part);
        }
    }
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    // Safe filename
    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    fname = fname.trim().to_string();
    if fname.is_empty() {
        fname = "New_NPC".to_string();
    }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }

    // Resolve template path and load text (tolerant of spaces and variants)
    eprintln!("[blossom] npc_create: resolving template path");
    let default_template_a = r"D:\\Documents\\DreadHaven\\_Templates\\NPC Template.md".to_string();
    let default_template_b = r"D:\\Documents\\DreadHaven\\_Templates\\NPC_Template.md".to_string();
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut tried: Vec<String> = Vec::new();
    if let Some(mut s) = template {
        let mut ch = s.chars();
        if let (Some(d), Some(sep)) = (ch.next(), ch.next()) {
            if d.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", d, rest);
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() {
            candidates.push(p);
        }
        candidates.push(vault_root.join("_Templates").join(&s));
        candidates.push(vault_root.join(&s));
    }
    candidates.push(vault_root.join("_Templates").join("NPC Template.md"));
    candidates.push(vault_root.join("_Templates").join("NPC_Template.md"));
    candidates.push(PathBuf::from(&default_template_a));
    candidates.push(PathBuf::from(&default_template_b));
    let mut template_text: Option<String> = None;
    for cand in candidates {
        let s = cand.to_string_lossy().to_string();
        tried.push(s.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => {
                template_text = Some(t);
                break;
            }
            Err(_) => {}
        }
    }
    let current_date = Utc::now().format("%Y-%m-%d").to_string();
    let location_str = target_dir
        .strip_prefix(&base_dir)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
        .replace('\\', "/");
    let purpose_str = purpose.unwrap_or_default();
    let use_random_name = random_name.unwrap_or(false) || name.trim().is_empty();

    // Build LLM prompt using template (or a fallback structure)
    let tpl = template_text.unwrap_or_else(|| {
        String::from("---\nTitle: {{NAME}}\nLocation: {{LOCATION}}\nPurpose: {{PURPOSE}}\nDate: {{DATE}}\n---\n\n# {{NAME}}\n\n## Description\n\n## Personality\n\n## Goals\n\n## Hooks\n\n## Relationships\n\n## Secrets\n")
    });
    let prompt = if use_random_name {
        format!(
            "You are drafting a D&D NPC note. Using the TEMPLATE, fully populate it for an NPC appropriate to the location \"{location}\" with the role/purpose \"{purpose}\".\n\nRules:\n- Choose an evocative, setting-appropriate NPC name and set it consistently in all places ({{{{NAME}}}}, Title/frontmatter, headings).\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Fill placeholders with specific details grounded in the location and purpose.\n- Provide short but rich sections: appearance, personality, goals, plot hooks, relationships, and any relevant secrets.\n- Avoid game-legal OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown.\n\nTEMPLATE:\n```\n{template}\n```",
            location = location_str,
            purpose = purpose_str,
            template = tpl
        )
    } else {
        format!(
            "You are drafting a D&D NPC note. Using the TEMPLATE, fully populate it for an NPC named \"{name}\". The NPC is located in \"{location}\" and has the role/purpose \"{purpose}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Fill placeholders with evocative, specific details grounded in the location and purpose.\n- Provide short but rich sections: appearance, personality, goals, plot hooks, relationships, and any relevant secrets.\n- Avoid game-legal OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown.\n\nTEMPLATE:\n```\n{template}\n```",
            name = name,
            location = location_str,
            purpose = purpose_str,
            template = tpl
        )
    };
    let system = Some(String::from("You are a helpful worldbuilding assistant. Produce clean, cohesive Markdown. Keep a grounded tone; avoid overpowered traits."));
    eprintln!("[blossom] npc_create: invoking LLM generation (ollama)");
    let content = generate_llm(prompt, system, None, None).await?;
    let mut content = strip_code_fence(&content).to_string();
    content = content.replace("{{DATE}}", &current_date);

    if establishment_path.is_some() || establishment_name.is_some() {
        content = add_establishment_metadata(
            &content,
            establishment_path.as_deref(),
            establishment_name.as_deref(),
        );
    }

    // Determine filename
    fn extract_title(src: &str) -> Option<String> {
        let s = src.replace("\r\n", "\n");
        if s.starts_with("---\n") {
            if let Some(end) = s[4..].find("\n---") {
                // position of closing
                let body = &s[4..4 + end];
                for line in body.lines() {
                    let ln = line.trim();
                    let lower = ln.to_ascii_lowercase();
                    if lower.starts_with("title:") {
                        return Some(ln.splitn(2, ':').nth(1).unwrap_or("").trim().to_string());
                    }
                    if lower.starts_with("name:") {
                        return Some(ln.splitn(2, ':').nth(1).unwrap_or("").trim().to_string());
                    }
                }
            }
        }
        for line in s.lines() {
            let ln = line.trim();
            if let Some(rest) = ln.strip_prefix('#') {
                let rest = rest.trim_start_matches('#').trim();
                if !rest.is_empty() {
                    return Some(rest.to_string());
                }
            }
        }
        None
    }

    let initial_name = if use_random_name {
        extract_title(&content).unwrap_or_else(|| "New_NPC".to_string())
    } else {
        name.clone()
    };

    // Ensure frontmatter exists and enforce NPC metadata + sane title
    fn ensure_npc_metadata(src: &str, npc_name: &str, npc_id: &str) -> String {
        match parse_frontmatter(src) {
            Ok((mut mapping, body, _raw)) => {
                // Set required keys
                upsert_frontmatter_string(&mut mapping, "type", Some("npc"));
                upsert_frontmatter_string(&mut mapping, "name", Some(npc_name));
                upsert_frontmatter_string(&mut mapping, "title", Some(npc_name));
                upsert_frontmatter_string(&mut mapping, "id", Some(npc_id));

                // Build a simple, single-line frontmatter block the UI parser understands
                let mut front = String::new();
                let mut push_kv = |k: &str, v: String| {
                    if v.trim().is_empty() {
                        return;
                    }
                    front.push_str(k);
                    front.push_str(": ");
                    front.push_str(&v);
                    front.push('\n');
                };
                // Required first
                push_kv("id", npc_id.to_string());
                push_kv("title", npc_name.to_string());
                push_kv("name", npc_name.to_string());
                push_kv("type", "npc".to_string());
                // Helpful extras if present and scalar
                let scalar = |key: &str| -> Option<String> {
                    let k = YamlValue::String(key.to_string());
                    mapping.get(&k).and_then(|v| match v {
                        YamlValue::String(s) => Some(s.clone()),
                        YamlValue::Number(n) => Some(n.to_string()),
                        YamlValue::Bool(b) => Some(if *b { "true" } else { "false" }.to_string()),
                        _ => None,
                    })
                };
                for key in [
                    "region",
                    "location",
                    "role",
                    "occupation",
                    "faction",
                    "race",
                    "gender",
                    "age",
                    "alignment",
                    "residence",
                    "voice",
                    "attitude",
                    "archetype",
                    "goals",
                    "fears",
                    "motives",
                    "secrets",
                ] {
                    if let Some(val) = scalar(key) {
                        push_kv(key, val);
                    }
                }

                // Replace first markdown H1 with the NPC name to avoid template titles
                let mut rebuilt = String::new();
                rebuilt.push_str("---\n");
                rebuilt.push_str(&front);
                rebuilt.push_str("---\n");
                // Build body with corrected heading and strip template banners/inline frontmatter remnants
                let scan_lines: Vec<&str> = body.split('\n').collect();
                // Drop leading lines that look like template banners or one-line frontmatter
                let mut start_idx = 0usize;
                while start_idx < scan_lines.len() {
                    let lt = scan_lines[start_idx].trim();
                    let low = lt.to_ascii_lowercase();
                    let is_banner = low.contains("npc template")
                        || low.contains("ultimate npc template")
                        || lt.starts_with('📜');
                    let is_inline_fm =
                        lt.starts_with("---") && lt.ends_with("---") && !lt.contains('\n');
                    if lt.is_empty() || is_banner || is_inline_fm {
                        start_idx += 1;
                        continue;
                    }
                    break;
                }
                let cleaned_body = scan_lines[start_idx..].join("\n");
                let mut body_lines: Vec<&str> = cleaned_body.split('\n').collect();
                let mut replaced = false;
                for i in 0..body_lines.len() {
                    let line_trim = body_lines[i].trim_start();
                    if line_trim.starts_with('#') {
                        body_lines[i] = ""; // placeholder; we'll reconstruct below
                        let mut out = String::new();
                        out.push_str("# ");
                        out.push_str(npc_name);
                        // Append the remainder of the original body after this line
                        let tail = body_lines[i + 1..].join("\n");
                        let mut final_body = out;
                        final_body.push('\n');
                        final_body.push_str(&tail);
                        rebuilt.push_str(&final_body);
                        replaced = true;
                        break;
                    }
                }
                if !replaced {
                    // Prepend heading when no existing H1 was found
                    let mut out = String::new();
                    out.push_str("# ");
                    out.push_str(npc_name);
                    out.push('\n');
                    out.push_str(&cleaned_body);
                    rebuilt.push_str(&out);
                }
                rebuilt
            }
            Err(_) => src.to_string(),
        }
    }
    content = ensure_npc_metadata(&content, &initial_name, &npc_id);

    // Re-extract the final NPC name from updated content/frontmatter
    let effective_name = match parse_frontmatter(&content) {
        Ok((mapping, _body, _raw)) => {
            let key = |k: &str| {
                mapping
                    .get(&YamlValue::String(k.to_string()))
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
            };
            key("name")
                .or_else(|| key("title"))
                .unwrap_or_else(|| initial_name.clone())
        }
        Err(_) => extract_title(&content).unwrap_or_else(|| initial_name.clone()),
    };

    // Safe filename and unique path
    let mut fname = effective_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    fname = fname.trim().to_string();
    if fname.is_empty() {
        fname = "New_NPC".to_string();
    }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }

    fs::write(&target, content.as_bytes()).map_err(|e| e.to_string())?;
    eprintln!("[blossom] npc_create: wrote '{}'", target.to_string_lossy());
    match read_npcs(&app) {
        Ok(mut npcs) => {
            let mut found = false;
            for npc in &mut npcs {
                if npc.id == npc_id {
                    npc.name = effective_name.clone();
                    found = true;
                    break;
                }
            }
            if !found {
                npcs.push(Npc {
                    id: npc_id.clone(),
                    name: effective_name.clone(),
                    description: String::new(),
                    prompt: String::new(),
                    voice: String::new(),
                });
            }
            if let Err(err) = write_npcs(&app, &npcs) {
                eprintln!(
                    "[blossom] npc_create: failed to persist NPC index for '{}': {}",
                    npc_id, err
                );
            }
        }
        Err(err) => {
            eprintln!(
                "[blossom] npc_create: failed to load existing NPC index for '{}': {}",
                npc_id, err
            );
        }
    }
    Ok(target.to_string_lossy().to_string())
}
#[tauri::command]
fn inbox_read(path: String) -> Result<String, String> {
    let p = PathBuf::from(path);
    if !p.exists() || !p.is_file() {
        return Err("File not found".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RiffusionJobRequest {
    prompt: Option<String>,
    negative: Option<String>,
    preset: Option<String>,
    seed: Option<i64>,
    steps: Option<u32>,
    guidance: Option<f32>,
    duration: Option<f32>,
    crossfade_secs: Option<f32>,
    output_dir: Option<String>,
    output_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RiffusionSoundscapeJobRequest {
    preset: Option<String>,
    duration: Option<f32>,
    seed: Option<i64>,
    steps: Option<u32>,
    guidance: Option<f32>,
    crossfade_secs: Option<f32>,
    output_dir: Option<String>,
    output_name: Option<String>,
}

#[tauri::command]
fn inbox_update(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_file() {
        return Err("File not found".into());
    }
    fs::write(&p, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn inbox_delete(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_file() {
        return Err("File not found".into());
    }
    fs::remove_file(&p).map_err(|e| e.to_string())
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct DirEntryItem {
    path: String,
    name: String,
    is_dir: bool,
    size: Option<u64>,
    modified_ms: i64,
}

#[tauri::command]
fn dir_list(path: String) -> Result<Vec<DirEntryItem>, String> {
    let base = PathBuf::from(&path);
    if !base.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !base.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut items: Vec<DirEntryItem> = Vec::new();
    for entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let name = match p.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|e| {
                let now = Utc::now();
                let ago =
                    ChronoDuration::from_std(e).unwrap_or_else(|_| ChronoDuration::seconds(0));
                (now - ago).timestamp_millis()
            })
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let size = if is_dir { None } else { Some(meta.len()) };
        items.push(DirEntryItem {
            path: p.to_string_lossy().to_string(),
            name,
            is_dir,
            size,
            modified_ms,
        });
    }
    // Sort: directories first by name, then files by name
    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(items)
}

const DEFAULT_PLAYER_TEMPLATE: &str = r"---
Title: {{NAME}}
Class: {{CLASS}}
Level: {{LEVEL}}
Background: {{BACKGROUND}}
Player: {{PLAYER}}
Race: {{RACE}}
Alignment: {{ALIGNMENT}}
Experience: {{EXPERIENCE}}
Date: {{DATE}}
---

# {{NAME}}

{{PLAYER_SHEET}}
";

fn normalize_windows_path(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.len() >= 2 {
        let mut chars = trimmed.chars();
        if let (Some(drive), Some(sep)) = (chars.next(), chars.next()) {
            if drive.is_ascii_alphabetic() && sep == '\\' && !trimmed.contains(":\\") {
                let rest: String = trimmed.chars().skip(2).collect();
                return format!("{}:\\{}", drive, rest);
            }
        }
    }
    trimmed.to_string()
}

fn merge_player_template(
    template: &str,
    sheet_markdown: &str,
    replacements: &[(String, String)],
) -> String {
    let mut output = template.to_string();
    for (key, value) in replacements {
        let token = format!("{{{{{}}}}}", key);
        output = output.replace(&token, value);
    }
    let trimmed_sheet = sheet_markdown.trim();
    if output.contains("{{PLAYER_SHEET}}") {
        output = output.replace("{{PLAYER_SHEET}}", trimmed_sheet);
    } else if output.contains("{{CHARACTER_SHEET}}") {
        output = output.replace("{{CHARACTER_SHEET}}", trimmed_sheet);
    } else if output.contains("{{SHEET}}") {
        output = output.replace("{{SHEET}}", trimmed_sheet);
    } else {
        if !output.ends_with('\n') {
            output.push('\n');
        }
        output.push('\n');
        output.push_str(trimmed_sheet);
        output.push('\n');
    }
    output
}

fn extract_sheet_string(sheet: &Value, path: &[&str]) -> Option<String> {
    let mut current = sheet;
    for key in path {
        current = match current.get(*key) {
            Some(v) => v,
            None => return None,
        };
    }
    match current {
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(if *b { "true" } else { "false" }.to_string()),
        _ => None,
    }
}

#[tauri::command]
fn inbox_create(
    _app: AppHandle,
    name: String,
    content: Option<String>,
    base_path: Option<String>,
) -> Result<String, String> {
    // Determine target directory: explicit base_path > vault/00_Inbox
    let target_dir = if let Some(p) = base_path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else {
        dreadhaven_root().join("00_Inbox")
    };
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    // Build a safe filename
    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() {
        fname = "New_Note".to_string();
    }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }
    let body = content.unwrap_or_default();
    fs::write(&target, body.as_bytes()).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn inbox_move_to(_app: AppHandle, args: InboxMoveArgs) -> Result<String, String> {
    let target_original = args.target.clone();
    let normalized_target = target_original.trim().to_ascii_lowercase();
    if normalized_target.is_empty() {
        return Err("Inbox target is required".to_string());
    }
    let config = inbox_move_config(&normalized_target)
        .ok_or_else(|| format!("Unsupported inbox target: {}", target_original))?;

    let source_path_str = args.path.clone();
    let trimmed_path = source_path_str.trim();
    if trimmed_path.is_empty() {
        return Err("Inbox path is required".to_string());
    }
    let source_path = PathBuf::from(trimmed_path);
    if !source_path.exists() {
        return Err(format!("Inbox file not found: {}", trimmed_path));
    }

    let InboxMoveArgs {
        path: _,
        target: _,
        title,
        tags,
        frontmatter,
        content,
    } = args;

    let vault_root = dreadhaven_root();
    let destination_base = join_relative_folder(&vault_root, config.relative_dir);
    if !destination_base.exists() {
        fs::create_dir_all(&destination_base)
            .map_err(|e| format!("Failed to create destination folder: {}", e))?;
    }

    let raw_content = match content {
        Some(body) => body,
        None => fs::read_to_string(&source_path)
            .map_err(|e| format!("Failed to read inbox note: {}", e))?,
    };

    let (mut mapping, body, _raw_frontmatter) =
        parse_frontmatter(&raw_content).map_err(|e| format!("{}", e))?;

    let fallback_title = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Converted_Note")
        .to_string();

    let desired_title = title
        .and_then(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .or_else(|| {
            let key = YamlValue::String("title".to_string());
            mapping
                .get(&key)
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            let key = YamlValue::String("name".to_string());
            mapping
                .get(&key)
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            let normalized = body.replace("\r\n", "\n");
            for line in normalized.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') {
                    let mut chars = trimmed.chars();
                    while let Some(ch) = chars.next() {
                        if ch != '#' {
                            let rest: String = std::iter::once(ch).chain(chars).collect();
                            let candidate = rest.trim();
                            if !candidate.is_empty() {
                                return Some(candidate.to_string());
                            }
                            break;
                        }
                    }
                }
            }
            None
        })
        .unwrap_or(fallback_title);

    if let Some(extra) = frontmatter {
        for (key, value) in extra {
            let trimmed_key = key.trim();
            if trimmed_key.is_empty() {
                continue;
            }
            let trimmed_value = value.trim();
            if trimmed_value.is_empty() {
                upsert_frontmatter_string(&mut mapping, trimmed_key, None);
            } else {
                upsert_frontmatter_string(&mut mapping, trimmed_key, Some(trimmed_value));
            }
        }
    }

    upsert_frontmatter_string(&mut mapping, "type", Some(config.default_type));
    upsert_frontmatter_string(&mut mapping, "title", Some(&desired_title));
    upsert_frontmatter_string(&mut mapping, "name", Some(&desired_title));

    if config.ensure_id {
        let mut existing_ids = collect_existing_npc_ids(&destination_base);
        let key = YamlValue::String("id".to_string());
        let mut current_id = mapping
            .get(&key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(ref id) = current_id {
            if !is_valid_npc_id(id) {
                current_id = None;
            }
        }
        let final_id = if let Some(id) = current_id {
            id
        } else {
            generate_unique_npc_id(&desired_title, &mut existing_ids)
        };
        upsert_frontmatter_string(&mut mapping, "id", Some(&final_id));
    }

    let tags_key = YamlValue::String("tags".to_string());
    let mut collected_tags: Vec<String> = Vec::new();
    if let Some(value) = mapping.get(&tags_key) {
        match value {
            YamlValue::Sequence(seq) => {
                for entry in seq {
                    if let Some(s) = entry.as_str() {
                        let trimmed = s.trim();
                        if !trimmed.is_empty() {
                            collected_tags.push(trimmed.to_string());
                        }
                    }
                }
            }
            YamlValue::String(s) => {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    collected_tags.push(trimmed.to_string());
                }
            }
            _ => {}
        }
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut final_tags: Vec<String> = Vec::new();
    let mut push_tag = |tag: &str| {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            return;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            final_tags.push(trimmed.to_string());
        }
    };

    for tag in collected_tags.iter() {
        push_tag(tag);
    }
    for &tag in config.default_tags.iter() {
        push_tag(tag);
    }
    if let Some(extra_tags) = tags {
        for tag in extra_tags {
            push_tag(&tag);
        }
    }

    if final_tags.is_empty() {
        mapping.remove(&tags_key);
    } else {
        let sequence: Vec<YamlValue> = final_tags
            .into_iter()
            .map(|tag| YamlValue::String(tag))
            .collect();
        mapping.insert(tags_key, YamlValue::Sequence(sequence));
    }

    let frontmatter_src = serialize_frontmatter(&mapping)?;
    let mut rebuilt = String::new();
    rebuilt.push_str("---\n");
    rebuilt.push_str(&frontmatter_src);
    rebuilt.push_str("---\n");
    if !body.is_empty() {
        if !body.starts_with('\n') {
            rebuilt.push('\n');
        }
        rebuilt.push_str(&body);
    }

    let mut stem = sanitize_file_stem(&desired_title, "Converted_Note");
    if stem.is_empty() {
        stem = "Converted_Note".to_string();
    }
    let mut target_path = destination_base.join(format!("{}.md", stem));
    let mut counter: u32 = 2;
    while target_path.exists() {
        target_path = destination_base.join(format!("{}_{}.md", stem, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }

    fs::write(&target_path, rebuilt.as_bytes())
        .map_err(|e| format!("Failed to write converted note: {}", e))?;

    fs::remove_file(&source_path)
        .map_err(|e| format!("Failed to delete original inbox note: {}", e))?;

    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
fn npc_save_portrait(
    _app: AppHandle,
    name: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let base_dir = dreadhaven_root()
        .join("30_Assets")
        .join("Images")
        .join("NPC_Portraits");
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    }
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    fname = fname.trim().replace(' ', "_");
    if fname.is_empty() {
        fname = "Portrait".into();
    }
    let target = base_dir.join(format!("{}.{}", fname, ext));
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn god_save_portrait(
    _app: AppHandle,
    name: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let base_dir = dreadhaven_root()
        .join("30_Assets")
        .join("Images")
        .join("God_Portraits");
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    }
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    fname = fname.trim().replace(' ', "_");
    if fname.is_empty() {
        fname = "Portrait".into();
    }
    let target = base_dir.join(format!("{}.{}", fname, ext));
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}
#[tauri::command]
fn race_create(
    _app: AppHandle,
    name: String,
    template: Option<String>,
    directory: Option<String>,
    parent: Option<String>,
    use_llm: Option<bool>,
) -> Result<String, String> {
    eprintln!(
        "[races] race_create: name='{}' parent={:?} dir={:?} use_llm={:?}",
        name, parent, directory, use_llm
    );
    // Resolve vault base
    let vault_root = dreadhaven_root();

    let base_dir = vault_root.join("10_World").join("Races");
    eprintln!("[races] base_dir='{}'", base_dir.to_string_lossy());

    let resolve_relative = |base: &PathBuf, raw: &str| {
        let mut joined = base.clone();
        for part in raw.replace('\\', "/").split('/') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            joined.push(trimmed);
        }
        joined
    };

    let directory_override = directory
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));
    fn sanitize_filename(input: &str) -> String {
        let mut out = input
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim()
            .replace(' ', "_");
        if out.is_empty() {
            out = "New".into();
        }
        out
    }

    // Default foldering: vault/10_World/Races/<Race> for races; <Parent>/<Subrace> for subraces
    let default_folder = if let Some(ref base_name) = parent {
        sanitize_filename(base_name)
    } else {
        sanitize_filename(&name)
    };

    let target_dir = if let Some(ref override_path) = directory_override {
        let candidate = PathBuf::from(override_path);
        if candidate.is_absolute() {
            candidate
        } else {
            resolve_relative(&base_dir, override_path)
        }
    } else {
        base_dir.join(default_folder)
    };
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }
    eprintln!("[races] target_dir='{}'", target_dir.to_string_lossy());

    // Determine template candidates
    let template_override = template
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));
    let mut template_body: Option<String> = None;
    if let Some(ref path) = template_override {
        let candidate = PathBuf::from(path);
        if candidate.exists() && candidate.is_file() {
            template_body = fs::read_to_string(&candidate).ok();
            eprintln!(
                "[races] using template override file '{}'",
                candidate.to_string_lossy()
            );
        } else {
            let rel = resolve_relative(&vault_root, path);
            if rel.exists() && rel.is_file() {
                template_body = fs::read_to_string(rel.clone()).ok();
                eprintln!(
                    "[races] using template override (vault-relative) '{}'",
                    rel.to_string_lossy()
                );
            }
        }
    }
    let want_llm = use_llm.unwrap_or(true);
    eprintln!("[races] want_llm={}", want_llm);
    let body = if want_llm {
        let tpl = template_body.clone().unwrap_or_else(|| {
            format!(
"---\nTitle: {{NAME}}\nTags: race\n---\n\n# {{NAME}}\n\n## Ability Score Increases\n\n- \n\n## Size\n\n- \n\n## Speed\n\n- \n\n## Traits\n\n- \n\n## Languages\n\n- \n"
            )
        });
        let prompt = if let Some(parent_name) = parent.as_ref() {
            format!(
                "You are drafting a D&D race subrace note. Using the TEMPLATE, fully populate it for a subrace named \"{sub}\" of the parent race \"{base}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Replace all placeholders; do not leave any TODO/blank sections.\n- Fill with evocative, specific but balanced 5e-style features.\n- Include ASI, size, speed, traits, and languages.\n- Avoid copying OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown without extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
                sub = name,
                base = parent_name,
                template = tpl
            )
        } else {
            format!(
                "You are drafting a D&D race note. Using the TEMPLATE, fully populate it for a race named \"{race}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML/frontmatter as in the template.\n- Replace all placeholders; do not leave any TODO/blank sections.\n- Fill with evocative, specific but balanced 5e-style features.\n- Include ASI, size, speed, traits, and languages.\n- Avoid copying OGL text; keep it original and setting-agnostic.\n- Output only the completed markdown without extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
                race = name,
                template = tpl
            )
        };
        let system = Some(String::from(
            "You are a helpful worldbuilding assistant. Produce clean, cohesive Markdown and keep to the template headings.",
        ));
        eprintln!(
            "[races] invoking LLM to fill template for '{}' (parent={:?})",
            name, parent
        );
        let llm_content = tauri::async_runtime::block_on(async {
            generate_llm(prompt, system, None, None).await
        })
        .map_err(|e| e.to_string())?;
        let generated = strip_code_fence(&llm_content).to_string();
        eprintln!(
            "[races] LLM output len={} preview='{}'",
            generated.len(),
            generated
                .chars()
                .take(100)
                .collect::<String>()
                .replace('\n', " ")
        );
        generated
    } else if let Some(tpl) = template_body {
        eprintln!("[races] using template body without LLM for '{}'", name);
        tpl
    } else {
        format!(
"---\nTitle: {name}\nTags: race\n---\n\n# {name}\n\n## Ability Score Increases\n\n- \n\n## Size\n\n- \n\n## Speed\n\n- \n\n## Traits\n\n- \n\n## Languages\n\n- \n",
            name = name
        )
    };

    // Sanitize filename and ensure uniqueness
    let base_filename = sanitize_filename(&name);
    let mut fname = base_filename.clone();
    if fname.is_empty() {
        fname = "New_Race".into();
    }
    let mut target = target_dir.join(format!("{}.md", fname));
    let mut counter = 2u32;
    while target.exists() {
        target = target_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }
    fs::write(&target, body.as_bytes()).map_err(|e| e.to_string())?;
    eprintln!(
        "[races] wrote file '{}' ({} bytes)",
        target.to_string_lossy(),
        body.len()
    );
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn race_save_portrait(
    _app: AppHandle,
    race: String,
    subrace: Option<String>,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let base_dir = dreadhaven_root()
        .join("30_Assets")
        .join("Images")
        .join("Race_Portraits");
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    }

    fn sanitize(s: &str) -> String {
        let mut out = s
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        out = out.trim().replace(' ', "_");
        if out.is_empty() {
            out = "Portrait".into();
        }
        out
    }
    let race_clean = sanitize(&race);
    let sub_clean = subrace.as_deref().map(sanitize);
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let target_name = if let Some(sub) = sub_clean {
        format!("Portrait_{}_{}.{}", race_clean, sub, ext)
    } else {
        format!("Portrait_{}.{}", race_clean, ext)
    };
    let target = base_dir.join(target_name);
    fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
async fn player_create(
    app: AppHandle,
    name: String,
    markdown: String,
    sheet: Option<Value>,
    template: Option<String>,
    directory: Option<String>,
    use_prefill: Option<bool>,
    prefill_prompt: Option<String>,
) -> Result<String, String> {
    eprintln!(
        "[blossom] player_create: start name='{}', template={:?}, directory={:?}, use_prefill={:?}",
        name, template, directory, use_prefill
    );

    let store = settings_store(&app).map_err(|e| {
        eprintln!("[blossom] player_create: settings_store error: {}", e);
        e
    })?;
    let config_template = store
        .get("dndPlayerTemplate")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    let config_directory = store
        .get("dndPlayerDirectory")
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    let vault_root = dreadhaven_root();
    let base_dir = vault_root.join("20_DM").join("Players");

    let resolve_relative = |base: &PathBuf, raw: &str| {
        let mut joined = base.clone();
        for part in raw.replace('\\', "/").split('/') {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            joined.push(trimmed);
        }
        joined
    };

    let directory_override = directory
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));
    let config_directory_norm = config_directory
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));

    let players_dir = if let Some(ref override_path) = directory_override {
        let candidate = PathBuf::from(override_path);
        if candidate.is_absolute() {
            candidate
        } else {
            resolve_relative(&base_dir, override_path)
        }
    } else if let Some(ref config_path) = config_directory_norm {
        let candidate = PathBuf::from(config_path);
        if candidate.is_absolute() {
            candidate
        } else {
            resolve_relative(&base_dir, config_path)
        }
    } else {
        base_dir.clone()
    };

    if !players_dir.exists() {
        eprintln!(
            "[blossom] player_create: creating players_dir '{}'",
            players_dir.to_string_lossy()
        );
        fs::create_dir_all(&players_dir).map_err(|e| e.to_string())?;
    }

    let template_override = template
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));
    let config_template_norm = config_template
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| normalize_windows_path(s));

    let mut template_candidates: Vec<PathBuf> = Vec::new();
    let mut push_candidate = |raw: &str| {
        let pb = PathBuf::from(raw);
        if pb.is_absolute() {
            template_candidates.push(pb.clone());
        }
        template_candidates.push(vault_root.join("_Templates").join(raw));
        template_candidates.push(vault_root.join(raw));
        template_candidates.push(players_dir.join(raw));
    };

    if let Some(ref override_tpl) = template_override {
        push_candidate(override_tpl);
    }
    if let Some(ref config_tpl) = config_template_norm {
        push_candidate(config_tpl);
    }
    template_candidates.push(
        vault_root
            .join("_Templates")
            .join("Player Character Template.md"),
    );
    template_candidates.push(
        vault_root
            .join("_Templates")
            .join("PlayerCharacterTemplate.md"),
    );
    template_candidates.push(PathBuf::from(
        r"D:\\Documents\\DreadHaven\\_Templates\\Player Character Template.md",
    ));
    template_candidates.push(PathBuf::from(
        r"D:\\Documents\\DreadHaven\\_Templates\\PlayerCharacterTemplate.md",
    ));

    let mut template_text: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for cand in template_candidates {
        let cand_str = cand.to_string_lossy().to_string();
        if tried.contains(&cand_str) {
            continue;
        }
        tried.push(cand_str.clone());
        match fs::read_to_string(&cand) {
            Ok(content) => {
                eprintln!(
                    "[blossom] player_create: using template '{}' ({} bytes)",
                    cand_str,
                    content.len()
                );
                template_text = Some(content);
                break;
            }
            Err(err) => {
                last_err = Some(err.to_string());
            }
        }
    }
    let template_body = template_text.unwrap_or_else(|| {
        if let Some(err) = last_err {
            eprintln!(
                "[blossom] player_create: template fallback after error: {}",
                err
            );
        }
        DEFAULT_PLAYER_TEMPLATE.to_string()
    });

    let mut effective_name = name.trim().to_string();
    if effective_name.is_empty() {
        if let Some(ref sheet_val) = sheet {
            if let Some(sheet_name) = extract_sheet_string(sheet_val, &["identity", "name"]) {
                effective_name = sheet_name;
            }
        }
    }
    if effective_name.is_empty() {
        effective_name = "Adventurer".to_string();
    }

    let mut replacements: Vec<(String, String)> = Vec::new();
    replacements.push(("NAME".to_string(), effective_name.clone()));
    if let Some(ref sheet_val) = sheet {
        let fields = [
            ("CLASS", &["identity", "class"] as &[_]),
            ("LEVEL", &["identity", "level"]),
            ("BACKGROUND", &["identity", "background"]),
            ("PLAYER", &["identity", "playerName"]),
            ("RACE", &["identity", "race"]),
            ("ALIGNMENT", &["identity", "alignment"]),
            ("EXPERIENCE", &["identity", "experience"]),
        ];
        for (key, path) in fields {
            if let Some(value) = extract_sheet_string(sheet_val, path) {
                replacements.push((key.to_string(), value));
            }
        }
    }
    replacements.push((
        "DATE".to_string(),
        Utc::now().format("%Y-%m-%d").to_string(),
    ));

    let merged = merge_player_template(&template_body, &markdown, &replacements);

    let should_prefill = use_prefill.unwrap_or(false)
        || prefill_prompt
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

    let final_markdown = if should_prefill {
        let mut prompt = String::from(
            "You are a meticulous D&D 5e chronicler. Expand narrative sections such as personality, backstory, allies, and notes while keeping mechanical statistics unchanged."
        );
        if let Some(ref extra) = prefill_prompt {
            let trimmed = extra.trim();
            if !trimmed.is_empty() {
                prompt.push_str("\n\nAdditional guidance: ");
                prompt.push_str(trimmed);
            }
        }
        if let Some(ref sheet_val) = sheet {
            if let Ok(json_text) = serde_json::to_string_pretty(sheet_val) {
                prompt.push_str("\n\nCharacter data (JSON):\n```json\n");
                prompt.push_str(&json_text);
                prompt.push_str("\n```");
            }
        }
        prompt.push_str("\n\nCurrent character sheet:\n```\n");
        prompt.push_str(&merged);
        prompt.push_str("\n```");

        let system = Some(String::from(
            "You polish Markdown for tabletop RPG characters. Preserve YAML frontmatter and mechanical blocks. Only elaborate narrative sections when appropriate."
        ));
        eprintln!("[blossom] player_create: invoking LLM prefill");
        let llm_content = generate_llm(prompt, system, None, None).await?;
        strip_code_fence(&llm_content).to_string()
    } else {
        merged
    };

    let mut file_stem: String = effective_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if file_stem.is_empty() {
        file_stem = "Player".to_string();
    }

    let mut target = players_dir.join(format!("{}.md", file_stem));
    let mut counter = 2u32;
    while target.exists() {
        target = players_dir.join(format!("{}_{}.md", file_stem, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }

    fs::write(&target, final_markdown.as_bytes()).map_err(|e| {
        eprintln!(
            "[blossom] player_create: failed to write file '{}': {}",
            target.to_string_lossy(),
            e
        );
        e.to_string()
    })?;

    eprintln!(
        "[blossom] player_create: saved '{}'",
        target.to_string_lossy()
    );

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
async fn monster_create(
    _app: AppHandle,
    name: String,
    template: Option<String>,
) -> Result<String, String> {
    eprintln!(
        "[blossom] monster_create: start name='{}', template={:?}",
        name, template
    );

    // Determine Monsters directory
    let vault_root = dreadhaven_root();
    let monsters_dir = vault_root.join("20_DM").join("Monsters");
    eprintln!(
        "[blossom] monster_create: monsters_dir='{}'",
        monsters_dir.to_string_lossy()
    );
    if !monsters_dir.exists() {
        eprintln!("[blossom] monster_create: creating monsters_dir");
        fs::create_dir_all(&monsters_dir).map_err(|e| {
            eprintln!(
                "[blossom] monster_create: failed to create monsters_dir '{}': {}",
                monsters_dir.to_string_lossy(),
                e
            );
            e.to_string()
        })?;
    }

    // Resolve template path (be tolerant of malformed Windows paths and relative inputs)
    eprintln!("[blossom] monster_create: resolving template path");
    let default_template =
        r"D:\\Documents\\DreadHaven\\_Templates\\Monster Template + Universal (D&D 5e Statblock).md"
            .to_string();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(mut s) = template {
        eprintln!("[blossom] monster_create: raw template arg='{}'", s);
        // Fix a common Windows input: "D\\path" (missing ":") -> "D:\\path"
        let mut ch = s.chars();
        if let (Some(drive), Some(sep)) = (ch.next(), ch.next()) {
            if drive.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", drive, rest);
                eprintln!(
                    "[blossom] monster_create: normalized Windows path -> '{}'",
                    s
                );
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() {
            candidates.push(p);
        }
        candidates.push(vault_root.join("_Templates").join(&s));
        candidates.push(vault_root.join(&s));
    } else {
        candidates.push(PathBuf::from(&default_template));
    }
    // Always try the default last as a safety net
    candidates.push(PathBuf::from(&default_template));

    // Try candidates in order
    let mut template_text_opt: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for cand in candidates {
        let cand_str = cand.to_string_lossy().to_string();
        eprintln!(
            "[blossom] monster_create: trying template candidate '{}'",
            cand_str
        );
        tried.push(cand_str.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => {
                eprintln!(
                    "[blossom] monster_create: template selected '{}' ({} bytes)",
                    cand_str,
                    t.len()
                );
                template_text_opt = Some(t);
                break;
            }
            Err(e) => {
                eprintln!(
                    "[blossom] monster_create: candidate failed '{}': {}",
                    cand_str, e
                );
                last_err = Some(e.to_string());
            }
        }
    }
    let template_text = match template_text_opt {
        Some(t) => t,
        None => {
            let summary = tried.join("; ");
            let last = last_err.unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Failed to read template. Tried: {}. Last error: {}",
                summary, last
            ));
        }
    };

    // Build prompt for LLM
    let prompt = format!(
        "You are drafting a D&D 5e monster statblock. Using the TEMPLATE, fully populate it for a monster named \"{name}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML frontmatter.\n- Fill all placeholders with appropriate values.\n- Output only the completed markdown, no extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
        name = name,
        template = template_text
    );
    let system = Some(String::from(
        "You are a meticulous editor that outputs only valid Markdown and YAML frontmatter.\nInclude typical D&D 5e fields: type, size, alignment, AC, HP, speed, abilities, skills, senses, languages, CR, traits, actions. No OGL text.\n"
    ));
    eprintln!("[blossom] monster_create: invoking LLM generation");
    let content = match generate_llm(prompt, system, None, None).await {
        Ok(c) => {
            eprintln!("[blossom] monster_create: LLM returned ({} bytes)", c.len());
            c
        }
        Err(e) => {
            eprintln!("[blossom] monster_create: LLM generation failed: {}", e);
            return Err(e);
        }
    };
    let content = strip_code_fence(&content).to_string();

    // Build a safe file name
    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() {
        fname = "New_Monster".to_string();
    }
    let mut target = monsters_dir.join(format!("{}.md", fname));
    let mut counter = 2;
    while target.exists() {
        target = monsters_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }
    eprintln!(
        "[blossom] monster_create: writing file to '{}'",
        target.to_string_lossy()
    );

    fs::write(&target, content.as_bytes()).map_err(|e| {
        eprintln!(
            "[blossom] monster_create: failed to write file '{}': {}",
            target.to_string_lossy(),
            e
        );
        e.to_string()
    })?;
    eprintln!(
        "[blossom] monster_create: completed -> '{}'",
        target.to_string_lossy()
    );

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
async fn god_create(
    _app: AppHandle,
    name: String,
    template: Option<String>,
) -> Result<String, String> {
    eprintln!(
        "[blossom] god_create: start name='{}', template={:?}",
        name, template
    );

    let vault_root = dreadhaven_root();

    let gods_dir = vault_root.join("10_World").join("Gods of the Realm");
    eprintln!(
        "[blossom] god_create: gods_dir='{}'",
        gods_dir.to_string_lossy()
    );
    if !gods_dir.exists() {
        eprintln!("[blossom] god_create: creating gods_dir");
        fs::create_dir_all(&gods_dir).map_err(|e| {
            eprintln!(
                "[blossom] god_create: failed to create gods_dir '{}': {}",
                gods_dir.to_string_lossy(),
                e
            );
            e.to_string()
        })?;
    }

    eprintln!("[blossom] god_create: resolving template path");
    let default_template = r"D:\\Documents\\DreadHaven\\_Templates\\God_Template.md".to_string();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(mut s) = template {
        eprintln!("[blossom] god_create: raw template arg='{}'", s);
        let mut ch = s.chars();
        if let (Some(drive), Some(sep)) = (ch.next(), ch.next()) {
            if drive.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", drive, rest);
                eprintln!("[blossom] god_create: normalized Windows path -> '{}'", s);
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() {
            candidates.push(p);
        }
        candidates.push(vault_root.join("_Templates").join(&s));
        candidates.push(vault_root.join(&s));
    } else {
        candidates.push(PathBuf::from(&default_template));
    }
    candidates.push(PathBuf::from(&default_template));

    let mut template_text_opt: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for cand in candidates {
        let cand_str = cand.to_string_lossy().to_string();
        eprintln!(
            "[blossom] god_create: trying template candidate '{}'",
            cand_str
        );
        tried.push(cand_str.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => {
                eprintln!(
                    "[blossom] god_create: template selected '{}' ({} bytes)",
                    cand_str,
                    t.len()
                );
                template_text_opt = Some(t);
                break;
            }
            Err(e) => {
                eprintln!(
                    "[blossom] god_create: candidate failed '{}': {}",
                    cand_str, e
                );
                last_err = Some(e.to_string());
            }
        }
    }
    let template_text = match template_text_opt {
        Some(t) => t,
        None => {
            let summary = tried.join("; ");
            let last = last_err.unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Failed to read template. Tried: {}. Last error: {}",
                summary, last
            ));
        }
    };

    let prompt = format!(
        "You are drafting a D&D deity dossier. Using the TEMPLATE, fully populate it for a deity named \"{name}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML frontmatter.\n- Fill all placeholders with lore, domains, symbols, worshippers, and edicts.\n- Output only the completed markdown, no extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
        name = name,
        template = template_text
    );
    let system = Some(String::from(
        "You are a meticulous loremaster producing only valid Markdown and YAML frontmatter for fantasy deities.\nDetail portfolios, relationships, worshippers, and church customs without duplicating headings.\n"
    ));
    eprintln!("[blossom] god_create: invoking LLM generation");
    let content = match generate_llm(prompt, system, None, None).await {
        Ok(c) => {
            eprintln!("[blossom] god_create: LLM returned ({} bytes)", c.len());
            c
        }
        Err(e) => {
            eprintln!("[blossom] god_create: LLM generation failed: {}", e);
            return Err(e);
        }
    };
    let content = strip_code_fence(&content).to_string();

    let mut fname = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() {
        fname = "New_God".to_string();
    }
    let mut target = gods_dir.join(format!("{}.md", fname));
    let mut counter = 2;
    while target.exists() {
        target = gods_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }
    eprintln!(
        "[blossom] god_create: writing file to '{}'",
        target.to_string_lossy()
    );

    fs::write(&target, content.as_bytes()).map_err(|e| {
        eprintln!(
            "[blossom] god_create: failed to write file '{}': {}",
            target.to_string_lossy(),
            e
        );
        e.to_string()
    })?;
    eprintln!(
        "[blossom] god_create: completed -> '{}'",
        target.to_string_lossy()
    );

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
async fn spell_create(
    _app: AppHandle,
    name: String,
    template: Option<String>,
) -> Result<String, String> {
    eprintln!(
        "[blossom] spell_create: start name='{}', template={:?}",
        name, template
    );

    let vault_root = dreadhaven_root();

    let spells_dir = vault_root.join("10_World").join("SpellBook");
    eprintln!(
        "[blossom] spell_create: spells_dir='{}'",
        spells_dir.to_string_lossy()
    );
    if !spells_dir.exists() {
        eprintln!("[blossom] spell_create: creating spells_dir");
        fs::create_dir_all(&spells_dir).map_err(|e| {
            eprintln!(
                "[blossom] spell_create: failed to create spells_dir '{}': {}",
                spells_dir.to_string_lossy(),
                e
            );
            e.to_string()
        })?;
    }

    eprintln!("[blossom] spell_create: resolving template path");
    let default_template_dir = PathBuf::from(r"D:\\Documents\\DreadHaven\\_Templates");
    let default_template_names = [
        "Spell Template + Universal (D&D 5e Spell).md",
        "Spell Template + Universal (D&D 5e).md",
        "Spell Template (D&D 5e).md",
        "Spell Template.md",
    ];
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(mut s) = template {
        eprintln!("[blossom] spell_create: raw template arg='{}'", s);
        let mut ch = s.chars();
        if let (Some(drive), Some(sep)) = (ch.next(), ch.next()) {
            if drive.is_ascii_alphabetic() && sep == '\\' && !s.contains(":\\") {
                let rest: String = s.chars().skip(2).collect();
                s = format!("{}:\\{}", drive, rest);
                eprintln!("[blossom] spell_create: normalized Windows path -> '{}'", s);
            }
        }
        let p = PathBuf::from(&s);
        if p.is_absolute() && !candidates.contains(&p) {
            candidates.push(p.clone());
        }
        let templated = vault_root.join("_Templates").join(&s);
        if !candidates.contains(&templated) {
            candidates.push(templated);
        }
        let joined = vault_root.join(&s);
        if !candidates.contains(&joined) {
            candidates.push(joined);
        }
        if !p.is_absolute() {
            let joined = default_template_dir.join(&s);
            if !candidates.contains(&joined) {
                candidates.push(joined);
            }
        }
    } else {
        if let Some(first) = default_template_names.first() {
            candidates.push(default_template_dir.join(first));
        }
    }
    let vault_templates = vault_root.join("_Templates");
    for name in &default_template_names {
        let cand = vault_templates.join(name);
        if !candidates.contains(&cand) {
            candidates.push(cand);
        }
    }
    for name in &default_template_names {
        let cand = vault_root.join(name);
        if !candidates.contains(&cand) {
            candidates.push(cand);
        }
    }
    for name in &default_template_names {
        let cand = default_template_dir.join(name);
        if !candidates.contains(&cand) {
            candidates.push(cand);
        }
    }

    let mut template_text_opt: Option<String> = None;
    let mut tried: Vec<String> = Vec::new();
    let mut last_err: Option<String> = None;
    for cand in candidates {
        let cand_str = cand.to_string_lossy().to_string();
        eprintln!(
            "[blossom] spell_create: trying template candidate '{}'",
            cand_str
        );
        tried.push(cand_str.clone());
        match fs::read_to_string(&cand) {
            Ok(t) => {
                eprintln!(
                    "[blossom] spell_create: template selected '{}' ({} bytes)",
                    cand_str,
                    t.len()
                );
                template_text_opt = Some(t);
                break;
            }
            Err(e) => {
                eprintln!(
                    "[blossom] spell_create: candidate failed '{}': {}",
                    cand_str, e
                );
                last_err = Some(e.to_string());
            }
        }
    }
    let template_text = match template_text_opt {
        Some(t) => t,
        None => {
            let summary = tried.join("; ");
            let last = last_err.unwrap_or_else(|| "unknown error".to_string());
            return Err(format!(
                "Failed to read template. Tried: {}. Last error: {}",
                summary, last
            ));
        }
    };

    let effective_name = if name.trim().is_empty() {
        "New Spell".to_string()
    } else {
        name.trim().to_string()
    };
    let prompt = format!(
        "You are drafting a D&D 5e spell entry. Using the TEMPLATE, fully populate it for a spell named \"{name}\".\n\nRules:\n- Keep Markdown structure, headings, lists, and YAML frontmatter.\n- Fill all placeholders with spell level, school, casting time, range, components, duration, saving throws, and effects.\n- Provide flavorful description plus mechanical details, including At Higher Levels if appropriate.\n- Output only the completed markdown, no extra commentary.\n\nTEMPLATE:\n```\n{template}\n```",
        name = effective_name,
        template = template_text
    );
    let system = Some(String::from(
        "You are an arcane archivist who outputs only valid Markdown with YAML frontmatter describing D&D 5e spells.\nEnsure level, school, casting time, range, components, duration, saving throws, damage, and scaling are detailed without using OGL-restricted phrasing.\n"
    ));
    eprintln!("[blossom] spell_create: invoking LLM generation");
    let content = match generate_llm(prompt, system, None, None).await {
        Ok(c) => {
            eprintln!("[blossom] spell_create: LLM returned ({} bytes)", c.len());
            c
        }
        Err(e) => {
            eprintln!("[blossom] spell_create: LLM generation failed: {}", e);
            return Err(e);
        }
    };
    let content = strip_code_fence(&content).to_string();

    let mut fname = effective_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    if fname.is_empty() {
        fname = "New_Spell".to_string();
    }
    let mut target = spells_dir.join(format!("{}.md", fname));
    let mut counter = 2;
    while target.exists() {
        target = spells_dir.join(format!("{}_{}.md", fname, counter));
        counter += 1;
        if counter > 9999 {
            break;
        }
    }
    eprintln!(
        "[blossom] spell_create: writing file to '{}'",
        target.to_string_lossy()
    );

    fs::write(&target, content.as_bytes()).map_err(|e| {
        eprintln!(
            "[blossom] spell_create: failed to write file '{}': {}",
            target.to_string_lossy(),
            e
        );
        e.to_string()
    })?;
    eprintln!(
        "[blossom] spell_create: completed -> '{}'",
        target.to_string_lossy()
    );

    Ok(target.to_string_lossy().to_string())
}

fn models_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("models.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

fn devices_store(app: &AppHandle) -> Result<Arc<Store<tauri::Wry>>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("devices.json");
    StoreBuilder::new(app, path)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_whisper(app: AppHandle) -> Result<Value, String> {
    let options = vec!["tiny", "base", "small", "medium", "large"]
        .into_iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("whisper")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        std::env::set_var("WHISPER_MODEL", sel);
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_whisper(app: AppHandle, model: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("whisper".to_string(), model.clone());
    store.save().map_err(|e| e.to_string())?;
    std::env::set_var("WHISPER_MODEL", &model);
    app.emit("settings::models", json!({"whisper": model}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn transcribe_whisper(audio: Vec<u8>) -> Result<String, String> {
    if audio.is_empty() {
        return Ok(String::new());
    }
    let encoded = general_purpose::STANDARD.encode(audio);
    let text = async_runtime::spawn_blocking(move || -> Result<String, String> {
        let audio_literal =
            serde_json::to_string(&encoded).map_err(|e| format!("encode error: {}", e))?;
        let script = format!(
            r#"
import asyncio
import base64
import json
import sys

from ears.whisper_service import WhisperService

audio = base64.b64decode({audio_literal})

async def _run():
    service = WhisperService()
    texts = []
    async for segment in service.transcribe(audio):
        text = getattr(segment, "text", "") or ""
        text = text.strip()
        if text:
            texts.append(text)
    return " ".join(texts).strip()

try:
    result = asyncio.run(_run())
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)

print(json.dumps({{"text": result}}))
"#,
            audio_literal = audio_literal
        );
        let mut cmd = python_command();
        cmd.arg("-c").arg(script);
        let output = cmd.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = if stderr.is_empty() {
                "Whisper transcription failed".to_string()
            } else {
                stderr
            };
            return Err(message);
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();
        if trimmed.is_empty() {
            return Ok(String::new());
        }
        let value: Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("Failed to parse Whisper output: {}", e))?;
        let text = value
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?;
    let text = text?;
    Ok(text)
}

#[tauri::command]
fn list_piper(app: AppHandle) -> Result<Value, String> {
    let mut options = list_from_dir("assets/voice_models")
        .ok()
        .filter(|opts| !opts.is_empty())
        .or_else(|| {
            app.path()
                .resolve("assets/voice_models", BaseDirectory::Resource)
                .ok()
                .and_then(|dir| list_from_dir(dir).ok())
                .filter(|opts| !opts.is_empty())
        })
        .unwrap_or_else(|| {
            let mut fallback = Vec::new();
            // Prefer voices.json under the app data directory
            if let Ok(appdir) = app.path().app_data_dir() {
                let app_path = appdir.join("voices.json");
                if let Ok(text) = fs::read_to_string(&app_path) {
                    if let Ok(map) = serde_json::from_str::<serde_json::Map<String, Value>>(&text) {
                        fallback.extend(map.keys().cloned());
                    }
                }
            }
            // Back-compat: check legacy repo-relative path if present
            if fallback.is_empty() {
                if let Ok(text) = fs::read_to_string("data/voices.json") {
                    if let Ok(map) = serde_json::from_str::<serde_json::Map<String, Value>>(&text) {
                        fallback.extend(map.keys().cloned());
                    }
                }
            }
            if fallback.is_empty() {
                fallback.push("narrator".to_string());
            } else {
                fallback.sort();
            }
            fallback
        });
    options.sort();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("piper")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        // Attempt to resolve selection to a concrete model path for runtime usage
        let mut resolved: Option<String> = None;
        if let Ok(items) = list_bundled_voices(app.clone()) {
            if let Some(arr) = items.as_array() {
                for it in arr {
                    if let (Some(id), Some(model)) = (
                        it.get("id").and_then(|v| v.as_str()),
                        it.get("modelPath").and_then(|v| v.as_str()),
                    ) {
                        if id == sel {
                            resolved = Some(model.to_string());
                            break;
                        }
                    }
                }
            }
        }
        std::env::set_var("PIPER_VOICE", resolved.as_deref().unwrap_or(sel));
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_piper(app: AppHandle, voice: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("piper".to_string(), voice.clone());
    store.save().map_err(|e| e.to_string())?;
    // Try to resolve bundled voice id to a concrete model path for the runtime env var
    let mut resolved: Option<String> = None;
    // Reuse bundled voice discovery to find model/config paths
    let mut config_resolved: Option<String> = None;
    if let Ok(items) = list_bundled_voices(app.clone()) {
        if let Some(arr) = items.as_array() {
            for it in arr {
                if let (Some(id), Some(model)) = (
                    it.get("id").and_then(|v| v.as_str()),
                    it.get("modelPath").and_then(|v| v.as_str()),
                ) {
                    if id == voice {
                        resolved = Some(model.to_string());
                        if let Some(cfg) = it.get("configPath").and_then(|v| v.as_str()) {
                            config_resolved = Some(cfg.to_string());
                        }
                        break;
                    }
                }
            }
        }
    }
    std::env::set_var("PIPER_VOICE", resolved.as_deref().unwrap_or(&voice));
    if let Some(cfg) = config_resolved.as_deref() {
        std::env::set_var("PIPER_CONFIG", cfg);
    }
    app.emit("settings::models", json!({"piper": voice}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn discover_piper_voices() -> Result<Vec<String>, String> {
    match Command::new("piper-voices").arg("--json").output() {
        Ok(output) => {
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
            let voices_json: Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("failed to parse voice list: {e}"))?;
            let voices = match voices_json {
                Value::Object(map) => map.keys().cloned().collect(),
                Value::Array(arr) => arr
                    .into_iter()
                    .filter_map(|v| {
                        v.as_object()
                            .and_then(|o| o.get("id"))
                            .and_then(|id| id.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect(),
                _ => Vec::new(),
            };
            Ok(voices)
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let output = Command::new("piper").arg("--list").output().map_err(|e| {
                if e.kind() == ErrorKind::NotFound {
                    "neither piper-voices nor piper binary found".into()
                } else {
                    e.to_string()
                }
            })?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
            let voices = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .filter_map(|l| l.split_whitespace().next())
                .map(|s| s.trim_start_matches('-').to_string())
                .filter(|s| s.contains('-'))
                .collect();
            Ok(voices)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn add_piper_voice(
    app: AppHandle,
    name: String,
    voice: String,
    tags: String,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    let tag_list: Vec<String> = tags
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    map.insert(
        name,
        json!({
            "voice_id": voice,
            "speed": 1.0,
            "emotion": "neutral",
            "tags": tag_list,
        }),
    );
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_piper_profiles(app: AppHandle) -> Result<Vec<PiperProfile>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("voices.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let map: serde_json::Map<String, Value> = serde_json::from_str(&text).unwrap_or_default();
    let mut profiles = Vec::new();
    for (name, v) in map {
        let voice_id = v
            .get("voice_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let tags = v
            .get("tags")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        profiles.push(PiperProfile {
            name,
            voice_id,
            tags,
        });
    }
    Ok(profiles)
}

#[tauri::command]
fn update_piper_profile(
    app: AppHandle,
    original: String,
    name: String,
    tags: String,
) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    let mut profile = map.remove(&original).ok_or("profile not found")?;
    let tag_list: Vec<String> = tags
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    profile["tags"] = json!(tag_list);
    map.insert(name, profile);
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_piper_profile(app: AppHandle, name: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("voices.json");
    let mut map: serde_json::Map<String, Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };
    map.remove(&name);
    let text = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn piper_test(app: AppHandle, text: String, voice: String) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let base = dir.join("piper_tests");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let prefix = format!("{}_", voice);
    let count = fs::read_dir(&base)
        .map_err(|e| e.to_string())?
        .filter(|entry| {
            entry
                .as_ref()
                .ok()
                .and_then(|e| {
                    e.file_name()
                        .to_str()
                        .map(|n| n.starts_with(&prefix) && n.ends_with(".mp3"))
                })
                .unwrap_or(false)
        })
        .count();
    let file = base.join(format!("{}_{:03}.mp3", voice, count + 1));

    let tmp = tempfile::Builder::new()
        .suffix(".wav")
        .tempfile()
        .map_err(|e| e.to_string())?;
    let tmp_path = tmp.into_temp_path();
    let wav_path = tmp_path.to_path_buf();
    // Resolve voice id to a concrete model path if it matches a bundled voice.
    // Also, if no voice is provided, fall back to the first bundled voice.
    let mut voice_to_use = voice.clone();
    let mut roots: Vec<PathBuf> = Vec::new();
    let proj = project_root();
    roots.push(proj.join("assets/voice_models"));
    roots.push(proj.join("src-tauri").join("assets/voice_models"));
    roots.push(proj.join("assets/Voice_Models"));
    roots.push(proj.join("src-tauri").join("assets/Voice_Models"));
    roots.push(proj.join("Voice_Models"));
    let mut seen = std::collections::HashSet::new();
    roots.retain(|p| p.exists() && seen.insert(p.canonicalize().unwrap_or(p.clone())));

    // If a specific voice id was provided, resolve it.
    if !voice.is_empty() {
        'resolve_specific: for base in &roots {
            if let Ok(rd) = fs::read_dir(base) {
                for entry in rd {
                    let entry = match entry {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let id = match path.file_name().and_then(|s| s.to_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    if id != voice {
                        continue;
                    }
                    let mut model_file: Option<String> = None;
                    if let Ok(files) = fs::read_dir(&path) {
                        for f in files.flatten() {
                            if let Ok(ft) = f.file_type() {
                                if !ft.is_file() {
                                    continue;
                                }
                            }
                            let name = match f.file_name().to_str() {
                                Some(s) => s.to_string(),
                                None => continue,
                            };
                            if name.to_lowercase().ends_with(".onnx") {
                                model_file = Some(name);
                                break;
                            }
                        }
                    }
                    if let Some(model) = model_file {
                        voice_to_use = path.join(model).to_string_lossy().to_string();
                        break 'resolve_specific;
                    }
                }
            }
        }
    }

    // If still empty or unresolved (e.g., "narrator"), choose the first bundled voice model.
    if voice_to_use.is_empty() || (!voice_to_use.ends_with(".onnx") && voice_to_use == "narrator") {
        'pick_first: for base in &roots {
            if let Ok(rd) = fs::read_dir(base) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    if let Ok(files) = fs::read_dir(&path) {
                        for f in files.flatten() {
                            let fpath = f.path();
                            if fpath.is_file() {
                                if let Some(name) = fpath.file_name().and_then(|s| s.to_str()) {
                                    if name.to_lowercase().ends_with(".onnx") {
                                        voice_to_use = fpath.to_string_lossy().to_string();
                                        break 'pick_first;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Ensure ffmpeg input path ends with .wav as some temp paths have no extension on Windows
    let mut wav_str_for_ffmpeg = wav_path.to_string_lossy().to_string();
    if !wav_str_for_ffmpeg.to_lowercase().ends_with(".wav") {
        wav_str_for_ffmpeg.push_str(".wav");
    }
    let py_script = format!(
        r#"
import soundfile as sf
from mouth.tts import TTSEngine
engine = TTSEngine()
audio = engine.synthesize({text:?}, voice={voice:?})
wav_out = {wav:?}
if not str(wav_out).lower().endswith('.wav'):
    wav_out = str(wav_out) + '.wav'
sf.write(wav_out, audio, 22050, format="WAV")
"#,
        text = text,
        voice = voice_to_use,
        wav = wav_path.to_string_lossy()
    );
    let mut cmd = python_command();
    let status = cmd
        .arg("-c")
        .arg(py_script)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("piper synthesis failed".into());
    }
    let wav_str = wav_str_for_ffmpeg;
    let out_str = file.to_string_lossy().to_string();
    let status = Command::new("ffmpeg")
        .args(["-y", "-i", &wav_str, &out_str])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("audio conversion failed".into());
    }
    drop(tmp_path);
    Ok(file)
}

#[tauri::command]
fn musicgen_test(app_handle: AppHandle) -> Result<Vec<u8>, String> {
    let script = app_handle
        .path()
        .resolve("scripts/test_musicgen.py", BaseDirectory::Resource)
        .map_err(|_| "failed to resolve test script".to_string())?;
    let mut cmd = python_command();
    let output = cmd.arg(script).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let out_path = Path::new("out/musicgen_sample.wav");
    let bytes = fs::read(out_path).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[tauri::command]
fn hotword_get() -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .args(["-m", "ears.hotword", "list"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(parsed)
}

#[tauri::command]
fn hotword_set(
    app: AppHandle,
    name: String,
    enabled: bool,
    file: Option<String>,
) -> Result<(), String> {
    if let Some(src) = file {
        let src_path = PathBuf::from(&src);
        if let Some(fname) = src_path.file_name() {
            let dest_dir = Path::new("ears").join("hotwords");
            fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
            let dest = dest_dir.join(fname);
            fs::copy(&src_path, &dest).map_err(|e| e.to_string())?;
        }
    }
    let mut cmd = python_command();
    let status = cmd
        .args([
            "-m",
            "ears.hotword",
            "set",
            &name,
            if enabled { "1" } else { "0" },
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("hotword configuration failed".into());
    }
    app.emit(
        "settings::hotwords",
        json!({ "name": name, "enabled": enabled }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_llm(app: AppHandle) -> Result<Value, String> {
    let stdout_bytes = Command::new("ollama")
        .arg("list")
        .output()
        .map(|o| o.stdout)
        .unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let mut options = Vec::new();
    for line in stdout.lines().skip(1) {
        if let Some(name) = line.split_whitespace().next() {
            if !name.is_empty() {
                options.push(name.to_string());
            }
        }
    }
    if options.is_empty() {
        options.push("mistral".to_string());
    }
    options.sort();
    let store = models_store::<tauri::Wry>(&app)?;
    let selected = store
        .get("llm")
        .and_then(|v| v.as_str().map(|s| s.to_string()));
    if let Some(sel) = &selected {
        std::env::set_var("LLM_MODEL", sel);
    }
    Ok(json!({"options": options, "selected": selected}))
}

#[tauri::command]
fn set_llm(app: AppHandle, model: String) -> Result<(), String> {
    let store = models_store::<tauri::Wry>(&app)?;
    store.set("llm".to_string(), model.clone());
    store.save().map_err(|e| e.to_string())?;
    std::env::set_var("LLM_MODEL", &model);
    app.emit("settings::models", json!({"llm": model}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pull_llm(model: String) -> Result<String, String> {
    // Run `ollama pull <model>` and return stdout/stderr text on success/failure
    let output = Command::new("ollama")
        .arg("pull")
        .arg(&model)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(text)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn list_devices(app: AppHandle) -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .args(["-m", "ears.devices"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let input_opts = parsed
        .get("input")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    let output_opts = parsed
        .get("output")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    let store = devices_store(&app)?;
    let selected_input = store
        .get("input")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let selected_output = store
        .get("output")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    if let Some(id) = selected_input {
        env::set_var("INPUT_DEVICE", id.to_string());
    }
    if let Some(id) = selected_output {
        env::set_var("OUTPUT_DEVICE", id.to_string());
    }
    Ok(json!({
        "input": {"options": input_opts, "selected": selected_input},
        "output": {"options": output_opts, "selected": selected_output}
    }))
}

#[tauri::command]
fn set_devices(app: AppHandle, input: Option<u32>, output: Option<u32>) -> Result<(), String> {
    let store = devices_store(&app)?;
    if let Some(id) = input {
        store.set("input".to_string(), id as u64);
        env::set_var("INPUT_DEVICE", id.to_string());
    } else {
        store.delete("input");
        env::remove_var("INPUT_DEVICE");
    }
    if let Some(id) = output {
        store.set("output".to_string(), id as u64);
        env::set_var("OUTPUT_DEVICE", id.to_string());
    } else {
        store.delete("output");
        env::remove_var("OUTPUT_DEVICE");
    }
    store.save().map_err(|e| e.to_string())?;
    app.emit(
        "settings::devices",
        json!({"input": input, "output": output}),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn app_version() -> Result<Value, String> {
    let app = env!("CARGO_PKG_VERSION").to_string();
    let mut cmd = python_command();
    let output = cmd.arg("--version").output().map_err(|e| e.to_string())?;
    let python = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };
    Ok(json!({ "app": app, "python": python }))
}

#[tauri::command]
fn spawn_job_with_context(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
    context: JobContext,
) -> Result<u64, String> {
    let id = registry.next_id();
    let job = JobInfo::new_pending(args.clone(), &context);
    registry.enqueue_job(id, job)?;
    registry.update_queue_positions(&app);
    registry.maybe_start_jobs(&app);
    Ok(id)
}

#[tauri::command]
fn start_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    args: Vec<String>,
) -> Result<u64, String> {
    spawn_job_with_context(app, registry, args, JobContext::default())
}

#[tauri::command]
fn train_model(
    app: AppHandle,
    registry: State<JobRegistry>,
    midi_files: Vec<String>,
    epochs: u32,
    lr: f32,
) -> Result<u64, String> {
    let script = if Path::new("training/run_phrase_train.py").exists() {
        "training/run_phrase_train.py".to_string()
    } else {
        "../training/run_phrase_train.py".to_string()
    };
    let mut args = vec![script, "--midis".into()];
    args.extend(midi_files);
    args.push("--epochs".into());
    args.push(epochs.to_string());
    args.push("--lr".into());
    args.push(lr.to_string());
    start_job(app, registry, args)
}

#[tauri::command]
fn cancel_render(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
    registry.cancel_job(&app, job_id)
}

#[tauri::command]
fn cancel_job(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> Result<(), String> {
    registry.cancel_job(&app, job_id)
}

#[derive(Serialize, Clone)]
struct JobState {
    status: String,
    message: Option<String>,
    stdout: Vec<String>,
    stderr: Vec<String>,
    created_at: Option<String>,
    finished_at: Option<String>,
    args: Vec<String>,
    artifacts: Vec<JobArtifact>,
    progress: Option<JobProgressSnapshot>,
    kind: Option<String>,
    label: Option<String>,
    source: Option<String>,
    cancelled: bool,
}

fn format_timestamp(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn format_eta_string(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

fn sanitize_musicgen_base_name(name: Option<&str>, fallback: &str) -> String {
    let raw = name.unwrap_or("").trim();
    let mut sanitized = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    let mut cleaned = sanitized.trim().trim_matches('.').to_string();
    if cleaned.len() > 120 {
        cleaned = cleaned.chars().take(120).collect();
    }
    cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        return fallback.to_string();
    }
    let lower = cleaned.to_lowercase();
    let without_ext = if lower.ends_with(".wav") {
        cleaned[..cleaned.len() - 4]
            .trim()
            .trim_matches('.')
            .to_string()
    } else {
        cleaned.clone()
    };
    let final_name = without_ext.trim().trim_matches('.').to_string();
    if final_name.is_empty() {
        fallback.to_string()
    } else {
        final_name
    }
}

fn probe_media_duration(input: &Path) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(input)
        .output()
        .map_err(|err| format!("Failed to execute ffprobe: {}", err))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "ffprobe failed to read duration".to_string()
        };
        return Err(detail);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let raw = text.trim();
    raw.parse::<f64>()
        .map_err(|err| format!("Unable to parse ffprobe duration '{}': {}", raw, err))
}

#[tauri::command]
fn export_loop_video(
    app: AppHandle,
    registry: State<JobRegistry>,
    input_path: String,
    target_seconds: f64,
    clip_seconds: Option<f64>,
    outdir: Option<String>,
    output_name: Option<String>,
) -> Result<u64, String> {
    let in_path = PathBuf::from(&input_path);
    if !in_path.exists() {
        let msg = format!("Input video does not exist at {}", in_path.display());
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }
    if in_path.is_dir() {
        let msg = format!(
            "Input path is a directory, expected a file: {}",
            in_path.display()
        );
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }
    if target_seconds <= 0.0 {
        let msg = format!(
            "Target seconds must be greater than zero (received {:.3}).",
            target_seconds
        );
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }

    // Determine output directory
    let out_dir = if let Some(dir) = outdir {
        PathBuf::from(dir)
    } else {
        // Default to app data jobs/loops
        match app.path().app_data_dir() {
            Ok(base) => base.join("jobs").join("loops"),
            Err(err) => {
                let msg = format!(
                    "Failed to resolve app data directory for loop export: {}",
                    err
                );
                eprintln!("[loop-maker] {}", msg);
                return Err(msg);
            }
        }
    };
    if let Err(err) = std::fs::create_dir_all(&out_dir) {
        let msg = format!(
            "Failed to create loop export directory {}: {}",
            out_dir.display(),
            err
        );
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }

    // Determine output filename
    let stem = if let Some(name) = output_name {
        sanitize_file_stem(&name, "loop")
    } else {
        in_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|stem| sanitize_file_stem(stem, "loop"))
            .unwrap_or_else(|| "loop".to_string())
    };
    let out_path = out_dir.join(format!("{}.mp4", stem));
    let out_path_str = out_path.to_string_lossy().to_string();

    let script = if Path::new("scripts/export_loop_video.py").exists() {
        "scripts/export_loop_video.py".to_string()
    } else {
        "../scripts/export_loop_video.py".to_string()
    };

    let script_path = Path::new(&script);
    if !script_path.exists() {
        let msg = format!("Loop export script not found at {}", script_path.display());
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }

    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let detail = if !stderr.trim().is_empty() {
                    stderr.trim().to_string()
                } else if !stdout.trim().is_empty() {
                    stdout.trim().to_string()
                } else {
                    "ffmpeg -version returned a non-zero exit status".to_string()
                };
                let msg = format!("Failed to run ffmpeg: {}", detail);
                eprintln!("[loop-maker] {}", msg);
                return Err(msg);
            }
        }
        Err(err) => {
            let msg = format!("Failed to execute ffmpeg: {}", err);
            eprintln!("[loop-maker] {}", msg);
            return Err(msg);
        }
    }

    let canonical_input = match in_path.canonicalize() {
        Ok(path) => path,
        Err(err) => {
            eprintln!(
                "[loop-maker] Failed to canonicalize input path {}: {}. Using provided path.",
                in_path.display(),
                err
            );
            in_path.clone()
        }
    };

    let mut clip = clip_seconds.unwrap_or(0.0);
    if clip <= 0.0 {
        match probe_media_duration(&canonical_input) {
            Ok(value) => {
                clip = value;
                eprintln!(
                    "[loop-maker] detected clip duration {:.3}s for {}",
                    clip,
                    canonical_input.display()
                );
            }
            Err(err) => {
                let msg = format!(
                    "Unable to determine clip duration for {}: {}",
                    canonical_input.display(),
                    err
                );
                eprintln!("[loop-maker] {}", msg);
                return Err(msg);
            }
        }
    }

    if clip <= 0.0 {
        let msg = format!(
            "Clip duration must be greater than zero to compute loops (received {:.3}).",
            clip
        );
        eprintln!("[loop-maker] {}", msg);
        return Err(msg);
    }

    let loops = (target_seconds / clip).floor() as i64;
    let remainder = target_seconds - (loops as f64) * clip;

    let input_arg = canonical_input.to_string_lossy().to_string();

    let mut args = vec![script];
    args.push("--input".into());
    args.push(input_arg);
    args.push("--target-seconds".into());
    args.push(format!("{:.6}", target_seconds));
    args.push("--clip-seconds".into());
    args.push(format!("{:.6}", clip));
    args.push("--output".into());
    args.push(out_path_str.clone());
    args.push("--label".into());
    args.push(stem.clone());
    args.push("--remainder".into());
    args.push(format!("{:.6}", remainder.max(0.0)));

    let artifact_candidates = vec![JobArtifactCandidate {
        name: format!("{} (MP4)", stem.clone()),
        path: out_path.clone(),
    }];

    let context = JobContext {
        kind: Some("loop-maker".into()),
        label: Some(stem),
        source: Some("Loop Maker".into()),
        artifact_candidates,
    };

    eprintln!(
        "[loop-maker] queueing loop export for {} (target {:.2}s, clip {:.2}s) -> {}",
        canonical_input.display(),
        target_seconds,
        clip,
        out_path.display()
    );

    spawn_job_with_context(app, registry, args, context).map_err(|err| {
        let msg = format!("Failed to queue loop export: {}", err);
        eprintln!("[loop-maker] {}", msg);
        msg
    })
}

#[tauri::command]
fn queue_riffusion_soundscape_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: RiffusionSoundscapeJobRequest,
) -> Result<u64, String> {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let default_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jobs")
        .join("riffscape")
        .join(format!("riffscape-{}", timestamp));
    let base_dir = options
        .output_dir
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir);
    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let sanitize = |s: &str| -> String {
        let mut out = String::new();
        for ch in s.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        let trimmed = out.trim().trim_matches('.').to_string();
        if trimmed.is_empty() {
            "soundscape".to_string()
        } else {
            trimmed.chars().take(120).collect()
        }
    };

    let base_name_source = options
        .output_name
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| {
            options
                .preset
                .clone()
                .unwrap_or_else(|| "dark_ambience".into())
        });
    let base_name = sanitize(&base_name_source);
    let outfile = base_dir.join(format!("{}.wav", base_name));
    let cover = base_dir.join(format!("{}.png", base_name));
    let logf = base_dir.join(format!("{}.log", base_name));

    // Artifact candidates: master, cover, directory. (Stem files will be registered at completion by pattern.)
    let mut artifact_candidates = Vec::new();
    artifact_candidates.push(JobArtifactCandidate {
        name: format!("{} (master)", base_name),
        path: outfile.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: format!("{} (cover)", base_name),
        path: cover.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: format!("{} (log)", base_name),
        path: logf.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Output Directory".into(),
        path: base_dir.clone(),
    });

    let mut args: Vec<String> = vec![
        "-m".into(),
        "blossom.audio.riffusion.cli_soundscape".into(),
        "--outfile".into(),
        outfile.to_string_lossy().to_string(),
    ];
    // Prefer HiFi-GAN output for soundscape renders as well; the CLI will
    // revert to Griffin-Lim automatically if loading fails.
    args.push("--hub_hifigan".into());
    if let Some(p) = options.preset.clone() {
        args.push("--preset".into());
        args.push(p);
    }
    if let Some(d) = options.duration {
        args.push("--duration".into());
        args.push(format!("{}", d));
    }
    if let Some(s) = options.seed {
        args.push("--seed".into());
        args.push(s.to_string());
    }
    if let Some(st) = options.steps {
        args.push("--steps".into());
        args.push(st.to_string());
    }
    if let Some(g) = options.guidance {
        args.push("--guidance".into());
        args.push(format!("{}", g));
    }
    if let Some(cf) = options.crossfade_secs {
        args.push("--crossfade_secs".into());
        args.push(format!("{}", cf));
    }

    let label = format!("Riffusion Soundscape: {}", base_name);
    let context = JobContext {
        kind: Some("riffusion_soundscape".into()),
        label: Some(label),
        source: Some("Riffusion".into()),
        artifact_candidates,
    };
    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn queue_riffusion_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: RiffusionJobRequest,
) -> Result<u64, String> {
    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let default_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jobs")
        .join("riffusion")
        .join(format!("riffusion-{}", timestamp));

    let output_dir = options
        .output_dir
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let sanitize = |s: &str| -> String {
        let mut out = String::new();
        for ch in s.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        let trimmed = out.trim().trim_matches('.').to_string();
        if trimmed.is_empty() {
            "riffusion".to_string()
        } else {
            trimmed.chars().take(120).collect()
        }
    };

    let fallback_name = format!("riffusion-{}", timestamp);
    let base_name_source = options
        .output_name
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .or_else(|| options.prompt.as_ref().map(|p| p.trim().to_string()))
        .unwrap_or(fallback_name);
    let mut base_name = sanitize(&base_name_source);
    if !base_name.to_lowercase().ends_with(".wav") {
        base_name.push_str(".wav");
    }
    let outfile = output_dir.join(&base_name);
    let meta_path = outfile.with_extension("json");
    let cover_path = outfile.with_extension("png");
    let log_path = outfile.with_extension("log");

    let mut artifact_candidates = Vec::new();
    artifact_candidates.push(JobArtifactCandidate {
        name: base_name.clone(),
        path: outfile.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Metadata JSON".into(),
        path: meta_path.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Cover Image".into(),
        path: cover_path.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Log".into(),
        path: log_path.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Output Directory".into(),
        path: output_dir.clone(),
    });

    // Build python -m blossom.audio.riffusion.cli_riffusion args
    let mut args: Vec<String> = vec![
        "-m".into(),
        "blossom.audio.riffusion.cli_riffusion".into(),
        "--outfile".into(),
        outfile.to_string_lossy().to_string(),
        "--width".into(),
        "512".into(),
        "--height".into(),
        "512".into(),
        "--sr".into(),
        "22050".into(),
    ];
    // Default to the higher-fidelity HiFi-GAN vocoder; the CLI will gracefully
    // fall back to Griffin-Lim if it cannot be loaded on the current system.
    args.push("--hub_hifigan".into());
    if let Some(prompt) = options.prompt.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push(prompt.clone());
    }
    if let Some(neg) = options.negative.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("--negative".into());
        args.push(neg.clone());
    }
    if let Some(pre) = options.preset.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("--preset".into());
        args.push(pre.clone());
    }
    if let Some(seed) = options.seed {
        args.push("--seed".into());
        args.push(seed.to_string());
    }
    if let Some(steps) = options.steps {
        args.push("--steps".into());
        args.push(steps.to_string());
    }
    if let Some(g) = options.guidance {
        args.push("--guidance".into());
        args.push(format!("{}", g));
    }
    if let Some(dur) = options.duration {
        args.push("--duration".into());
        args.push(format!("{}", dur));
    }
    if let Some(cf) = options.crossfade_secs {
        args.push("--crossfade_secs".into());
        args.push(format!("{}", cf));
    }

    let label_source = options
        .output_name
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            options.prompt.as_ref().map(|p| {
                let mut s: String = p.trim().chars().take(80).collect();
                if p.trim().chars().count() > 80 {
                    s.push('.');
                }
                s
            })
        })
        .unwrap_or_else(|| format!("Riffusion {}", timestamp));
    let label: String = label_source.chars().take(120).collect();

    let context = JobContext {
        kind: Some("riffusion".into()),
        label: Some(label),
        source: Some("Riffusion".into()),
        artifact_candidates,
    };

    // Use spawn_job_with_context with our args vector (python -m invocation handled inside job system)
    spawn_job_with_context(app, registry, args, context)
}
#[tauri::command]
fn job_state_from_registry(app: &AppHandle, registry: &JobRegistry, job_id: u64) -> JobState {
    let mut finalize_request: Option<(bool, Option<i32>)> = None;
    let mut state = JobState {
        status: "not-found".into(),
        message: None,
        stdout: Vec::new(),
        stderr: Vec::new(),
        created_at: None,
        finished_at: None,
        args: Vec::new(),
        artifacts: Vec::new(),
        progress: None,
        kind: None,
        label: None,
        source: None,
        cancelled: false,
    };

    {
        let mut jobs = registry.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            state.args = job.args.clone();
            state.created_at = Some(format_timestamp(job.created_at));
            state.kind = job.kind.clone();
            state.label = job.label.clone();
            state.source = job.source.clone();
            state.cancelled = job.cancelled;
            state.stdout = job
                .stdout_excerpt
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            state.stderr = job
                .stderr_excerpt
                .lock()
                .map(|buf| buf.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            state.artifacts = job
                .artifacts
                .lock()
                .map(|items| items.clone())
                .unwrap_or_default();
            state.progress = job
                .progress
                .lock()
                .map(|p| (*p).clone())
                .unwrap_or_default();
            if job.cancelled {
                state.status = "cancelled".into();
                state.finished_at = job.finished_at.map(format_timestamp);
            } else if let Some(success) = job.status {
                state.status = if success { "completed" } else { "error" }.into();
                state.finished_at = job.finished_at.map(format_timestamp);
                if !success {
                    let stderr = job.stderr_full.lock().unwrap().clone();
                    state.message = extract_error_message(&stderr).or_else(|| {
                        let trimmed = stderr.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    });
                }
            } else if job.pending {
                state.status = "queued".into();
            } else {
                let mut child_guard = job.child.lock().unwrap();
                if let Some(child) = child_guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            finalize_request = Some((status.success(), status.code()));
                        }
                        Ok(None) => {
                            state.status = "running".into();
                        }
                        Err(_) => {
                            finalize_request = Some((false, None));
                        }
                    }
                } else {
                    state.status = "running".into();
                }
            }
        }
    }

    if let Some((success, code)) = finalize_request {
        registry.complete_job(app, job_id, success, code, false);
        registry.maybe_start_jobs(app);
        return job_state_from_registry(app, registry, job_id);
    }

    if state.status == "not-found" {
        if let Some(record) = registry.list_history().into_iter().find(|r| r.id == job_id) {
            state.status = record.status_text();
            state.args = record.args.clone();
            state.kind = record.kind.clone();
            state.label = record.label.clone();
            state.source = record.source.clone();
            state.stdout = record.stdout_excerpt.clone();
            state.stderr = record.stderr_excerpt.clone();
            state.artifacts = record.artifacts.clone();
            state.progress = record.progress.clone();
            state.created_at = Some(format_timestamp(record.created_at));
            state.finished_at = record.finished_at.map(format_timestamp);
            state.cancelled = record.cancelled;
            if record.success == Some(false) {
                if let Some(msg) = state
                    .stderr
                    .iter()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                {
                    state.message = Some(msg.clone());
                }
            }
        }
    }

    state
}

#[tauri::command]
fn job_status(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> JobState {
    job_state_from_registry(&app, &registry, job_id)
}

#[tauri::command]
fn job_details(app: AppHandle, registry: State<JobRegistry>, job_id: u64) -> JobState {
    job_state_from_registry(&app, &registry, job_id)
}

#[tauri::command]
fn list_job_queue(registry: State<JobRegistry>) -> Vec<QueueEntry> {
    let queue_ids: Vec<u64> = registry.queue.lock().unwrap().iter().copied().collect();
    let mut running_entries = Vec::new();
    let mut pending_info: HashMap<
        u64,
        (
            DateTime<Utc>,
            Option<String>,
            Option<String>,
            Option<String>,
            Vec<String>,
        ),
    > = HashMap::new();
    {
        let jobs = registry.jobs.lock().unwrap();
        for (&id, job) in jobs.iter() {
            if job.cancelled || job.status.is_some() {
                continue;
            }
            if job.pending {
                pending_info.insert(
                    id,
                    (
                        job.queued_at,
                        job.label.clone(),
                        job.kind.clone(),
                        job.source.clone(),
                        job.args.clone(),
                    ),
                );
            } else {
                running_entries.push(QueueEntry {
                    id,
                    status: "running".into(),
                    position: None,
                    queued_at: Some(format_timestamp(job.queued_at)),
                    started_at: job.started_at.map(format_timestamp),
                    label: job.label.clone(),
                    kind: job.kind.clone(),
                    source: job.source.clone(),
                    args: job.args.clone(),
                    eta_seconds: None,
                });
            }
        }
    }
    running_entries.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    let running_count = running_entries.len();
    let mut queued_entries = Vec::new();
    for (idx, id) in queue_ids.iter().enumerate() {
        if let Some((queued_at, label, kind, source, args)) = pending_info.get(id) {
            let eta_seconds = registry.estimate_queue_eta_seconds(idx, running_count);
            queued_entries.push(QueueEntry {
                id: *id,
                status: "queued".into(),
                position: Some(idx),
                queued_at: Some(format_timestamp(*queued_at)),
                started_at: None,
                label: label.clone(),
                kind: kind.clone(),
                source: source.clone(),
                args: args.clone(),
                eta_seconds,
            });
        }
    }
    running_entries.extend(queued_entries);
    running_entries
}

#[derive(Serialize)]
struct JobSummary {
    id: u64,
    status: String,
    created_at: Option<String>,
    finished_at: Option<String>,
    kind: Option<String>,
    label: Option<String>,
    source: Option<String>,
    args: Vec<String>,
}

#[derive(Serialize)]
struct QueueEntry {
    id: u64,
    status: String,
    position: Option<usize>,
    queued_at: Option<String>,
    started_at: Option<String>,
    label: Option<String>,
    kind: Option<String>,
    source: Option<String>,
    args: Vec<String>,
    eta_seconds: Option<u64>,
}

#[derive(Clone, Serialize)]
struct AudioOutputEntry {
    name: String,
    path: String,
    modified_ms: i64,
}

#[derive(Clone, Serialize)]
struct ImageOutputEntry {
    name: String,
    path: String,
    modified_ms: i64,
}

fn comfy_audio_search_dirs(settings: Option<&commands::ComfyUISettings>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(settings) = settings {
        if let Some(ref output_dir) = settings
            .output_dir
            .as_ref()
            .and_then(|s| Some(s.trim().to_string()))
            .filter(|s| !s.is_empty())
        {
            let base = PathBuf::from(output_dir);
            if base.exists() {
                dirs.push(base.clone());
            }
            let audio_dir = base.join("audio");
            if audio_dir.exists() {
                dirs.push(audio_dir);
            }
        }
        if let Some(ref working_dir) = settings
            .working_directory
            .as_ref()
            .and_then(|s| Some(s.trim().to_string()))
            .filter(|s| !s.is_empty())
        {
            let working = PathBuf::from(working_dir);
            let output = working.join("output");
            if output.exists() {
                dirs.push(output.clone());
            }
            let audio = output.join("audio");
            if audio.exists() {
                dirs.push(audio);
            }
        }
    }
    if cfg!(target_os = "windows") {
        let win_base = PathBuf::from(r"C:\Comfy\output");
        if win_base.exists() {
            dirs.push(win_base.clone());
        }
        let win_audio = win_base.join("audio");
        if win_audio.exists() {
            dirs.push(win_audio);
        }
    }
    let default_output = PathBuf::from("output");
    if default_output.exists() {
        dirs.push(default_output.clone());
    }
    let default_audio = default_output.join("audio");
    if default_audio.exists() {
        dirs.push(default_audio);
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut unique = Vec::new();
    for dir in dirs {
        let display = dir.to_string_lossy().to_string();
        if seen.insert(display.clone()) {
            unique.push(dir);
        }
    }
    unique
}

fn resolve_comfy_audio_path(
    settings: Option<&commands::ComfyUISettings>,
    existing: Option<&str>,
    filename: &str,
) -> Option<PathBuf> {
    if let Some(candidate) = existing
        .and_then(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        })
        .filter(|path| path.exists())
    {
        return Some(candidate);
    }

    for dir in comfy_audio_search_dirs(settings) {
        let candidate = dir.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn comfy_image_search_dirs(settings: Option<&commands::ComfyUISettings>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(settings) = settings {
        if let Some(ref output_dir) = settings
            .output_dir
            .as_ref()
            .and_then(|s| Some(s.trim().to_string()))
            .filter(|s| !s.is_empty())
        {
            let base = PathBuf::from(output_dir);
            if base.exists() {
                dirs.push(base.clone());
            }
            let images_dir = base.join("images");
            if images_dir.exists() {
                dirs.push(images_dir);
            }
        }
        if let Some(ref working_dir) = settings
            .working_directory
            .as_ref()
            .and_then(|s| Some(s.trim().to_string()))
            .filter(|s| !s.is_empty())
        {
            let working = PathBuf::from(working_dir);
            let output = working.join("output");
            if output.exists() {
                dirs.push(output.clone());
            }
            let images = output.join("images");
            if images.exists() {
                dirs.push(images);
            }
        }
    }
    if cfg!(target_os = "windows") {
        let win_base = PathBuf::from(r"C:\Comfy\output");
        if win_base.exists() {
            dirs.push(win_base.clone());
        }
        let win_images = win_base.join("images");
        if win_images.exists() {
            dirs.push(win_images);
        }
    }
    let default_output = PathBuf::from("output");
    if default_output.exists() {
        dirs.push(default_output.clone());
    }
    let default_images = default_output.join("images");
    if default_images.exists() {
        dirs.push(default_images);
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut unique = Vec::new();
    for dir in dirs {
        let display = dir.to_string_lossy().to_string();
        if seen.insert(display.clone()) {
            unique.push(dir);
        }
    }
    unique
}

fn resolve_comfy_image_path(
    settings: Option<&commands::ComfyUISettings>,
    existing: Option<&str>,
    filename: &str,
) -> Option<PathBuf> {
    if let Some(candidate) = existing
        .and_then(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(PathBuf::from(trimmed))
            }
        })
        .filter(|path| path.exists())
    {
        return Some(candidate);
    }

    for dir in comfy_image_search_dirs(settings) {
        let candidate = dir.join(filename);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
fn list_completed_jobs(registry: State<JobRegistry>) -> Vec<JobSummary> {
    let mut history = registry.list_history();
    history.sort_by(|a, b| {
        let at = a.finished_at.unwrap_or(a.created_at);
        let bt = b.finished_at.unwrap_or(b.created_at);
        bt.cmp(&at)
    });
    history
        .into_iter()
        .map(|record| JobSummary {
            id: record.id,
            status: record.status_text(),
            created_at: Some(format_timestamp(record.created_at)),
            finished_at: record.finished_at.map(format_timestamp),
            kind: record.kind.clone(),
            label: record.label.clone(),
            source: record.source.clone(),
            args: record.args.clone(),
        })
        .collect()
}

#[tauri::command]
fn stable_audio_output_files(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<AudioOutputEntry>, String> {
    let settings = commands::get_comfyui_settings(app)
        .map(Some)
        .unwrap_or(None);
    let mut files: Vec<AudioOutputEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for dir in comfy_audio_search_dirs(settings.as_ref()) {
        let entries = match fs::read_dir(&dir) {
            Ok(iter) => iter,
            Err(err) => {
                eprintln!(
                    "[blossom] stable_audio_output_files: failed to read {}: {}",
                    dir.to_string_lossy(),
                    err
                );
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if !matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some(ext) if ext.eq_ignore_ascii_case("flac")
            ) {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            if !seen.insert(path_str.clone()) {
                continue;
            }
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            files.push(AudioOutputEntry {
                name,
                path: path_str,
                modified_ms,
            });
        }
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    if let Some(limit) = limit {
        if files.len() > limit {
            files.truncate(limit);
        }
    }
    Ok(files)
}

#[tauri::command]
fn ace_output_files(app: AppHandle, limit: Option<usize>) -> Result<Vec<AudioOutputEntry>, String> {
    stable_audio_output_files(app, limit)
}

#[tauri::command]
fn register_job_artifacts(
    registry: State<JobRegistry>,
    job_id: u64,
    artifacts: Vec<JobArtifact>,
) -> Result<(), String> {
    let mut jobs = registry.jobs.lock().map_err(|e| e.to_string())?;
    if let Some(job) = jobs.get_mut(&job_id) {
        let mut stored = job.artifacts.lock().unwrap();
        for artifact in artifacts {
            if !stored.iter().any(|a| a.path == artifact.path) {
                stored.push(artifact);
            }
        }
        return Ok(());
    }
    drop(jobs);
    let mut history = registry.history.lock().map_err(|e| e.to_string())?;
    if let Some(record) = history.iter_mut().find(|r| r.id == job_id) {
        for artifact in artifacts {
            if !record.artifacts.iter().any(|a| a.path == artifact.path) {
                record.artifacts.push(artifact);
            }
        }
    } else {
        return Err("Unknown job_id".into());
    }
    drop(history);
    if let Err(err) = registry.persist_history() {
        eprintln!(
            "failed to persist job history after artifact registration: {}",
            err
        );
    }
    Ok(())
}

#[tauri::command]
fn prune_job_history(registry: State<JobRegistry>, retain: usize) {
    registry.prune_history(retain);
}

fn preview_text(source: &str, max_len: usize) -> String {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx >= max_len {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn stable_audio_job_label(prompt: &str) -> String {
    let snippet = preview_text(prompt, 42);
    if snippet.is_empty() {
        "Stable Diffusion Render".to_string()
    } else {
        format!("Stable Diffusion · {}", snippet)
    }
}

fn lofi_scene_job_label(prompt: &str) -> String {
    let snippet = preview_text(prompt, 42);
    if snippet.is_empty() {
        "Lofi Scene Maker Render".to_string()
    } else {
        format!("Lofi Scene Maker - {}", snippet)
    }
}

#[tauri::command]
fn queue_lofi_scene_job(app: AppHandle, registry: State<JobRegistry>) -> Result<u64, String> {
    let prompts = commands::get_lofi_scene_prompts()?;
    let label = lofi_scene_job_label(&prompts.prompt);

    let context = JobContext {
        kind: Some("lofi_scene_render".into()),
        label: Some(label),
        source: Some("Lofi Scene Maker".into()),
        artifact_candidates: Vec::new(),
    };

    let job_id = registry.next_id();
    let job = JobInfo::new_pending(Vec::new(), &context);
    let initial_snapshot = JobProgressSnapshot {
        stage: Some("preparing".into()),
        percent: Some(0),
        message: Some("Preparing Lofi Scene Maker workflow.".into()),
        eta: None,
        step: None,
        total: None,
        queue_position: None,
        queue_eta_seconds: None,
    };
    registry.register_running_job(&app, job_id, job, initial_snapshot);

    let prompt_preview = preview_text(&prompts.prompt, 160);
    if !prompt_preview.is_empty() {
        registry.append_job_stdout(job_id, &format!("Prompt: {}", prompt_preview));
    }
    let negative_preview = preview_text(&prompts.negative_prompt, 160);
    if !negative_preview.is_empty() {
        registry.append_job_stdout(job_id, &format!("Negative prompt: {}", negative_preview));
    }
    if !prompts.file_name_prefix.trim().is_empty() {
        registry.append_job_stdout(
            job_id,
            &format!("Filename prefix: {}", prompts.file_name_prefix.trim()),
        );
    }
    registry.append_job_stdout(job_id, &format!("Seed: {}", prompts.seed));
    registry.append_job_stdout(
        job_id,
        &format!("Seed behavior: {}", prompts.seed_behavior),
    );
    registry.append_job_stdout(job_id, &format!("Steps: {}", prompts.steps));
    registry.append_job_stdout(job_id, &format!("Batch size: {}", prompts.batch_size));
    registry.append_job_stdout(job_id, &format!("CFG: {:.3}", prompts.cfg));
    registry.append_job_stdout(job_id, "Submitting Lofi Scene Maker workflow to ComfyUI...");

    let app_handle = app.clone();
    let prompt_text = prompts.prompt;
    let negative_prompt = prompts.negative_prompt;
    let file_prefix = prompts.file_name_prefix;
    let seed = prompts.seed;
    let seed_behavior = prompts.seed_behavior.clone();
    let steps = prompts.steps;
    let cfg = prompts.cfg;

    async_runtime::spawn(async move {
        run_lofi_scene_job(
            app_handle,
            job_id,
            prompt_text,
            negative_prompt,
            file_prefix,
            seed,
            seed_behavior,
            steps,
            cfg,
        )
        .await;
    });

    Ok(job_id)
}

fn gallery_category_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" => Some("image"),
        "wav" | "mp3" | "ogg" | "flac" | "m4a" | "aac" => Some("audio"),
        "mp4" | "mov" | "webm" | "mkv" | "avi" | "m4v" => Some("video"),
        _ => None,
    }
}

fn copy_artifact_into_gallery(
    job_id: u64,
    artifact: &JobArtifact,
) -> Result<Option<JobArtifact>, String> {
    let source = Path::new(&artifact.path);
    if !source.exists() || !source.is_file() {
        return Ok(None);
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let Some(category) = gallery_category_for_extension(&extension) else {
        return Ok(None);
    };

    let gallery_dir = project_root().join("assets").join("gallery").join(category);
    if !gallery_dir.exists() {
        fs::create_dir_all(&gallery_dir).map_err(|err| {
            format!(
                "Unable to create gallery directory {}: {}",
                gallery_dir.to_string_lossy(),
                err
            )
        })?;
    }

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("output");
    let mut candidate = gallery_dir.join(file_name);

    if candidate.exists() {
        let stem = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("output");
        let original_ext = source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");
        let mut counter = 1usize;
        loop {
            let new_name = if original_ext.is_empty() {
                format!("{}-{}-{}", stem, job_id, counter)
            } else {
                format!("{}-{}-{}.{}", stem, job_id, counter, original_ext)
            };
            candidate = gallery_dir.join(new_name);
            if !candidate.exists() {
                break;
            }
            counter += 1;
        }
    }

    fs::copy(source, &candidate).map_err(|err| {
        format!(
            "Failed to copy {} to gallery: {}",
            source.to_string_lossy(),
            err
        )
    })?;

    let stored_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(file_name)
        .to_string();

    Ok(Some(JobArtifact {
        name: stored_name,
        path: candidate.to_string_lossy().to_string(),
    }))
}

async fn run_lofi_scene_job(
    app_handle: AppHandle,
    job_id: u64,
    prompt_text: String,
    negative_prompt: String,
    file_prefix: String,
    seed: i64,
    seed_behavior: String,
    steps: f64,
    cfg: f64,
) {
    let comfy_settings = commands::get_comfyui_settings(app_handle.clone()).ok();
    let mut final_success = false;
    let mut final_message: Option<String> = None;
    debug_assert!(final_message.is_none());

    match commands::comfyui_submit_lofi_scene(app_handle.clone()).await {
        Ok(response) => {
            {
                let registry = app_handle.state::<JobRegistry>();
                registry.append_job_stdout(
                    job_id,
                    &format!("ComfyUI prompt id: {}", response.prompt_id),
                );
                registry.update_job_progress(
                    &app_handle,
                    job_id,
                    JobProgressSnapshot {
                        stage: Some("submitted".into()),
                        percent: Some(15),
                        message: Some("Workflow submitted to ComfyUI.".into()),
                        eta: None,
                        step: None,
                        total: None,
                        queue_position: None,
                        queue_eta_seconds: None,
                    },
                );
            }

            let prompt_id = response.prompt_id.clone();
            let mut consecutive_errors = 0usize;
            loop {
                if app_handle.state::<JobRegistry>().is_job_done(job_id) {
                    return;
                }

                match commands::comfyui_job_status(app_handle.clone(), prompt_id.clone()).await {
                    Ok(status) => {
                        consecutive_errors = 0;
                        let status_lower = status.status.to_ascii_lowercase();
                        match status_lower.as_str() {
                            "queued" => {
                                let message = if status.pending > 0 {
                                    format!("ComfyUI queue · {} pending", status.pending)
                                } else {
                                    "ComfyUI queue".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("queued".into()),
                                        percent: Some(20),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "running" => {
                                let message = if status.pending > 0 {
                                    format!(
                                        "ComfyUI rendering · {} pending, {} active",
                                        status.pending, status.running
                                    )
                                } else {
                                    "ComfyUI rendering".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("running".into()),
                                        percent: Some(55),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "completed" => {
                                let message = status
                                    .message
                                    .clone()
                                    .unwrap_or_else(|| "ComfyUI render complete.".to_string());
                                let artifacts: Vec<JobArtifact> = status
                                    .outputs
                                    .iter()
                                    .filter_map(|output| {
                                        resolve_comfy_image_path(
                                            comfy_settings.as_ref(),
                                            output.local_path.as_deref(),
                                            &output.filename,
                                        )
                                        .map(|path| JobArtifact {
                                            name: output.filename.clone(),
                                            path: path.to_string_lossy().to_string(),
                                        })
                                    })
                                    .collect();

                                if !artifacts.is_empty() {
                                    if let Err(err) = register_job_artifacts(
                                        app_handle.state::<JobRegistry>(),
                                        job_id,
                                        artifacts.clone(),
                                    ) {
                                        let registry = app_handle.state::<JobRegistry>();
                                        registry.append_job_stderr(
                                            job_id,
                                            &format!(
                                                "Failed to register ComfyUI artifacts: {}",
                                                err
                                            ),
                                        );
                                    }
                                }

                                let mut gallery_artifacts: Vec<JobArtifact> = Vec::new();
                                for artifact in &artifacts {
                                    match copy_artifact_into_gallery(job_id, artifact) {
                                        Ok(Some(copy)) => gallery_artifacts.push(copy),
                                        Ok(None) => {}
                                        Err(err) => {
                                            let registry = app_handle.state::<JobRegistry>();
                                            registry.append_job_stderr(
                                                job_id,
                                                &format!(
                                                    "Failed to copy artifact into gallery: {}",
                                                    err
                                                ),
                                            );
                                        }
                                    }
                                }

                                if !gallery_artifacts.is_empty() {
                                    if let Err(err) = register_job_artifacts(
                                        app_handle.state::<JobRegistry>(),
                                        job_id,
                                        gallery_artifacts.clone(),
                                    ) {
                                        let registry = app_handle.state::<JobRegistry>();
                                        registry.append_job_stderr(
                                            job_id,
                                            &format!(
                                                "Failed to register gallery artifacts: {}",
                                                err
                                            ),
                                        );
                                    }
                                }

                                {
                                    let registry = app_handle.state::<JobRegistry>();
                                    if !artifacts.is_empty() {
                                        for artifact in &artifacts {
                                            registry.append_job_stdout(
                                                job_id,
                                                &format!("Artifact saved: {}", artifact.path),
                                            );
                                        }
                                    }
                                    if !gallery_artifacts.is_empty() {
                                        for artifact in &gallery_artifacts {
                                            registry.append_job_stdout(
                                                job_id,
                                                &format!("Gallery copy saved: {}", artifact.path),
                                            );
                                        }
                                    }
                                    let summary = json!({
                                        "prompt": prompt_text,
                                        "negativePrompt": negative_prompt,
                                        "fileNamePrefix": file_prefix,
                                        "seed": seed,
                                        "seedBehavior": seed_behavior,
                                        "steps": steps,
                                        "cfg": cfg,
                                        "outputs": artifacts.iter().map(|a| a.path.clone()).collect::<Vec<_>>(),
                                        "galleryCopies": gallery_artifacts.iter().map(|a| a.path.clone()).collect::<Vec<_>>(),
                                    });
                                    registry.append_job_stdout(
                                        job_id,
                                        &format!("SUMMARY: {}", summary.to_string()),
                                    );
                                    registry.update_job_progress(
                                        &app_handle,
                                        job_id,
                                        JobProgressSnapshot {
                                            stage: Some("completed".into()),
                                            percent: Some(100),
                                            message: Some(message.clone()),
                                            eta: None,
                                            step: None,
                                            total: None,
                                            queue_position: None,
                                            queue_eta_seconds: None,
                                        },
                                    );
                                }

                                final_success = true;
                                final_message = Some(message);
                                break;
                            }
                            "error" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI reported an error.".to_string()),
                                );
                                break;
                            }
                            "offline" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI appears offline.".to_string()),
                                );
                                break;
                            }
                            other => {
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some(other.to_string()),
                                        percent: Some(40),
                                        message: status.message.clone(),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                        }
                    }
                    Err(err) => {
                        consecutive_errors += 1;
                        let message = format!("Failed to poll ComfyUI status: {}", err);
                        {
                            let registry = app_handle.state::<JobRegistry>();
                            registry.append_job_stderr(job_id, &message);
                        }
                        if consecutive_errors >= 3 {
                            final_message = Some(message);
                            break;
                        }
                    }
                }

                sleep(Duration::from_millis(1500)).await;
            }
        }
        Err(err) => {
            final_message = Some(format!("Failed to submit workflow to ComfyUI: {}", err));
        }
    }

    if app_handle.state::<JobRegistry>().is_job_done(job_id) {
        return;
    }

    if final_success {
        let message = final_message.unwrap_or_else(|| "ComfyUI render complete.".into());
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stdout(job_id, &message);
        registry.complete_job(&app_handle, job_id, true, Some(0), false);
        return;
    }

    let message = final_message.unwrap_or_else(|| "Lofi Scene Maker job failed.".into());

    {
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stderr(job_id, &message);
        registry.update_job_progress(
            &app_handle,
            job_id,
            JobProgressSnapshot {
                stage: Some("error".into()),
                percent: Some(100),
                message: Some(message.clone()),
                eta: None,
                step: None,
                total: None,
                queue_position: None,
                queue_eta_seconds: None,
            },
        );
    }

    let registry = app_handle.state::<JobRegistry>();
    registry.complete_job(&app_handle, job_id, false, Some(1), false);
}

#[tauri::command]
fn queue_stable_audio_job(app: AppHandle, registry: State<JobRegistry>) -> Result<u64, String> {
    let prompts = commands::get_stable_audio_prompts()?;
    let label = stable_audio_job_label(&prompts.prompt);
    let mut args = Vec::new();
    args.push(format!("seconds={:.3}", prompts.seconds));
    args.push(format!("filePrefix={}", prompts.file_name_prefix));

    let context = JobContext {
        kind: Some("stable_audio_render".into()),
        label: Some(label),
        source: Some("Stable Diffusion".into()),
        artifact_candidates: Vec::new(),
    };

    let job_id = registry.next_id();
    let job = JobInfo::new_pending(args, &context);
    let initial_snapshot = JobProgressSnapshot {
        stage: Some("preparing".into()),
        percent: Some(0),
        message: Some("Preparing Stable Diffusion workflow.".into()),
        eta: None,
        step: None,
        total: None,
        queue_position: None,
        queue_eta_seconds: None,
    };
    registry.register_running_job(&app, job_id, job, initial_snapshot);

    let prompt_preview = preview_text(&prompts.prompt, 160);
    if !prompt_preview.is_empty() {
        registry.append_job_stdout(job_id, &format!("Prompt: {}", prompt_preview));
    }
    let negative_preview = preview_text(&prompts.negative_prompt, 160);
    if !negative_preview.is_empty() {
        registry.append_job_stdout(job_id, &format!("Negative prompt: {}", negative_preview));
    }
    registry.append_job_stdout(job_id, &format!("Seconds: {:.3}", prompts.seconds.max(0.0)));
    if !prompts.file_name_prefix.trim().is_empty() {
        registry.append_job_stdout(
            job_id,
            &format!("Filename prefix: {}", prompts.file_name_prefix.trim()),
        );
    }
    registry.append_job_stdout(job_id, "Submitting Stable Diffusion workflow to ComfyUI...");

    let app_handle = app.clone();
    let prompt_text = prompts.prompt;
    let negative_prompt = prompts.negative_prompt;
    let file_prefix = prompts.file_name_prefix;
    let seconds = prompts.seconds;

    async_runtime::spawn(async move {
        run_stable_audio_job(
            app_handle,
            job_id,
            prompt_text,
            negative_prompt,
            file_prefix,
            seconds,
        )
        .await;
    });

    Ok(job_id)
}

async fn run_stable_audio_job(
    app_handle: AppHandle,
    job_id: u64,
    prompt_text: String,
    negative_prompt: String,
    file_prefix: String,
    seconds: f64,
) {
    let comfy_settings = commands::get_comfyui_settings(app_handle.clone()).ok();
    let mut final_success = false;
    let mut final_message: Option<String> = None;
    debug_assert!(final_message.is_none());

    match commands::comfyui_submit_stable_audio(app_handle.clone()).await {
        Ok(response) => {
            {
                let registry = app_handle.state::<JobRegistry>();
                registry.append_job_stdout(
                    job_id,
                    &format!("ComfyUI prompt id: {}", response.prompt_id),
                );
                registry.update_job_progress(
                    &app_handle,
                    job_id,
                    JobProgressSnapshot {
                        stage: Some("queued".into()),
                        percent: Some(5),
                        message: Some("ComfyUI job queued.".into()),
                        eta: None,
                        step: None,
                        total: None,
                        queue_position: None,
                        queue_eta_seconds: None,
                    },
                );
            }

            let prompt_id = response.prompt_id.clone();
            let mut consecutive_errors = 0usize;
            loop {
                if app_handle.state::<JobRegistry>().is_job_done(job_id) {
                    return;
                }

                match commands::comfyui_job_status(app_handle.clone(), prompt_id.clone()).await {
                    Ok(status) => {
                        consecutive_errors = 0;
                        let status_lower = status.status.to_ascii_lowercase();
                        match status_lower.as_str() {
                            "queued" => {
                                let message = if status.pending > 0 {
                                    format!("ComfyUI queue · {} pending", status.pending)
                                } else {
                                    "ComfyUI queue".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("queued".into()),
                                        percent: Some(10),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "running" => {
                                let message = if status.pending > 0 {
                                    format!(
                                        "ComfyUI rendering · {} pending, {} active",
                                        status.pending, status.running
                                    )
                                } else {
                                    "ComfyUI rendering".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("running".into()),
                                        percent: Some(55),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "completed" => {
                                let message = status
                                    .message
                                    .clone()
                                    .unwrap_or_else(|| "ComfyUI render complete.".to_string());
                                let artifacts: Vec<JobArtifact> = status
                                    .outputs
                                    .iter()
                                    .filter_map(|output| {
                                        resolve_comfy_audio_path(
                                            comfy_settings.as_ref(),
                                            output.local_path.as_deref(),
                                            &output.filename,
                                        )
                                        .map(|path| {
                                            JobArtifact {
                                                name: output.filename.clone(),
                                                path: path.to_string_lossy().to_string(),
                                            }
                                        })
                                    })
                                    .collect();

                                if !artifacts.is_empty() {
                                    if let Err(err) = register_job_artifacts(
                                        app_handle.state::<JobRegistry>(),
                                        job_id,
                                        artifacts.clone(),
                                    ) {
                                        let registry = app_handle.state::<JobRegistry>();
                                        registry.append_job_stderr(
                                            job_id,
                                            &format!(
                                                "Failed to register ComfyUI artifacts: {}",
                                                err
                                            ),
                                        );
                                    }
                                }

                                {
                                    let registry = app_handle.state::<JobRegistry>();
                                    if !artifacts.is_empty() {
                                        for artifact in &artifacts {
                                            registry.append_job_stdout(
                                                job_id,
                                                &format!("Artifact saved: {}", artifact.path),
                                            );
                                        }
                                    }
                                    let summary = json!({
                                        "prompt": prompt_text,
                                        "negativePrompt": negative_prompt,
                                        "fileNamePrefix": file_prefix,
                                        "seconds": seconds,
                                        "outputs": artifacts.iter().map(|a| a.path.clone()).collect::<Vec<_>>(),
                                    });
                                    registry.append_job_stdout(
                                        job_id,
                                        &format!("SUMMARY: {}", summary.to_string()),
                                    );
                                    registry.update_job_progress(
                                        &app_handle,
                                        job_id,
                                        JobProgressSnapshot {
                                            stage: Some("completed".into()),
                                            percent: Some(100),
                                            message: Some(message.clone()),
                                            eta: None,
                                            step: None,
                                            total: None,
                                            queue_position: None,
                                            queue_eta_seconds: None,
                                        },
                                    );
                                }

                                final_success = true;
                                final_message = Some(message);
                                break;
                            }
                            "error" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI reported an error.".to_string()),
                                );
                                break;
                            }
                            "offline" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI appears offline.".to_string()),
                                );
                                break;
                            }
                            other => {
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some(other.to_string()),
                                        percent: Some(35),
                                        message: status.message.clone(),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                        }
                    }
                    Err(err) => {
                        consecutive_errors += 1;
                        let message = format!("Failed to poll ComfyUI status: {}", err);
                        {
                            let registry = app_handle.state::<JobRegistry>();
                            registry.append_job_stderr(job_id, &message);
                        }
                        if consecutive_errors >= 3 {
                            final_message = Some(message);
                            break;
                        }
                    }
                }

                sleep(Duration::from_millis(1500)).await;
            }
        }
        Err(err) => {
            final_message = Some(format!("Failed to submit workflow to ComfyUI: {}", err));
        }
    }

    if app_handle.state::<JobRegistry>().is_job_done(job_id) {
        return;
    }

    if final_success {
        let message = final_message.unwrap_or_else(|| "ComfyUI render complete.".into());
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stdout(job_id, &message);
        registry.complete_job(&app_handle, job_id, true, Some(0), false);
        return;
    }

    let message = final_message.unwrap_or_else(|| "Stable Diffusion job failed.".into());

    {
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stderr(job_id, &message);
        registry.update_job_progress(
            &app_handle,
            job_id,
            JobProgressSnapshot {
                stage: Some("error".into()),
                percent: Some(100),
                message: Some(message.clone()),
                eta: None,
                step: None,
                total: None,
                queue_position: None,
                queue_eta_seconds: None,
            },
        );
    }

    let registry = app_handle.state::<JobRegistry>();
    registry.complete_job(&app_handle, job_id, false, Some(1), false);
}

fn ace_job_label(prompt: &str) -> String {
    let snippet = preview_text(prompt, 42);
    if snippet.is_empty() {
        "ACE Step Render".to_string()
    } else {
        format!("ACE Step · {}", snippet)
    }
}

#[tauri::command]
fn queue_ace_audio_job(app: AppHandle, registry: State<JobRegistry>) -> Result<u64, String> {
    let prompts = commands::get_ace_workflow_prompts()?;
    let label = ace_job_label(&prompts.style_prompt);

    let mut args = Vec::new();
    args.push(format!("bpm={:.3}", prompts.bpm));
    args.push(format!("guidance={:.3}", prompts.guidance));

    let context = JobContext {
        kind: Some("ace_audio_render".into()),
        label: Some(label),
        source: Some("ACE Step".into()),
        artifact_candidates: Vec::new(),
    };

    let job_id = registry.next_id();
    let job = JobInfo::new_pending(args, &context);
    let initial_snapshot = JobProgressSnapshot {
        stage: Some("preparing".into()),
        percent: Some(0),
        message: Some("Preparing ACE Step workflow.".into()),
        eta: None,
        step: None,
        total: None,
        queue_position: None,
        queue_eta_seconds: None,
    };
    registry.register_running_job(&app, job_id, job, initial_snapshot);

    let style_preview = preview_text(&prompts.style_prompt, 160);
    if !style_preview.is_empty() {
        registry.append_job_stdout(job_id, &format!("Style prompt: {}", style_preview));
    }
    if !prompts.song_form.trim().is_empty() {
        registry.append_job_stdout(job_id, "Song form blueprint:");
        for line in prompts.song_form.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            registry.append_job_stdout(job_id, &format!("  {}", trimmed));
        }
    }
    registry.append_job_stdout(job_id, &format!("Tempo: {:.2} BPM", prompts.bpm));
    registry.append_job_stdout(job_id, &format!("Guidance: {:.3}", prompts.guidance));
    registry.append_job_stdout(job_id, "Submitting ACE Step workflow to ComfyUI...");

    let app_handle = app.clone();
    let style_prompt = prompts.style_prompt;
    let song_form = prompts.song_form;
    let bpm = prompts.bpm;
    let guidance = prompts.guidance;

    async_runtime::spawn(async move {
        run_ace_audio_job(app_handle, job_id, style_prompt, song_form, bpm, guidance).await;
    });

    Ok(job_id)
}

async fn run_ace_audio_job(
    app_handle: AppHandle,
    job_id: u64,
    style_prompt: String,
    song_form: String,
    bpm: f64,
    guidance: f64,
) {
    let comfy_settings = commands::get_comfyui_settings(app_handle.clone()).ok();
    let mut final_success = false;
    let mut final_message: Option<String> = None;
    debug_assert!(final_message.is_none());

    match commands::comfyui_submit_ace_audio(app_handle.clone()).await {
        Ok(response) => {
            {
                let registry = app_handle.state::<JobRegistry>();
                registry.append_job_stdout(
                    job_id,
                    &format!("ComfyUI prompt id: {}", response.prompt_id),
                );
                registry.update_job_progress(
                    &app_handle,
                    job_id,
                    JobProgressSnapshot {
                        stage: Some("queued".into()),
                        percent: Some(5),
                        message: Some("ComfyUI job queued.".into()),
                        eta: None,
                        step: None,
                        total: None,
                        queue_position: None,
                        queue_eta_seconds: None,
                    },
                );
            }

            let prompt_id = response.prompt_id.clone();
            let mut consecutive_errors = 0usize;
            loop {
                if app_handle.state::<JobRegistry>().is_job_done(job_id) {
                    return;
                }

                match commands::comfyui_job_status(app_handle.clone(), prompt_id.clone()).await {
                    Ok(status) => {
                        consecutive_errors = 0;
                        let status_lower = status.status.to_ascii_lowercase();
                        match status_lower.as_str() {
                            "queued" => {
                                let message = if status.pending > 0 {
                                    format!("ComfyUI queue · {} pending", status.pending)
                                } else {
                                    "ComfyUI queue".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("queued".into()),
                                        percent: Some(10),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "running" => {
                                let message = if status.pending > 0 {
                                    format!(
                                        "ComfyUI rendering · {} pending, {} active",
                                        status.pending, status.running
                                    )
                                } else {
                                    "ComfyUI rendering".to_string()
                                };
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some("running".into()),
                                        percent: Some(55),
                                        message: Some(message),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                            "completed" => {
                                let message = status
                                    .message
                                    .clone()
                                    .unwrap_or_else(|| "ComfyUI render complete.".to_string());
                                let artifacts: Vec<JobArtifact> = status
                                    .outputs
                                    .iter()
                                    .filter_map(|output| {
                                        resolve_comfy_audio_path(
                                            comfy_settings.as_ref(),
                                            output.local_path.as_deref(),
                                            &output.filename,
                                        )
                                        .map(|path| {
                                            JobArtifact {
                                                name: output.filename.clone(),
                                                path: path.to_string_lossy().to_string(),
                                            }
                                        })
                                    })
                                    .collect();

                                if !artifacts.is_empty() {
                                    if let Err(err) = register_job_artifacts(
                                        app_handle.state::<JobRegistry>(),
                                        job_id,
                                        artifacts.clone(),
                                    ) {
                                        let registry = app_handle.state::<JobRegistry>();
                                        registry.append_job_stderr(
                                            job_id,
                                            &format!(
                                                "Failed to register ComfyUI artifacts: {}",
                                                err
                                            ),
                                        );
                                    }
                                }

                                {
                                    let registry = app_handle.state::<JobRegistry>();
                                    if !artifacts.is_empty() {
                                        for artifact in &artifacts {
                                            registry.append_job_stdout(
                                                job_id,
                                                &format!("Artifact saved: {}", artifact.path),
                                            );
                                        }
                                    }
                                    let summary = json!({
                                        "stylePrompt": style_prompt,
                                        "songForm": song_form,
                                        "bpm": bpm,
                                        "guidance": guidance,
                                        "outputs": artifacts.iter().map(|a| a.path.clone()).collect::<Vec<_>>(),
                                    });
                                    registry.append_job_stdout(
                                        job_id,
                                        &format!("SUMMARY: {}", summary.to_string()),
                                    );
                                    registry.update_job_progress(
                                        &app_handle,
                                        job_id,
                                        JobProgressSnapshot {
                                            stage: Some("completed".into()),
                                            percent: Some(100),
                                            message: Some(message.clone()),
                                            eta: None,
                                            step: None,
                                            total: None,
                                            queue_position: None,
                                            queue_eta_seconds: None,
                                        },
                                    );
                                }

                                final_success = true;
                                final_message = Some(message);
                                break;
                            }
                            "error" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI reported an error.".to_string()),
                                );
                                break;
                            }
                            "offline" => {
                                final_message = Some(
                                    status
                                        .message
                                        .unwrap_or_else(|| "ComfyUI appears offline.".to_string()),
                                );
                                break;
                            }
                            other => {
                                let registry = app_handle.state::<JobRegistry>();
                                registry.update_job_progress(
                                    &app_handle,
                                    job_id,
                                    JobProgressSnapshot {
                                        stage: Some(other.to_string()),
                                        percent: Some(35),
                                        message: status.message.clone(),
                                        eta: None,
                                        step: None,
                                        total: None,
                                        queue_position: None,
                                        queue_eta_seconds: None,
                                    },
                                );
                            }
                        }
                    }
                    Err(err) => {
                        consecutive_errors += 1;
                        let message = format!("Failed to poll ComfyUI status: {}", err);
                        {
                            let registry = app_handle.state::<JobRegistry>();
                            registry.append_job_stderr(job_id, &message);
                        }
                        if consecutive_errors >= 3 {
                            final_message = Some(message);
                            break;
                        }
                    }
                }

                sleep(Duration::from_millis(1500)).await;
            }
        }
        Err(err) => {
            final_message = Some(format!("Failed to submit workflow to ComfyUI: {}", err));
        }
    }

    if app_handle.state::<JobRegistry>().is_job_done(job_id) {
        return;
    }

    if final_success {
        let message = final_message.unwrap_or_else(|| "ACE Step render complete.".into());
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stdout(job_id, &message);
        registry.complete_job(&app_handle, job_id, true, Some(0), false);
        return;
    }

    let message = final_message.unwrap_or_else(|| "ACE Step job failed.".into());

    {
        let registry = app_handle.state::<JobRegistry>();
        registry.append_job_stderr(job_id, &message);
        registry.update_job_progress(
            &app_handle,
            job_id,
            JobProgressSnapshot {
                stage: Some("error".into()),
                percent: Some(100),
                message: Some(message.clone()),
                eta: None,
                step: None,
                total: None,
                queue_position: None,
                queue_eta_seconds: None,
            },
        );
    }

    let registry = app_handle.state::<JobRegistry>();
    registry.complete_job(&app_handle, job_id, false, Some(1), false);
}

#[tauri::command]
fn queue_musicgen_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: MusicGenJobRequest,
) -> Result<u64, String> {
    if options.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".into());
    }
    if options.duration <= 0.0 {
        return Err("Duration must be greater than zero".into());
    }

    // Always invoke the script from the project root to avoid relative path confusion.
    let script = project_root()
        .join("main_musicgen.py")
        .to_string_lossy()
        .to_string();

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let default_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jobs")
        .join("musicgen")
        .join(format!("musicgen-{}", timestamp));

    let output_dir = options
        .output_dir
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let fallback_name = format!("musicgen-{}", timestamp);
    let base_name = sanitize_musicgen_base_name(options.output_name.as_deref(), &fallback_name);

    let mut count = options.count.unwrap_or(1);
    if count == 0 {
        count = 1;
    } else if count > 10 {
        count = 10;
    }

    let width = if count > 1 {
        ((count as f32).log10().floor() as usize) + 1
    } else {
        0
    };

    let mut filenames = Vec::with_capacity(count as usize);
    for idx in 0..count {
        let mut name = if count > 1 {
            format!("{}_{:0width$}", base_name, idx + 1, width = width)
        } else {
            base_name.clone()
        };
        if !name.to_lowercase().ends_with(".wav") {
            name.push_str(".wav");
        }
        filenames.push(name);
    }

    let summary_path = output_dir.join(format!("musicgen-summary-{}.json", timestamp));

    let mut artifact_candidates = Vec::new();
    for fname in &filenames {
        let path = output_dir.join(fname);
        let display = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(fname)
            .to_string();
        artifact_candidates.push(JobArtifactCandidate {
            name: display,
            path,
        });
    }
    artifact_candidates.push(JobArtifactCandidate {
        name: "Summary JSON".into(),
        path: summary_path.clone(),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Output Directory".into(),
        path: output_dir.clone(),
    });

    let mut args = vec![script];
    args.push("--prompt".into());
    args.push(options.prompt.clone());
    args.push("--duration".into());
    args.push(format!("{}", options.duration));
    args.push("--model".into());
    args.push(options.model_name.clone());
    args.push("--temperature".into());
    args.push(format!("{}", options.temperature));
    args.push("--output-dir".into());
    args.push(output_dir.to_string_lossy().to_string());
    args.push("--count".into());
    args.push(count.to_string());
    args.push("--base-name".into());
    args.push(base_name.clone());
    args.push("--summary-path".into());
    args.push(summary_path.to_string_lossy().to_string());

    if let Some(melody) = options
        .melody_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        args.push("--melody-path".into());
        args.push(melody.to_string());
    }

    if options.force_cpu.unwrap_or(false) {
        args.push("--force-cpu".into());
    } else {
        if options.force_gpu.unwrap_or(false) {
            args.push("--force-gpu".into());
        }
        if options.use_fp16.unwrap_or(false) {
            args.push("--use-fp16".into());
        }
    }

    let label_source = options
        .output_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let prompt_trim = options.prompt.trim();
            if prompt_trim.is_empty() {
                format!("MusicGen {}", timestamp)
            } else {
                let mut preview: String = prompt_trim.chars().take(80).collect();
                if prompt_trim.chars().count() > 80 {
                    preview.push('\u{2026}');
                }
                preview
            }
        });
    let label: String = label_source.chars().take(120).collect();

    let context = JobContext {
        kind: Some("musicgen".into()),
        label: Some(label),
        source: Some("MusicGen".into()),
        artifact_candidates,
    };

    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn queue_render_job(
    app: AppHandle,
    registry: State<JobRegistry>,
    options: RenderJobRequest,
) -> Result<u64, String> {
    let mut args: Vec<String> = vec!["main_render.py".into(), "--verbose".into()];

    let base_output = if let Some(dir) = options.outdir.as_ref() {
        PathBuf::from(dir)
    } else {
        let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("jobs")
            .join(format!("render-{}", timestamp))
    };
    fs::create_dir_all(&base_output).map_err(|e| e.to_string())?;
    let stems_dir = base_output.join("stems");
    fs::create_dir_all(&stems_dir).map_err(|e| e.to_string())?;

    let sanitize = |s: &str| {
        let mut out = String::new();
        for ch in s.chars() {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ') {
                out.push(ch);
            } else {
                out.push('_');
            }
        }
        let trimmed = out.trim().trim_matches('.').to_string();
        if trimmed.is_empty() {
            "mix".to_string()
        } else {
            trimmed.chars().take(120).collect()
        }
    };

    let ensure_wav = |mut s: String| {
        if !s.to_lowercase().ends_with(".wav") {
            s.push_str(".wav");
        }
        s
    };

    let name = options.name.clone().unwrap_or_else(|| "mix".into());
    let mix_filename = ensure_wav(sanitize(&name));
    let mix_path = base_output.join(&mix_filename);
    let bundle_dir = base_output.clone();

    args.push("--mix".into());
    args.push(mix_path.to_string_lossy().to_string());
    args.push("--stems".into());
    args.push(stems_dir.to_string_lossy().to_string());
    args.push("--bundle".into());
    args.push(bundle_dir.to_string_lossy().to_string());

    if let Some(preset) = options.preset.filter(|s| !s.trim().is_empty()) {
        args.push("--preset".into());
        args.push(preset);
    }
    if let Some(style) = options.style.filter(|s| !s.trim().is_empty()) {
        args.push("--style".into());
        args.push(style);
    }
    if let Some(minutes) = options.minutes {
        args.push("--minutes".into());
        args.push(minutes.to_string());
    }
    if let Some(seed) = options.seed {
        args.push("--seed".into());
        args.push(seed.to_string());
    }
    if let Some(sampler_seed) = options.sampler_seed {
        args.push("--sampler-seed".into());
        args.push(sampler_seed.to_string());
    }
    if let Some(mix_preset) = options.mix_preset.filter(|s| !s.trim().is_empty()) {
        args.push("--mix-preset".into());
        args.push(mix_preset);
    }
    if let Some(arrange) = options.arrange.filter(|s| !s.trim().is_empty()) {
        args.push("--arrange".into());
        args.push(arrange);
    }
    if let Some(outro) = options.outro.filter(|s| !s.trim().is_empty()) {
        args.push("--outro".into());
        args.push(outro);
    }
    if let Some(preview) = options.preview {
        args.push("--preview".into());
        args.push(preview.to_string());
    }
    if options.bundle_stems.unwrap_or(false) {
        args.push("--bundle-stems".into());
    }
    if options.eval_only.unwrap_or(false) {
        args.push("--eval-only".into());
    }
    if options.dry_run.unwrap_or(false) {
        args.push("--dry-run".into());
    }
    if let Some(keys) = options.keys_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--keys-sfz".into());
        args.push(keys);
    }
    if let Some(pads) = options.pads_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--pads-sfz".into());
        args.push(pads);
    }
    if let Some(bass) = options.bass_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--bass-sfz".into());
        args.push(bass);
    }
    if let Some(drums) = options.drums_sfz.filter(|s| !s.trim().is_empty()) {
        args.push("--drums-sfz".into());
        args.push(drums);
    }
    if let Some(drums_model) = options.drums_model.filter(|s| !s.trim().is_empty()) {
        args.push("--drums-model".into());
        args.push(drums_model);
    }
    if let Some(bass_model) = options.bass_model.filter(|s| !s.trim().is_empty()) {
        args.push("--bass-model".into());
        args.push(bass_model);
    }
    if let Some(keys_model) = options.keys_model.filter(|s| !s.trim().is_empty()) {
        args.push("--keys-model".into());
        args.push(keys_model);
    }
    if let Some(melody) = options.melody_midi.filter(|s| !s.trim().is_empty()) {
        args.push("--melody-midi".into());
        args.push(melody);
    }
    match options.phrase {
        Some(true) => {
            args.push("--use-phrase-model".into());
            args.push("yes".into());
        }
        Some(false) => {
            args.push("--use-phrase-model".into());
            args.push("no".into());
        }
        None => {}
    }

    if let Some(mix_config) = options.mix_config.filter(|s| !s.trim().is_empty()) {
        let path = base_output.join("mix_config.json");
        fs::write(&path, mix_config).map_err(|e| e.to_string())?;
        args.push("--mix-config".into());
        args.push(path.to_string_lossy().to_string());
    }
    if let Some(arrange_config) = options.arrange_config.filter(|s| !s.trim().is_empty()) {
        let path = base_output.join("arrange_config.json");
        fs::write(&path, arrange_config).map_err(|e| e.to_string())?;
        args.push("--arrange-config".into());
        args.push(path.to_string_lossy().to_string());
    }

    let mut artifact_candidates = vec![JobArtifactCandidate {
        name: "Mix".into(),
        path: mix_path.clone(),
    }];
    let stems_mid = stems_dir.join("stems.mid");
    artifact_candidates.push(JobArtifactCandidate {
        name: "Stems MIDI".into(),
        path: stems_mid,
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Bundle ZIP".into(),
        path: bundle_dir.join("bundle.zip"),
    });
    artifact_candidates.push(JobArtifactCandidate {
        name: "Bundle Directory".into(),
        path: bundle_dir.clone(),
    });

    let context = JobContext {
        kind: Some("music-render".into()),
        label: Some(name),
        source: Some("Render".into()),
        artifact_candidates,
    };

    spawn_job_with_context(app, registry, args, context)
}

#[tauri::command]
fn record_manual_job(
    registry: State<JobRegistry>,
    kind: Option<String>,
    label: Option<String>,
    source: Option<String>,
    args: Option<Vec<String>>,
    artifacts: Option<Vec<JobArtifact>>,
    stdout: Option<Vec<String>>,
    stderr: Option<Vec<String>>,
    success: Option<bool>,
) -> u64 {
    let id = registry.next_id();
    let now = Utc::now();
    let record = JobRecord {
        id,
        kind,
        label,
        source,
        args: args.unwrap_or_default(),
        created_at: now,
        started_at: Some(now),
        finished_at: Some(now),
        success: success.or(Some(true)),
        exit_code: None,
        stdout_excerpt: stdout.unwrap_or_default(),
        stderr_excerpt: stderr.unwrap_or_default(),
        artifacts: artifacts.unwrap_or_default(),
        progress: None,
        cancelled: false,
    };
    registry.push_history(record);
    id
}

#[tauri::command]
fn discord_profile_get(guild_id: u64, channel_id: u64) -> Result<Value, String> {
    let mut cmd = python_command();
    let output = cmd
        .arg("-c")
        .arg(
            "import sys, json; from config.discord_profiles import get_profile; print(json.dumps(get_profile(int(sys.argv[1]), int(sys.argv[2]))))",
        )
        .arg(guild_id.to_string())
        .arg(channel_id.to_string())
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        let data: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn discord_profile_set(guild_id: u64, channel_id: u64, profile: Value) -> Result<(), String> {
    let mut cmd = python_command();
    cmd.arg("-c").arg(
        "import sys, json; from config.discord_profiles import set_profile; set_profile(int(sys.argv[1]), int(sys.argv[2]), json.loads(sys.stdin.read()))",
    );
    cmd.arg(guild_id.to_string()).arg(channel_id.to_string());
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        let payload = serde_json::to_vec(&profile).map_err(|e| e.to_string())?;
        stdin.write_all(&payload).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if let Ok(url) = Url::parse(&path) {
        // Use new tauri_plugin_opener API which requires an optional identifier
        app.opener()
            .open_url(url, Option::<&str>::None)
            .map_err(|e| e.to_string())
    } else {
        let path_buf = PathBuf::from(&path);
        if !path_buf.exists() {
            return Err("Path does not exist".into());
        }
        let path_str = path_buf
            .to_str()
            .ok_or("Invalid Unicode in path")?
            .to_string();
        app.opener()
            .open_path(path_str, Option::<&str>::None)
            .map_err(|e| e.to_string())
    }
}

fn main() {
    if let Err(e) = fs::create_dir_all(Path::new("models")) {
        eprintln!("failed to create models directory: {}", e);
    }

    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(shell_init())
        .plugin(fs_init())
        .plugin(Builder::new().build())
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            if let Ok(dir) = app.path().app_data_dir() {
                let history_path = dir.join("jobs_history.json");
                let queue_path = dir.join("jobs_queue.json");
                let registry = app.state::<JobRegistry>();
                if let Err(err) = registry.init_persistence(history_path, queue_path) {
                    eprintln!("failed to initialize job history: {}", err);
                }
                let app_handle = app.handle();
                registry.resume_pending(&app_handle);
            }
            if let Err(err) = dnd_watcher::start(&app.handle()) {
                eprintln!("[blossom] failed to start D&D vault watcher: {}", err);
            }
            // Prefer a repo-root virtualenv (../.venv) when running from src-tauri
            let venv_base = if Path::new(".venv").exists() {
                PathBuf::from(".venv")
            } else {
                PathBuf::from("..").join(".venv")
            };
            let venv_dir = if cfg!(target_os = "windows") {
                venv_base.join("Scripts")
            } else {
                venv_base.join("bin")
            };
            let sep = if cfg!(target_os = "windows") {
                ';'
            } else {
                ':'
            };
            let mut path_var = env::var("PATH").unwrap_or_default();
            env::set_var("PATH", format!("{}{}{}", venv_dir.display(), sep, path_var));

            let mut version_cmd = python_command();
            let version_ok = version_cmd
                .args([
                    "-c",
                    "import sys; exit(0) if sys.version_info[:2]==(3,10) else exit(1)",
                ])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if !version_ok {
                // Resolve start.py whether current dir is repo root or src-tauri
                let start_py = if Path::new("start.py").exists() {
                    PathBuf::from("start.py")
                } else {
                    PathBuf::from("..").join("start.py")
                };
                let mut cmd = python_command();
                cmd.arg(&start_py)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                if let Some(parent) = start_py.parent() {
                    cmd.current_dir(parent);
                }
                let output = cmd.output();
                if !output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                    let mut msg = String::from("Failed to set up Python environment.");
                    if let Ok(o) = output {
                        let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
                        if !out.is_empty() {
                            msg.push_str("\nstdout: ");
                            msg.push_str(&out);
                        }
                        if !err.is_empty() {
                            msg.push_str("\nstderr: ");
                            msg.push_str(&err);
                        }
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("Setup Error");
                        window.dialog().message(&msg);
                    }
                    return Err("Python setup failed".into());
                }
                path_var = env::var("PATH").unwrap_or_default();
                env::set_var("PATH", format!("{}{}{}", venv_dir.display(), sep, path_var));
                // Re-check the version now that setup ran
                let mut recheck_cmd = python_command();
                let version_ok_after = recheck_cmd
                    .args([
                        "-c",
                        "import sys; exit(0) if sys.version_info[:2]==(3,10) else exit(1)",
                    ])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if !version_ok_after {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title("Setup Error");
                        window
                            .dialog()
                            .message("Python 3.10 environment not available after setup.");
                    }
                    return Err("Python setup failed".into());
                }
            }

            // Restore window bounds from settings if available
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(store) = settings_store(&app.handle()) {
                    if let Some(bounds) = store.get("windowBounds") {
                        let x = bounds.get("x").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                        let y = bounds.get("y").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                        let w = bounds.get("w").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        let h = bounds.get("h").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        if w > 0 && h > 0 {
                            let _ = window.set_size(Size::Physical(PhysicalSize::new(w, h)));
                        }
                        let _ =
                            window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
                    }
                }
            }
            Ok(())
        })
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_presets,
            list_styles,
            inbox_list,
            inbox_read,
            inbox_update,
            inbox_delete,
            inbox_create,
            inbox_move_to,
            dir_list,
            race_create,
            player_create,
            monster_create,
            god_create,
            spell_create,
            npc_create,
            list_whisper,
            set_whisper,
            transcribe_whisper,
            list_piper,
            set_piper,
            // Whisper
            discover_piper_voices,
            add_piper_voice,
            list_piper_profiles,
            update_piper_profile,
            remove_piper_profile,
            piper_test,
            write_discord_token,
            musicgen_test,
            generate_musicgen,
            musicgen_env,
            resolve_resource,
            list_bundled_voices,
            commands::read_file_bytes,
            commands::get_stable_audio_prompts,
            commands::update_stable_audio_prompts,
            commands::get_lofi_scene_prompts,
            commands::update_lofi_scene_prompts,
            commands::get_ace_workflow_prompts,
            commands::update_ace_workflow_prompts,
            commands::get_stable_audio_templates,
            commands::save_stable_audio_template,
            commands::get_comfyui_settings,
            commands::update_comfyui_settings,
            commands::comfyui_status,
            commands::comfyui_submit_stable_audio,
            commands::comfyui_submit_lofi_scene,
            commands::comfyui_submit_ace_audio,
            commands::comfyui_job_status,
            queue_stable_audio_job,
            queue_lofi_scene_job,
            queue_ace_audio_job,
            dnd_watcher::vault_index_get_by_id,
            stable_audio_output_files,
            lofi_scene_output_files,
            ace_output_files,
            discord_listen_logs_tail,
            album_concat,
            list_llm,
            set_llm,
            pull_llm,
            generate_llm,
            lore_list,
            dnd_chat_message,
            npc_list,
            npc_save,
            npc_delete,
            npc_repair_run,
            update_section_tags,
            list_devices,
            set_devices,
            hotword_get,
            hotword_set,
            app_version,
            start_job,
            train_model,
            cancel_render,
            cancel_job,
            job_status,
            job_details,
            list_job_queue,
            list_completed_jobs,
            register_job_artifacts,
            prune_job_history,
            queue_stable_audio_job,
            stable_audio_output_files,
            queue_musicgen_job,
            queue_riffusion_soundscape_job,
            queue_riffusion_job,
            riffusion_generate,
            queue_render_job,
            record_manual_job,
            discord_profile_get,
            discord_profile_set,
            open_path,
            export_loop_video,
            get_dreadhaven_root,
            config::get_config,
            config::set_config,
            config::export_settings,
            config::import_settings,
            discord_bot_start,
            discord_bot_stop,
            discord_bot_status,
            discord_bot_logs_tail,
            discord_listen_start,
            discord_listen_stop,
            discord_listen_status,
            discord_settings_get,
            discord_token_add,
            discord_token_remove,
            discord_token_select,
            discord_guild_add,
            discord_guild_remove,
            discord_guild_select,
            discord_set_self_deaf,
            discord_detect_token_sources,
            npc_save_portrait,
            god_save_portrait,
            race_save_portrait,
            musiclang::list_musiclang_models,
            musiclang::download_model
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                let registry = app_handle.state::<JobRegistry>();
                // Disable Discord bot keepalive on app close
                {
                    let mut ka = discord_bot_keepalive().lock().unwrap();
                    *ka = false;
                }
                // Stop Discord bot if running
                {
                    let mut guard = discord_bot_store().lock().unwrap();
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                let mut to_requeue = Vec::new();
                {
                    let mut jobs = registry.jobs.lock().unwrap();
                    for (id, job) in jobs.iter_mut() {
                        if job.cancelled || job.status.is_some() {
                            continue;
                        }
                        {
                            let mut child_guard = job.child.lock().unwrap();
                            if let Some(mut child) = child_guard.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                        }
                        job.pending = true;
                        job.started_at = None;
                        job.finished_at = None;
                        to_requeue.push(*id);
                    }
                }
                if !to_requeue.is_empty() {
                    let mut queue = registry.queue.lock().unwrap();
                    for id in to_requeue.into_iter().rev() {
                        if !queue.contains(&id) {
                            queue.push_front(id);
                        }
                    }
                }
                if let Err(err) = registry.persist_queue() {
                    eprintln!("failed to persist job queue on shutdown: {}", err);
                }
            }
            // Persist window bounds on move/resize/scale changes
            match event {
                tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let app_handle = window.app_handle();
                    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                        if let Ok(store) = settings_store(&app_handle) {
                            let _ = store.set(
                                "windowBounds",
                                json!({
                                    "x": pos.x,
                                    "y": pos.y,
                                    "w": size.width,
                                    "h": size.height,
                                }),
                            );
                            let _ = store.save();
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
    {
        eprintln!("error while running tauri application: {}", e);
    }
}

#[tauri::command]
fn lofi_scene_output_files(
    app: AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ImageOutputEntry>, String> {
    let settings = commands::get_comfyui_settings(app)
        .map(Some)
        .unwrap_or(None);
    let mut files: Vec<ImageOutputEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for dir in comfy_image_search_dirs(settings.as_ref()) {
        let entries = match fs::read_dir(&dir) {
            Ok(iter) => iter,
            Err(err) => {
                eprintln!(
                    "[blossom] lofi_scene_output_files: failed to read {}: {}",
                    dir.to_string_lossy(),
                    err
                );
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_lowercase());
            let is_image = matches!(
                extension.as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif")
            );
            if !is_image {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            if !seen.insert(path_str.clone()) {
                continue;
            }
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            files.push(ImageOutputEntry {
                name,
                path: path_str,
                modified_ms,
            });
        }
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    if let Some(limit) = limit {
        if files.len() > limit {
            files.truncate(limit);
        }
    }
    Ok(files)
}
