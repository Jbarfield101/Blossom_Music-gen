from __future__ import annotations

"""Background watcher utilities for Obsidian vault notes.

This module can bootstrap the chunks/index database for a vault and provides
helpers for applying incremental filesystem deltas. The legacy ``start_watchdog``
API remains available for compatibility but now relies on the incremental
helpers defined here.
"""

from pathlib import Path
from typing import Any, Mapping, Sequence
import sqlite3
import threading

from watchfiles import Change, watch

from .chunker import chunk_note, ensure_chunk_tables, store_chunks
from .embedding import DEFAULT_INDEX_PATH, rebuild_index
from .index_cache import BlossomIndex, load_index, save_index
from .parser import NoteParseError, parse_note

DEFAULT_BLOSSOM_INDEX = ".blossom_index.json"
ENTITY_EXTENSIONS = frozenset({".md", ".markdown", ".mdx", ".json"})

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
    blossom_index_path: Path | None = None,
) -> tuple[Path, Path, Path, Path]:
    resolved_vault = Path(vault).expanduser().resolve()
    resolved_db = Path(db_path) if db_path else resolved_vault / DEFAULT_DB_PATH
    resolved_index = Path(index_path) if index_path else resolved_vault / DEFAULT_INDEX_PATH
    resolved_blossom = (
        Path(blossom_index_path)
        if blossom_index_path
        else resolved_vault / DEFAULT_BLOSSOM_INDEX
    )
    return resolved_vault, resolved_db, resolved_index, resolved_blossom


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


def _store_note(path: Path, rel: str, db_path: Path) -> bool:
    try:
        parsed = parse_note(path)
    except NoteParseError:
        return False
    chunks = chunk_note(parsed, rel)
    store_chunks(chunks, db_path)
    return True


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
    blossom_index_path: Path | None = None,
) -> None:
    """Populate the chunks/index database for ``vault`` from scratch."""

    vault, db_path, index_path, blossom_index = _resolve_paths(
        vault, db_path, index_path, blossom_index_path
    )
    _ensure_tables(db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM tags")
        conn.execute("DELETE FROM chunks")
        conn.commit()
    finally:
        conn.close()

    for note_path in sorted(vault.rglob("*")):
        if not note_path.is_file():
            continue
        if note_path.suffix.lower() not in {".md", ".markdown", ".mdx"}:
            continue
        if _should_ignore(note_path):
            continue
        try:
            rel_path = note_path.relative_to(vault).as_posix()
        except ValueError:
            continue
        _store_note(note_path, rel_path, db_path)

    try:
        rebuild_index(db_path, index_path)
    except Exception:
        # Index rebuild is best effort; failures should not abort bootstrapping.
        pass

    try:
        blossom = BlossomIndex(vault, blossom_index)
        blossom.rebuild()
        blossom.save(force=True)
    except Exception:
        # Blossom index failures should not abort bootstrapping.
        pass


def process_events(
    vault: Path,
    events: Sequence[Mapping[str, Any]],
    db_path: Path | None = None,
    index_path: Path | None = None,
    blossom_index_path: Path | None = None,
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

    vault, db_path, index_path, blossom_index = _resolve_paths(
        vault, db_path, index_path, blossom_index_path
    )
    _ensure_tables(db_path)

    try:
        index = load_index(vault, blossom_index)
    except Exception:
        index = BlossomIndex(vault, blossom_index)

    updated = False
    index_updated = False
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

        ext = target_path.suffix.lower()
        is_markdown = ext in {".md", ".markdown", ".mdx"}

        if kind in {"create", "modify"}:
            if ext not in ENTITY_EXTENSIONS or not target_path.exists():
                continue
            if _should_ignore(target_path):
                continue
            if is_markdown and _store_note(target_path, rel_path, db_path):
                updated = True
            try:
                if index.upsert_from_file(target_path):
                    index_updated = True
            except IndexError:
                continue
        elif kind == "remove":
            ext = Path(rel_path).suffix.lower()
            if ext not in {".md", ".markdown", ".mdx", ".json"}:
                continue
            if ext in {".md", ".markdown", ".mdx"}:
                _delete_note(rel_path, db_path)
                updated = True
            if index.remove_by_path((vault / rel_path).resolve()):
                index_updated = True
        elif kind == "rename":
            old_path = event.get("old_path")
            if old_path:
                old_rel = Path(old_path).as_posix()
                old_ext = Path(old_rel).suffix.lower()
                if old_ext in {".md", ".markdown", ".mdx"}:
                    _delete_note(old_rel, db_path)
                    updated = True
                if index.remove_by_path((vault / old_rel).resolve()):
                    index_updated = True
            if ext not in ENTITY_EXTENSIONS or not target_path.exists():
                continue
            if _should_ignore(target_path):
                continue
            if is_markdown and _store_note(target_path, rel_path, db_path):
                updated = True
            try:
                if index.upsert_from_file(target_path):
                    index_updated = True
            except IndexError:
                continue

    if updated and rebuild:
        try:
            rebuild_index(db_path, index_path)
        except Exception:
            # Index rebuild is best effort; failures should be silent.
            pass
    try:
        save_index(index)
    except Exception:
        pass
    return updated or index_updated


def _handle_changes(
    vault: Path,
    db_path: Path,
    index_path: Path,
    blossom_index: Path,
    changes,
) -> bool:
    events: list[dict[str, Any]] = []
    for change, path_str in changes:
        path = Path(path_str)
        if path.suffix.lower() not in ENTITY_EXTENSIONS or _should_ignore(path):
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
    return process_events(
        vault,
        events,
        db_path,
        index_path,
        blossom_index_path=blossom_index,
    )


def _watch_loop(
    vault: Path,
    db_path: Path,
    index_path: Path,
    blossom_index: Path,
    stop: threading.Event,
) -> None:
    for changes in watch(vault, recursive=True):
        if stop.is_set():
            break
        try:
            _handle_changes(vault, db_path, index_path, blossom_index, changes)
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
    vault: Path,
    db_path: Path | None = None,
    index_path: Path | None = None,
    blossom_index_path: Path | None = None,
) -> None:
    """Start a background thread that watches ``vault`` for changes."""

    global _watch_thread, _watch_vault, _stop_event

    if _watch_thread and _watch_thread.is_alive():
        if _watch_vault and Path(vault).resolve() == _watch_vault:
            return
        stop_watchdog()

    vault, db_path, index_path, blossom_index = _resolve_paths(
        vault, db_path, index_path, blossom_index_path
    )
    bootstrap_vault(vault, db_path, index_path, blossom_index)

    stop_event = threading.Event()
    thread = threading.Thread(
        target=_watch_loop,
        args=(vault, db_path, index_path, blossom_index, stop_event),
        daemon=True,
    )
    thread.start()
    _watch_thread = thread
    _watch_vault = vault
    _stop_event = stop_event
