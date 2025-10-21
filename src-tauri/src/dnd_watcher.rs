use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use notify::event::{DataChange, ModifyKind, RenameMode};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Map, Value};
use tauri::{async_runtime, AppHandle, Emitter};

use crate::{config, python_command};

const DEFAULT_DB_PATH: &str = "chunks.sqlite";
const DEFAULT_INDEX_PATH: &str = "obsidian_index.faiss";
const BLOSSOM_INDEX_FILENAME: &str = ".blossom_index.json";
const DEBOUNCE_MS: u64 = 350;
const WATCH_POLL_MS: u64 = 125;

// Paths are normalized to lowercase with forward slashes before matching.
const ALLOWED_PREFIXES: &[&str] = &[
    "00_inbox",
    "10_world",
    "10_world/regions",
    "10_world/factions",
    "10_world/pantheon",
    "10_world/gods of the realm",
    "10_world/spellbook",
    "10_world/races",
    "10_world/classes",
    "10_world/backgrounds",
    "10_world/backgrounds & rules",
    "10_world/rules",
    "10_world/journal",
    "10_world/stories",
    "10_world/loose notes",
    "10_world/player relations",
    "10_world/bank",
    "10_world/bank economy",
    "10_world/bank transactions",
    "10_world/calendar",
    "20_dm",
    "20_dm/npc",
    "20_dm/monsters",
    "20_dm/events",
    "20_dm/quests",
    "20_dm/sessions",
    "20_dm/tasks",
    "30_assets",
    "30_assets/images",
];

const IGNORED_SUFFIXES: &[&str] = &[".tmp", ".temp", ".swp", ".swo", ".bak"];
const IGNORED_NAMES: &[&str] = &["thumbs.db", ".ds_store"];

static WATCHER_STATE: OnceLock<Mutex<Option<WatcherHandle>>> = OnceLock::new();

struct WatcherHandle {
    #[allow(dead_code)]
    watcher: RecommendedWatcher,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileSignature {
    modified_ns: u128,
    len: u64,
}

#[derive(Clone, Copy, Debug)]
enum DeltaKind {
    Create,
    Modify,
    Remove,
    Rename,
}

impl DeltaKind {
    fn as_str(self) -> &'static str {
        match self {
            DeltaKind::Create => "create",
            DeltaKind::Modify => "modify",
            DeltaKind::Remove => "remove",
            DeltaKind::Rename => "rename",
        }
    }
}

#[derive(Clone, Debug)]
struct Delta {
    kind: DeltaKind,
    rel_path: String,
    #[allow(dead_code)]
    abs_path: PathBuf,
    old_rel_path: Option<String>,
}

pub(crate) fn start(app: &AppHandle) -> Result<(), String> {
    config::ensure_default_vault();
    let root = PathBuf::from(config::DEFAULT_DREADHAVEN_ROOT);
    if let Err(err) = fs::create_dir_all(&root) {
        return Err(format!(
            "failed to create DreadHaven root {}: {}",
            root.display(),
            err
        ));
    }

    let db_path = root.join(DEFAULT_DB_PATH);
    let index_path = root.join(DEFAULT_INDEX_PATH);
    let cache_path = root.join(BLOSSOM_INDEX_FILENAME);

    // Ensure the chunks database is primed before watching.
    if let Err(err) = bootstrap_vault(&root, &db_path, &index_path, &cache_path) {
        eprintln!("[blossom] dnd_watcher bootstrap error: {}", err);
    }

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let notify_config = Config::default()
        .with_compare_contents(false)
        .with_poll_interval(Duration::from_millis(WATCH_POLL_MS));

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            if tx.send(res).is_err() {
                // Receiver dropped; nothing else to do.
            }
        },
        notify_config,
    )
    .map_err(|e| format!("failed to create watcher: {e}"))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to watch {}: {e}", root.display()))?;

    let mut guard = WATCHER_STATE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("watcher mutex poisoned");
    *guard = Some(WatcherHandle { watcher });
    drop(guard);

    let app_handle = app.clone();
    let root_for_thread = root.clone();
    std::thread::spawn(move || {
        run_event_loop(app_handle, root_for_thread, db_path, index_path, cache_path, rx)
    });

    Ok(())
}

