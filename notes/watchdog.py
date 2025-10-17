from __future__ import annotations

"""Background watcher utilities for Obsidian vault notes.

This module can bootstrap the chunks/index database for a vault and provides
helpers for applying incremental filesystem deltas. The legacy ``start_watchdog``
API remains available for compatibility but now relies on the incremental
helpers defined here.
"""

from pathlib import Path
from typing import Any, Mapping, Sequence
from enum import Enum
import sqlite3
import threading

try:  # Optional dependency used for live filesystem watching
    from watchfiles import Change, watch
except Exception:  # pragma: no cover - optional import fallback
    class _FallbackChange(Enum):
        added = "added"
        modified = "modified"
        deleted = "deleted"

    Change = _FallbackChange  # type: ignore[assignment]

    def watch(*_args: Any, **_kwargs: Any):  # type: ignore[override]
        raise RuntimeError("watchfiles is not installed")

from .chunker import chunk_note, ensure_chunk_tables, store_chunks

try:  # Optional heavy dependency for embeddings
    from .embedding import DEFAULT_INDEX_PATH, rebuild_index
except Exception:  # pragma: no cover - optional import fallback
    DEFAULT_INDEX_PATH = "obsidian_index.faiss"

    def rebuild_index(*_args: Any, **_kwargs: Any) -> None:  # type: ignore[override]
        raise RuntimeError("Embedding dependencies are not installed")
from .parser import NoteParseError, ParsedNote, parse_note
from .index_cache import (
    INDEX_FILENAME,
    get_by_id as cache_get_by_id,
    remove_by_path as cache_remove_by_path,
    reset_index as reset_note_index,
    save_index as cache_save_index,
    upsert_from_file as cache_upsert_from_file,
)

# Default location of the chunks database relative to the vault
DEFAULT_DB_PATH = "chunks.sqlite"

# Singleton watcher state used by start_watchdog/stop_watchdog
_watch_thread: threading.Thread | None = None
_watch_vault: Path | None = None
_stop_event: threading.Event | None = None

_IGNORED_SUFFIXES = (
    ".tmp",
    ".temp",
    ".swp",
    ".swo",
    ".bak",
)
_IGNORED_NAMES = frozenset({"thumbs.db", ".ds_store"})


def _resolve_paths(
    vault: Path,
    db_path: Path | None = None,
    index_path: Path | None = None,
    cache_path: Path | None = None,
) -> tuple[Path, Path, Path, Path]:
    resolved_vault = Path(vault).expanduser().resolve()
    resolved_db = Path(db_path) if db_path else resolved_vault / DEFAULT_DB_PATH
    resolved_index = Path(index_path) if index_path else resolved_vault / DEFAULT_INDEX_PATH
    resolved_cache = (
        Path(cache_path).expanduser().resolve()
        if cache_path
        else resolved_vault / INDEX_FILENAME
    )
    return resolved_vault, resolved_db, resolved_index, resolved_cache


