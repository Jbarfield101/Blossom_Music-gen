from __future__ import annotations

"""In-memory cache and persistence helpers for the Blossom vault index."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
import copy
import json
import threading

from .parser import NoteParseError, ParsedNote, parse_note

INDEX_FILENAME = ".blossom_index.json"
INDEX_VERSION = 1
_SAVE_DEBOUNCE_SECONDS = 0.5


@dataclass
class _CacheState:
    data: Dict[str, Any]
    dirty: bool = False
    timer: threading.Timer | None = None


_state: dict[Path, _CacheState] = {}
_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_index() -> Dict[str, Any]:
    return {"version": INDEX_VERSION, "generated_at": _now_iso(), "entities": {}}


def _resolve_index_path(vault: Path, index_path: Path | None = None) -> Path:
    resolved_vault = Path(vault).expanduser().resolve()
    if index_path is None:
        return resolved_vault / INDEX_FILENAME
    return Path(index_path).expanduser().resolve()


def _ensure_state(vault: Path, index_path: Path | None = None) -> tuple[_CacheState, Path]:
    resolved_index = _resolve_index_path(vault, index_path)
    with _lock:
        state = _state.get(resolved_index)
        if state is None:
            if resolved_index.exists():
                try:
                    loaded = json.loads(resolved_index.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    loaded = None
            else:
                loaded = None
            if not isinstance(loaded, dict):
                raw = _empty_index()
            else:
                raw = loaded
            if raw.get("version") != INDEX_VERSION:
                raw = _empty_index()
            if not isinstance(raw.get("entities"), dict):
                raw["entities"] = {}
            state = _CacheState(data=raw, dirty=False, timer=None)
            _state[resolved_index] = state
        return state, resolved_index


def load_index(vault: Path, index_path: Path | None = None) -> Dict[str, Any]:
    """Return a deep copy of the cached index for ``vault``."""

    state, _ = _ensure_state(vault, index_path)
    with _lock:
        return copy.deepcopy(state.data)


def reset_index(vault: Path, index_path: Path | None = None) -> None:
    """Reset the cached index for ``vault`` to an empty structure."""

    state, _ = _ensure_state(vault, index_path)
    with _lock:
        state.data.clear()
        state.data.update(_empty_index())
        state.dirty = True
        if state.timer:
            state.timer.cancel()
            state.timer = None


def _write_locked(index_path: Path, state: _CacheState) -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    state.data["generated_at"] = _now_iso()
    index_path.write_text(
        json.dumps(state.data, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    state.dirty = False
    state.timer = None


def save_index(vault: Path, index_path: Path | None = None, *, force: bool = False) -> None:
    """Persist the cached index for ``vault`` to disk."""

    state, resolved_index = _ensure_state(vault, index_path)
    with _lock:
        if not state.dirty and not force:
            return
        if force:
            if state.timer:
                state.timer.cancel()
                state.timer = None
            _write_locked(resolved_index, state)
            return
        if state.timer and state.timer.is_alive():
            return

        def _flush() -> None:
            with _lock:
                active = _state.get(resolved_index)
                if not active or not active.dirty:
                    if active:
                        active.timer = None
                    return
                _write_locked(resolved_index, active)

        timer = threading.Timer(_SAVE_DEBOUNCE_SECONDS, _flush)
        timer.daemon = True
        state.timer = timer
        timer.start()


def _normalise_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    result.append(text)
            elif item is not None:
                result.append(str(item))
        return result
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    return []


def _coerce_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    return str(value)


def _serialise_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    def convert(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): convert(val) for key, val in value.items()}
        if isinstance(value, list):
            return [convert(item) for item in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    return {str(key): convert(val) for key, val in metadata.items()}


def _build_entity_from_parsed(rel_path: str, parsed: ParsedNote) -> Optional[Dict[str, Any]]:
    metadata = parsed.metadata or {}
    entity_id = _coerce_str(metadata.get("id"))
    if not entity_id:
        return None

    entity_type = _coerce_str(metadata.get("type"))
    name = _coerce_str(metadata.get("name")) or _coerce_str(metadata.get("title"))
    if not name:
        name = Path(rel_path).stem

    aliases = _normalise_str_list(parsed.aliases)
    tags = _normalise_str_list(parsed.tags)
    titles = _normalise_str_list(metadata.get("titles"))
    keywords = _normalise_str_list(metadata.get("keywords"))

    entity = {
        "id": entity_id,
        "type": entity_type,
        "name": name,
        "path": rel_path,
        "aliases": aliases,
        "tags": tags,
        "titles": titles,
        "keywords": keywords,
        "fields": copy.deepcopy(parsed.fields),
        "metadata": _serialise_metadata(metadata),
    }
    return entity


def _build_entity_from_json(rel_path: str, path: Path) -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None

    metadata_raw = raw.get("metadata")
    metadata = metadata_raw if isinstance(metadata_raw, dict) else {}

    entity_id = _coerce_str(raw.get("id")) or _coerce_str(metadata.get("id"))
    if not entity_id:
        return None

    entity_type = _coerce_str(raw.get("type")) or _coerce_str(metadata.get("type"))
    name = (
        _coerce_str(raw.get("name"))
        or _coerce_str(metadata.get("name"))
        or _coerce_str(metadata.get("title"))
    )
    if not name:
        name = Path(rel_path).stem

    aliases = _normalise_str_list(raw.get("aliases"))
    if not aliases:
        aliases = _normalise_str_list(metadata.get("aliases"))

    tags = _normalise_str_list(raw.get("tags"))
    if not tags:
        tags = _normalise_str_list(metadata.get("tags"))

    titles = _normalise_str_list(raw.get("titles"))
    if not titles:
        titles = _normalise_str_list(metadata.get("titles"))

    keywords = _normalise_str_list(raw.get("keywords"))
    if not keywords:
        keywords = _normalise_str_list(metadata.get("keywords"))

    fields_raw = raw.get("fields")
    fields = copy.deepcopy(fields_raw) if isinstance(fields_raw, dict) else {}

    entity = {
        "id": entity_id,
        "type": entity_type,
        "name": name,
        "path": rel_path,
        "aliases": aliases,
        "tags": tags,
        "titles": titles,
        "keywords": keywords,
        "fields": fields,
        "metadata": _serialise_metadata(metadata),
    }
    return entity


def _remove_by_path_locked(state: _CacheState, rel_path: str, *, except_id: str | None = None) -> bool:
    removed = False
    entities = state.data.setdefault("entities", {})
    for key, value in list(entities.items()):
        if value.get("path") == rel_path and key != except_id:
            del entities[key]
            removed = True
    if removed:
        state.dirty = True
    return removed


def upsert_from_file(
    vault: Path,
    rel_path: str | Path,
    parsed: ParsedNote | None = None,
    *,
    index_path: Path | None = None,
) -> bool:
    """Parse ``rel_path`` relative to ``vault`` and merge into the cache."""

    rel = Path(rel_path).as_posix()
    absolute = Path(vault).expanduser().resolve() / rel
    if not absolute.exists():
        return False

    suffix = absolute.suffix.lower()
    entity: Optional[Dict[str, Any]]
    if suffix == ".md":
        if parsed is None:
            try:
                parsed = parse_note(absolute)
            except NoteParseError:
                return False
        entity = _build_entity_from_parsed(rel, parsed)
    elif suffix == ".json":
        entity = _build_entity_from_json(rel, absolute)
    else:
        return False

    if not entity:
        return False

    state, _ = _ensure_state(vault, index_path)
    with _lock:
        entities = state.data.setdefault("entities", {})
        changed = _remove_by_path_locked(state, rel, except_id=entity["id"])
        existing = entities.get(entity["id"])
        if existing == entity and not changed:
            return False
        entities[entity["id"]] = entity
        state.dirty = True
        return True


def remove_by_path(
    vault: Path,
    rel_path: str | Path,
    *,
    index_path: Path | None = None,
) -> bool:
    """Remove any entity stored at ``rel_path`` from the cache."""

    rel = Path(rel_path).as_posix()
    state, _ = _ensure_state(vault, index_path)
    with _lock:
        return _remove_by_path_locked(state, rel)


def get_by_id(
    vault: Path,
    entity_id: str,
    *,
    index_path: Path | None = None,
) -> Optional[Dict[str, Any]]:
    """Return a copy of the cached entity ``entity_id`` if present."""

    state, _ = _ensure_state(vault, index_path)
    with _lock:
        entity = state.data.get("entities", {}).get(entity_id)
        return copy.deepcopy(entity) if entity else None
