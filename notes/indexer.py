"""Index management utilities for Blossom vault entities."""
from __future__ import annotations

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
class _IndexState:
    data: Dict[str, Any]
    dirty: bool = False
    timer: threading.Timer | None = None


_state: dict[Path, _IndexState] = {}
_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_index() -> Dict[str, Any]:
    return {"version": INDEX_VERSION, "generated_at": _now_iso(), "entities": {}}


def _index_path(vault: Path) -> Path:
    return Path(vault) / INDEX_FILENAME


def _ensure_state(vault: Path) -> _IndexState:
    resolved = Path(vault).expanduser().resolve()
    index_path = _index_path(resolved)
    with _lock:
        state = _state.get(index_path)
        if state is None:
            if index_path.exists():
                try:
                    loaded = json.loads(index_path.read_text(encoding="utf-8"))
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
            state = _IndexState(data=raw, dirty=False, timer=None)
            _state[index_path] = state
        return state


def load_index(vault: Path) -> Dict[str, Any]:
    """Return a deep copy of the in-memory index for ``vault``."""

    state = _ensure_state(vault)
    with _lock:
        return copy.deepcopy(state.data)


def reset_index(vault: Path) -> None:
    """Clear the in-memory index for ``vault``."""

    state = _ensure_state(vault)
    with _lock:
        state.data.clear()
        state.data.update(_empty_index())
        state.dirty = True
        if state.timer:
            state.timer.cancel()
            state.timer = None


def _write_locked(index_path: Path, state: _IndexState) -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    state.data["generated_at"] = _now_iso()
    index_path.write_text(
        json.dumps(state.data, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    state.dirty = False
    state.timer = None


def save_index(vault: Path, *, force: bool = False) -> None:
    """Persist the index for ``vault`` to disk."""

    state = _ensure_state(vault)
    index_path = _index_path(Path(vault).expanduser().resolve())
    with _lock:
        if not state.dirty and not force:
            return
        if force:
            if state.timer:
                state.timer.cancel()
                state.timer = None
            _write_locked(index_path, state)
            return
        if state.timer and state.timer.is_alive():
            return

        def _flush() -> None:
            with _lock:
                active = _state.get(index_path)
                if not active or not active.dirty:
                    if active:
                        active.timer = None
                    return
                _write_locked(index_path, active)

        timer = threading.Timer(_SAVE_DEBOUNCE_SECONDS, _flush)
        timer.daemon = True
        state.timer = timer
        timer.start()


def _normalise_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        result = []
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


def _build_entity(rel_path: str, parsed: ParsedNote) -> Optional[Dict[str, Any]]:
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


def _remove_by_path_locked(state: _IndexState, rel_path: str, *, except_id: str | None = None) -> bool:
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
    vault: Path, rel_path: str | Path, parsed: ParsedNote | None = None
) -> bool:
    """Parse ``rel_path`` and merge it into the index."""

    rel = Path(rel_path).as_posix()
    absolute = Path(vault).expanduser().resolve() / rel
    if parsed is None:
        try:
            parsed = parse_note(absolute)
        except NoteParseError:
            return False
    entity = _build_entity(rel, parsed)
    if not entity:
        return False

    state = _ensure_state(vault)
    with _lock:
        entities = state.data.setdefault("entities", {})
        changed = _remove_by_path_locked(state, rel, except_id=entity["id"])
        existing = entities.get(entity["id"])
        if existing == entity and not changed:
            return False
        entities[entity["id"]] = entity
        state.dirty = True
        return True


def remove_by_path(vault: Path, rel_path: str | Path) -> bool:
    """Remove any entity stored at ``rel_path`` from the index."""

    rel = Path(rel_path).as_posix()
    state = _ensure_state(vault)
    with _lock:
        removed = _remove_by_path_locked(state, rel)
        return removed


def get_by_id(vault: Path, entity_id: str) -> Optional[Dict[str, Any]]:
    """Return the entity entry for ``entity_id`` if present."""

    state = _ensure_state(vault)
    with _lock:
        entity = state.data.get("entities", {}).get(entity_id)
        return copy.deepcopy(entity) if entity else None
