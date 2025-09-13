from __future__ import annotations

"""Filesystem watcher for automatically maintaining note embeddings.

This script watches a vault directory for Markdown (``.md``) file changes. When
files are created, modified or deleted the corresponding chunks in the SQLite
store are updated and a FAISS embedding index is rebuilt. Rapid sequences of
changes are debounced so that the expensive reindex step only runs once after
activity has settled.
"""

from pathlib import Path
import asyncio
import sqlite3
from typing import Iterable

from watchfiles import Change, awatch

from notes.parser import parse_note, NoteParseError
from notes.chunker import chunk_note, store_chunks
from notes.embedding import rebuild_index, DEFAULT_INDEX_PATH

DEFAULT_DB_PATH = "chunks.sqlite"

# Seconds to wait after the last change before rebuilding the index
DEFAULT_DEBOUNCE = 1.0


def _remove_note(rel_path: str, db_path: Path) -> None:
    """Remove all chunks for ``rel_path`` from the database."""
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "DELETE FROM tags WHERE chunk_id IN (SELECT id FROM chunks WHERE path=?)",
            (rel_path,),
        )
        conn.execute("DELETE FROM chunks WHERE path=?", (rel_path,))
        conn.commit()
    finally:
        conn.close()


async def _reindex_after_delay(db_path: Path, index_path: Path, delay: float) -> None:
    """Sleep for ``delay`` seconds then rebuild the index."""
    await asyncio.sleep(delay)
    try:
        rebuild_index(db_path, index_path)
    except Exception:
        # Index rebuilding is best-effort; errors should not stop the watcher
        pass


def _handle_changes(changes: Iterable[tuple[Change, str]], vault: Path, db_path: Path) -> bool:
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
            _remove_note(rel, db_path)
            updated = True
    return updated


async def watch_vault(
    vault: Path,
    db_path: Path | None = None,
    index_path: Path | None = None,
    debounce: float = DEFAULT_DEBOUNCE,
) -> None:
    """Watch ``vault`` for Markdown changes and keep the embedding index fresh."""

    vault = Path(vault)
    db_path = Path(db_path) if db_path else vault / DEFAULT_DB_PATH
    index_path = Path(index_path) if index_path else vault / DEFAULT_INDEX_PATH

    reindex_task: asyncio.Task | None = None

    async for changes in awatch(vault, recursive=True):
        if _handle_changes(changes, vault, db_path):
            if reindex_task and not reindex_task.done():
                reindex_task.cancel()
            reindex_task = asyncio.create_task(
                _reindex_after_delay(db_path, index_path, debounce)
            )


def main() -> None:
    """Entry point for command line usage."""
    import argparse

    parser = argparse.ArgumentParser(description="Watch a vault for markdown changes")
    parser.add_argument("vault", type=Path, help="Path to the vault root")
    parser.add_argument("--db-path", type=Path, default=None, help="Path to chunks SQLite DB")
    parser.add_argument(
        "--index-path",
        type=Path,
        default=None,
        help="Path to FAISS index file",
    )
    parser.add_argument(
        "--debounce",
        type=float,
        default=DEFAULT_DEBOUNCE,
        help="Seconds to debounce rapid changes",
    )
    args = parser.parse_args()
    asyncio.run(watch_vault(args.vault, args.db_path, args.index_path, args.debounce))


if __name__ == "__main__":
    main()