fn run_event_loop(
    app: AppHandle,
    root: PathBuf,
    db_path: PathBuf,
    index_path: PathBuf,
    cache_path: PathBuf,
    rx: mpsc::Receiver<notify::Result<Event>>,
) {
    let mut signatures: HashMap<String, FileSignature> = HashMap::new();
    let mut pending: Vec<Delta> = Vec::new();
    let mut last_event = Instant::now();
    let debounce = Duration::from_millis(DEBOUNCE_MS);

    loop {
        match rx.recv_timeout(Duration::from_millis(WATCH_POLL_MS)) {
            Ok(Ok(event)) => {
                if handle_event(&root, event, &mut signatures, &mut pending) {
                    last_event = Instant::now();
                }
            }
            Ok(Err(err)) => {
                eprintln!("[blossom] dnd_watcher notify error: {}", err);
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() && last_event.elapsed() >= debounce {
                    if let Err(err) = flush_events(
                        &app,
                        &root,
                        &db_path,
                        &index_path,
                        &cache_path,
                        pending.drain(..),
                    )
                    {
                        eprintln!("[blossom] dnd_watcher flush error: {}", err);
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle_event(
    root: &Path,
    event: Event,
    signatures: &mut HashMap<String, FileSignature>,
    pending: &mut Vec<Delta>,
) -> bool {
    let mut added = false;

    match event.kind {
        EventKind::Create(_) => {
            for path in event.paths {
                if push_delta(
                    root,
                    path.clone(),
                    DeltaKind::Create,
                    None,
                    signatures,
                    pending,
                ) {
                    added = true;
                }
            }
        }
        EventKind::Modify(kind) => match kind {
            ModifyKind::Data(DataChange::Any)
            | ModifyKind::Data(DataChange::Content)
            | ModifyKind::Data(DataChange::Size)
            | ModifyKind::Any => {
                for path in event.paths {
                    if push_delta(
                        root,
                        path.clone(),
                        DeltaKind::Modify,
                        None,
                        signatures,
                        pending,
                    ) {
                        added = true;
                    }
                }
            }
            ModifyKind::Name(RenameMode::Both) => {
                if event.paths.len() >= 2 {
                    let from = event.paths[0].clone();
                    let to = event.paths[1].clone();
                    let old_rel = normalize_rel(&from, root);
                    let old_rel_lower = old_rel
                        .as_ref()
                        .map(|s| s.to_lowercase())
                        .unwrap_or_default();
                    if !old_rel_lower.is_empty() {
                        signatures.remove(&old_rel_lower);
                    }
                    if push_delta(root, to, DeltaKind::Rename, old_rel, signatures, pending) {
                        added = true;
                    }
                }
            }
            ModifyKind::Name(RenameMode::From) => {
                for path in event.paths {
                    if push_delta(root, path, DeltaKind::Remove, None, signatures, pending) {
                        added = true;
                    }
                }
            }
            ModifyKind::Name(RenameMode::To) => {
                for path in event.paths {
                    if push_delta(
                        root,
                        path.clone(),
                        DeltaKind::Create,
                        None,
                        signatures,
                        pending,
                    ) {
                        added = true;
                    }
                }
            }
            _ => {}
        },
        EventKind::Remove(_) => {
            for path in event.paths {
                if push_delta(root, path, DeltaKind::Remove, None, signatures, pending) {
                    added = true;
                }
            }
        }
        _ => {}
    }

    added
}

fn push_delta(
    root: &Path,
    path: PathBuf,
    kind: DeltaKind,
    old_rel_path: Option<String>,
    signatures: &mut HashMap<String, FileSignature>,
    pending: &mut Vec<Delta>,
) -> bool {
    let rel_opt = normalize_rel(&path, root);
    let rel = match rel_opt {
        Some(r) => r,
        None => return false,
    };
    if should_ignore(&rel) {
        return false;
    }

    let key = rel.to_lowercase();
    match kind {
        DeltaKind::Create | DeltaKind::Modify | DeltaKind::Rename => {
            if let Some(sig) = file_signature(&path) {
                if matches!(signatures.get(&key), Some(existing) if *existing == sig) {
                    // Metadata unchanged; skip redundant update.
                    return false;
                }
                signatures.insert(key.clone(), sig);
            }
        }
        DeltaKind::Remove => {
            signatures.remove(&key);
        }
    }

    pending.push(Delta {
        kind,
        rel_path: rel,
        abs_path: path,
        old_rel_path,
    });
    true
}

fn flush_events(
    app: &AppHandle,
    root: &Path,
    db_path: &Path,
    index_path: &Path,
    cache_path: &Path,
    events: impl Iterator<Item = Delta>,
) -> Result<(), String> {
    let mut unique_paths = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut events_json = Vec::new();
    let mut kind_map = Map::new();

    for delta in events {
        let kind_str = delta.kind.as_str();
        let rel_path = delta.rel_path.clone();

        if seen_paths.insert(rel_path.clone()) {
            unique_paths.push(rel_path.clone());
        }
        kind_map.insert(rel_path.clone(), Value::String(kind_str.to_string()));

        let mut obj = Map::new();
        obj.insert("kind".into(), Value::String(kind_str.to_string()));
        obj.insert("path".into(), Value::String(rel_path));
        if let Some(old_rel) = delta.old_rel_path {
            obj.insert("old_path".into(), Value::String(old_rel));
        }
        events_json.push(Value::Object(obj));
    }

    if events_json.is_empty() {
        return Ok(());
    }

    let payload = json!({
        "vault": root.to_string_lossy(),
        "db_path": db_path.to_string_lossy(),
        "index_path": index_path.to_string_lossy(),
        "cache_path": cache_path.to_string_lossy(),
        "rebuild": false,
        "events": events_json,
    });

    run_python_watchdog(payload)?;

    // Trigger a debounced index save now that the in-memory cache is updated.
    trigger_index_save(root, index_path, cache_path, false)?;

    let event_payload = json!({
        "paths": unique_paths,
        "kinds": kind_map,
        "timestamp": Utc::now().to_rfc3339(),
    });

    if let Err(err) = app.emit("dnd::vault-changed", event_payload) {
        eprintln!("[blossom] failed to emit dnd::vault-changed: {}", err);
    }

    Ok(())
}

fn normalize_rel(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let rel_str = rel.to_string_lossy().replace('\\', "/");
    let trimmed = rel_str.trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn should_ignore(rel: &str) -> bool {
    let lowered = rel.to_lowercase();
    if lowered.is_empty() {
        return true;
    }
    if IGNORED_NAMES.iter().any(|name| lowered.ends_with(name)) {
        return true;
    }
    if lowered.starts_with("~$") {
        return true;
    }
    if IGNORED_SUFFIXES
        .iter()
        .any(|suffix| lowered.ends_with(suffix))
    {
        return true;
    }
    let allowed = ALLOWED_PREFIXES
        .iter()
        .any(|prefix| lowered.starts_with(prefix));
    !allowed
}

fn file_signature(path: &Path) -> Option<FileSignature> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let unix = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(FileSignature {
        modified_ns: unix.as_nanos(),
        len: metadata.len(),
    })
}

fn run_python_watchdog(payload: Value) -> Result<(), String> {
    let mut cmd = python_command();
    cmd.arg("-c")
        .arg("import json, sys, notes.watchdog as w; payload=json.load(sys.stdin); w.process_events(payload['vault'], payload['events'], payload.get('db_path'), payload.get('index_path'), cache_path=payload.get('cache_path'), rebuild=payload.get('rebuild', True))")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn python watcher: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
    } else {
        return Err(String::from("failed to open python stdin"));
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python process_events failed: {}", stderr.trim()));
    }
    Ok(())
}

fn trigger_index_save(
    root: &Path,
    index_path: &Path,
    cache_path: &Path,
    force: bool,
) -> Result<(), String> {
    let payload = json!({
        "vault": root.to_string_lossy(),
        "index_path": index_path.to_string_lossy(),
        "cache_path": cache_path.to_string_lossy(),
        "force": force,
    });

    let mut cmd = python_command();
    cmd.arg("-c")
        .arg("import json, sys, notes.watchdog as w; payload=json.load(sys.stdin); w.save_index(payload['vault'], payload.get('index_path'), payload.get('cache_path'), force=payload.get('force', False))")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn python save_index: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
    } else {
        return Err(String::from("failed to open python stdin"));
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python save_index failed: {}", stderr.trim()));
    }
    Ok(())
}

fn bootstrap_vault(
    root: &Path,
    db_path: &Path,
    index_path: &Path,
    cache_path: &Path,
) -> Result<(), String> {
    let payload = json!({
        "vault": root.to_string_lossy(),
        "db_path": db_path.to_string_lossy(),
        "index_path": index_path.to_string_lossy(),
        "cache_path": cache_path.to_string_lossy(),
    });

    let mut cmd = python_command();
    cmd.arg("-c")
        .arg("import json, sys, notes.watchdog as w; payload=json.load(sys.stdin); w.bootstrap_vault(payload['vault'], payload.get('db_path'), payload.get('index_path'), payload.get('cache_path'))")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn python bootstrap: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
    } else {
        return Err(String::from("failed to open python stdin"));
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python bootstrap_vault failed: {}", stderr.trim()));
    }
    Ok(())
}

fn python_index_get_by_id(
    root: &Path,
    index_path: &Path,
    cache_path: &Path,
    entity_id: &str,
) -> Result<Option<Value>, String> {
    let payload = json!({
        "vault": root.to_string_lossy(),
        "index_path": index_path.to_string_lossy(),
        "cache_path": cache_path.to_string_lossy(),
        "entity_id": entity_id,
    });

    let mut cmd = python_command();
    cmd.arg("-c")
        .arg("import json, sys, notes.watchdog as w; payload=json.load(sys.stdin); result = w.get_index_entity(payload['vault'], payload['entity_id'], payload.get('index_path'), payload.get('cache_path')); json.dump(result, sys.stdout)")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn python get_index_entity: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
    } else {
        return Err(String::from("failed to open python stdin"));
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("python get_index_entity failed: {}", stderr.trim()));
    }

    if output.stdout.is_empty() {
        return Ok(None);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let value: Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("failed to decode index entity: {e}"))?;
    if value.is_null() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

#[tauri::command]
pub async fn vault_index_get_by_id(entity_id: String) -> Result<Option<Value>, String> {
    config::ensure_default_vault();
    let root = PathBuf::from(config::DEFAULT_DREADHAVEN_ROOT);
    let index_path = root.join(DEFAULT_INDEX_PATH);
    let cache_path = root.join(BLOSSOM_INDEX_FILENAME);
    let entity = entity_id;

    async_runtime::spawn_blocking(move || {
        python_index_get_by_id(&root, &index_path, &cache_path, &entity)
    })
    .await
    .map_err(|e| e.to_string())?
}