def _ensure_tables(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
    finally:
        conn.close()


def _should_ignore(path: Path) -> bool:
    lower = path.name.lower()
    if lower.startswith("~$"):  # Obsidian temp files
        return True
    if lower in _IGNORED_NAMES:
        return True
    return any(lower.endswith(suffix) for suffix in _IGNORED_SUFFIXES)


def _store_note(path: Path, rel: str, db_path: Path) -> ParsedNote | None:
    try:
        parsed = parse_note(path)
    except NoteParseError:
        return None
    chunks = chunk_note(parsed, rel)
    store_chunks(chunks, db_path)
    return parsed


def _delete_note(rel: str, db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "DELETE FROM tags WHERE chunk_id IN (SELECT id FROM chunks WHERE path=?)",
            (rel,),
        )
        conn.execute("DELETE FROM chunks WHERE path=?", (rel,))
        conn.commit()
    finally:
        conn.close()


def bootstrap_vault(
    vault: Path,
    db_path: Path | None = None,
    index_path: Path | None = None,
    cache_path: Path | None = None,
) -> None:
    """Populate the chunks/index database for ``vault`` from scratch."""

    vault, db_path, index_path, cache_path = _resolve_paths(
        vault, db_path, index_path, cache_path
    )
    _ensure_tables(db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM tags")
        conn.execute("DELETE FROM chunks")
        conn.commit()
    finally:
        conn.close()

    reset_note_index(vault, cache_path)

    for note_path in sorted(vault.rglob("*")):
        if not note_path.is_file() or _should_ignore(note_path):
            continue
        suffix = note_path.suffix.lower()
        if suffix not in {".md", ".json"}:
            continue
        try:
            rel_path = note_path.relative_to(vault).as_posix()
        except ValueError:
            continue
        parsed = None
        if suffix == ".md":
            parsed = _store_note(note_path, rel_path, db_path)
            if not parsed:
                continue
        cache_upsert_from_file(vault, rel_path, parsed, index_path=cache_path)

    cache_save_index(vault, index_path=cache_path, force=True)

    try:
        rebuild_index(db_path, index_path)
    except Exception:
        # Index rebuild is best effort; failures should not abort bootstrapping.
        pass


def process_events(
    vault: Path,
    events: Sequence[Mapping[str, Any]],
    db_path: Path | None = None,
    index_path: Path | None = None,
    cache_path: Path | None = None,
    *,
    rebuild: bool = True,
) -> bool:
    """Apply incremental filesystem ``events`` to the chunks database.

    Each event mapping is expected to contain at least ``kind`` (one of
    ``create``, ``modify``, ``remove`` or ``rename``) and ``path``. Rename
    events may include ``old_path`` for the previous location.
    """

    if not events:
        return False

    vault, db_path, index_path, cache_path = _resolve_paths(
        vault, db_path, index_path, cache_path
    )
    _ensure_tables(db_path)

    updated = False
    index_changed = False
    for event in events:
        kind = str(event.get("kind", "")).lower()
        raw_path = event.get("path")
        if not raw_path:
            continue

        rel_path = Path(raw_path).as_posix()
        target_path = (vault / rel_path).resolve()
        try:
            target_path.relative_to(vault)
        except ValueError:
            # Outside the vault; ignore the event
            continue

        suffix = target_path.suffix.lower()

        if kind in {"create", "modify"}:
            if suffix not in {".md", ".json"} or not target_path.exists():
                continue
            if _should_ignore(target_path):
                continue
            parsed = None
            if suffix == ".md":
                parsed = _store_note(target_path, rel_path, db_path)
                if not parsed:
                    continue
                updated = True
            if cache_upsert_from_file(
                vault, rel_path, parsed, index_path=cache_path
            ):
                index_changed = True
        elif kind == "remove":
            if suffix == ".md":
                _delete_note(rel_path, db_path)
                updated = True
            if suffix in {".md", ".json"}:
                if cache_remove_by_path(vault, rel_path, index_path=cache_path):
                    index_changed = True
        elif kind == "rename":
            old_path = event.get("old_path")
            if old_path:
                old_rel = Path(old_path).as_posix()
                old_suffix = Path(old_rel).suffix.lower()
                if old_suffix == ".md":
                    _delete_note(old_rel, db_path)
                    updated = True
                if old_suffix in {".md", ".json"}:
                    if cache_remove_by_path(
                        vault, old_rel, index_path=cache_path
                    ):
                        index_changed = True
            if suffix not in {".md", ".json"} or not target_path.exists():
                continue
            if _should_ignore(target_path):
                continue
            parsed = None
            if suffix == ".md":
                parsed = _store_note(target_path, rel_path, db_path)
                if not parsed:
                    continue
                updated = True
            if cache_upsert_from_file(
                vault, rel_path, parsed, index_path=cache_path
            ):
                index_changed = True

    if index_changed:
        cache_save_index(vault, index_path=cache_path)

    if updated and rebuild:
        try:
            rebuild_index(db_path, index_path)
        except Exception:
            # Index rebuild is best effort; failures should be silent.
            pass
    return updated


def save_index(
    vault: Path,
    index_path: Path | None = None,
    cache_path: Path | None = None,
    *,
    force: bool = False,
) -> None:
    """Persist the vault index immediately or schedule a debounced flush."""

    resolved_vault, _, _, resolved_cache = _resolve_paths(
        vault, None, index_path, cache_path
    )
    cache_save_index(resolved_vault, index_path=resolved_cache, force=force)


def get_index_entity(
    vault: Path,
    entity_id: str,
    index_path: Path | None = None,
    cache_path: Path | None = None,
) -> dict[str, Any] | None:
    """Return the cached entity ``entity_id`` if present."""

    resolved_vault, _, _, resolved_cache = _resolve_paths(
        vault, None, index_path, cache_path
    )
    return cache_get_by_id(resolved_vault, entity_id, index_path=resolved_cache)


def _handle_changes(
    vault: Path, db_path: Path, index_path: Path, cache_path: Path, changes
) -> bool:
    events: list[dict[str, Any]] = []
    for change, path_str in changes:
        path = Path(path_str)
        suffix = path.suffix.lower()
        if suffix not in {".md", ".json"} or _should_ignore(path):
            continue
        try:
            rel = path.relative_to(vault).as_posix()
        except ValueError:
            continue
        if change == Change.modified:
            events.append({"kind": "modify", "path": rel})
        elif change == Change.added:
            events.append({"kind": "create", "path": rel})
        elif change == Change.deleted:
            events.append({"kind": "remove", "path": rel})
    if not events:
        return False
    return process_events(vault, events, db_path, index_path, cache_path)


def _watch_loop(
    vault: Path, db_path: Path, index_path: Path, cache_path: Path, stop: threading.Event
) -> None:
    for changes in watch(vault, recursive=True):
        if stop.is_set():
            break
        try:
            _handle_changes(vault, db_path, index_path, cache_path, changes)
        except Exception:
            # Ignore watcher errors; logging is handled by the caller.
            continue


def stop_watchdog() -> None:
    """Stop the currently running watcher thread, if any."""

    global _watch_thread, _stop_event, _watch_vault
    if _watch_thread and _watch_thread.is_alive():
        if _stop_event is not None:
            _stop_event.set()
        _watch_thread.join(timeout=1.0)
    _watch_thread = None
    _stop_event = None
    _watch_vault = None


def start_watchdog(
    vault: Path, db_path: Path | None = None, index_path: Path | None = None
) -> None:
    """Start a background thread that watches ``vault`` for changes."""

    global _watch_thread, _watch_vault, _stop_event

    if _watch_thread and _watch_thread.is_alive():
        if _watch_vault and Path(vault).resolve() == _watch_vault:
            return
        stop_watchdog()

    vault, db_path, index_path, cache_path = _resolve_paths(
        vault, db_path, index_path
    )
    bootstrap_vault(vault, db_path, index_path, cache_path)

    stop_event = threading.Event()
    thread = threading.Thread(
        target=_watch_loop,
        args=(vault, db_path, index_path, cache_path, stop_event),
        daemon=True,
    )
    thread.start()
    _watch_thread = thread
    _watch_vault = vault
    _stop_event = stop_event
