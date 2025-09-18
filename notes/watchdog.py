from __future__ import annotations

"""Background watcher for Obsidian vault notes.

This module monitors a vault directory for Markdown file changes. Whenever a
note is created, modified or deleted the corresponding SQLite table and FAISS
index are updated by re-parsing and re-chunking the affected file.
"""

from pathlib import Path
import threading
import sqlite3

from watchfiles import Change, watch

from .parser import parse_note, NoteParseError
from .chunker import chunk_note, store_chunks, ensure_chunk_tables
from .embedding import rebuild_index, DEFAULT_INDEX_PATH

# Default location of the chunks database relative to the vault
DEFAULT_DB_PATH = "chunks.sqlite"

# Singleton watcher state
_watch_thread: threading.Thread | None = None
_watch_vault: Path | None = None
_stop_event: threading.Event | None = None


def _handle_changes(changes, vault: Path, db_path: Path) -> bool:
    """Process filesystem ``changes`` and update the chunk database.

    Returns ``True`` if any relevant Markdown files were affected.
    """

    updated = False
    for change, path_str in changes:
        path = Path(path_str)
        if path.suffix.lower() != ".md":
            continue
        try:
            rel = path.relative_to(vault).as_posix()
        except Exception:
            # Skip files outside the vault
            continue
        if change in (Change.added, Change.modified):
            try:
                parsed = parse_note(path)
            except NoteParseError:
                continue
            chunks = chunk_note(parsed, rel)
            store_chunks(chunks, db_path)
            updated = True
        elif change == Change.deleted:
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
            updated = True
    return updated


def _watch_loop(vault: Path, db_path: Path, index_path: Path, stop: threading.Event) -> None:
    for changes in watch(vault, recursive=True):
        if stop.is_set():
            break
        if _handle_changes(changes, vault, db_path):
            try:
                rebuild_index(db_path, index_path)
            except Exception:
                # Rebuilding the index is best effort; failures shouldn't stop
                # the watcher.
                pass


def stop_watchdog() -> None:
    """Stop the currently running watcher thread, if any.

    This waits briefly for the watcher loop to exit.
    """
    global _watch_thread, _stop_event, _watch_vault
    if _watch_thread and _watch_thread.is_alive():
        if _stop_event is not None:
            _stop_event.set()
        # Join with a timeout to avoid hanging shutdowns
        _watch_thread.join(timeout=1.0)
    _watch_thread = None
    _stop_event = None
    _watch_vault = None


def start_watchdog(
    vault: Path, db_path: Path | None = None, index_path: Path | None = None
) -> None:
    """Start a background thread that watches ``vault`` for changes.

    Parameters
    ----------
    vault:
        Path to the root of the Obsidian vault.
    db_path:
        Optional path to the SQLite chunks database. Defaults to
        ``vault / 'chunks.sqlite'``.
    index_path:
        Optional path to the FAISS index. Defaults to ``vault`` joined with
        :data:`notes.embedding.DEFAULT_INDEX_PATH`.
    """

    global _watch_thread, _watch_vault, _stop_event
    # If a watcher is already running for the same vault, nothing to do.
    if _watch_thread and _watch_thread.is_alive():
        if _watch_vault and Path(vault).resolve() == _watch_vault:
            return
        # Different vault: stop and restart
        stop_watchdog()

    vault = Path(vault)
    db_path = Path(db_path) if db_path else vault / DEFAULT_DB_PATH
    index_path = Path(index_path) if index_path else vault / DEFAULT_INDEX_PATH

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
        conn.execute("DELETE FROM tags")
        conn.execute("DELETE FROM chunks")
        conn.commit()
    finally:
        conn.close()

    for note_path in sorted(vault.rglob("*.md")):
        if not note_path.is_file():
            continue
        try:
            rel_path = note_path.relative_to(vault).as_posix()
        except ValueError:
            continue
        try:
            parsed = parse_note(note_path)
        except NoteParseError:
            continue
        chunks = chunk_note(parsed, rel_path)
        store_chunks(chunks, db_path)

    try:
        rebuild_index(db_path, index_path)
    except Exception:
        # Rebuilding the index is best effort; failures shouldn't prevent the
        # watcher from running.
        pass

    stop = threading.Event()
    thread = threading.Thread(
        target=_watch_loop, args=(vault, db_path, index_path, stop), daemon=True
    )
    thread.start()
    _watch_thread = thread
    _watch_vault = Path(vault).resolve()
    _stop_event = stop
