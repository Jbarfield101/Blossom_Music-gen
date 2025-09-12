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
from .chunker import chunk_note, store_chunks
from .embedding import rebuild_index, DEFAULT_INDEX_PATH

# Default location of the chunks database relative to the vault
DEFAULT_DB_PATH = "chunks.sqlite"

# Singleton thread instance
_watch_thread: threading.Thread | None = None


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


def _watch_loop(vault: Path, db_path: Path, index_path: Path) -> None:
    for changes in watch(vault, recursive=True):
        if _handle_changes(changes, vault, db_path):
            try:
                rebuild_index(db_path, index_path)
            except Exception:
                # Rebuilding the index is best effort; failures shouldn't stop
                # the watcher.
                pass


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

    global _watch_thread
    if _watch_thread and _watch_thread.is_alive():
        return

    vault = Path(vault)
    db_path = Path(db_path) if db_path else vault / DEFAULT_DB_PATH
    index_path = Path(index_path) if index_path else vault / DEFAULT_INDEX_PATH

    thread = threading.Thread(
        target=_watch_loop, args=(vault, db_path, index_path), daemon=True
    )
    thread.start()
    _watch_thread = thread
