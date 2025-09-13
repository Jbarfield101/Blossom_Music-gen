"""High level helpers for interacting with Obsidian notes.

This module exposes small convenience functions that operate on the
SQLite/FAISS index maintained for an Obsidian vault. A vault must be
selected via :func:`config.obsidian.select_vault` before any of the
functions here can be used.
"""

from __future__ import annotations

from pathlib import Path
from datetime import datetime
import sqlite3
from typing import List, Dict, Any

from config.obsidian import get_vault
from notes.embedding import DEFAULT_INDEX_PATH
from notes.watchdog import DEFAULT_DB_PATH
from notes.search import search_chunks
from notes.parser import parse_note, NoteParseError


def _paths() -> tuple[Path, Path, Path]:
    """Return ``(vault, db_path, index_path)`` for the selected vault.

    Raises
    ------
    RuntimeError
        If a vault has not been selected.
    """

    vault = get_vault()
    if vault is None:
        raise RuntimeError("Obsidian vault has not been selected")
    vault = vault.resolve()
    db_path = vault / DEFAULT_DB_PATH
    index_path = vault / DEFAULT_INDEX_PATH
    return vault, db_path, index_path


def search(query: str, tags: List[str] | None = None) -> List[Dict[str, Any]]:
    """Return ranked note chunks matching ``query``.

    Parameters
    ----------
    query:
        Natural language search string.
    tags:
        Optional list of tag strings. When provided, only chunks having at
        least one of these tags are considered.

    Returns
    -------
    list[dict]
        Each result dictionary contains ``path``, ``heading``, ``content`` and
        ``score`` (Euclidean distance where smaller is better).
    """

    _, db_path, index_path = _paths()
    results = search_chunks(query, db_path, index_path, tags=tags, top_k=5)
    if not results:
        return []

    chunk_ids = [cid for cid, _ in results]
    placeholders = ",".join("?" * len(chunk_ids))
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            f"SELECT id, path, heading, content FROM chunks WHERE id IN ({placeholders})",
            chunk_ids,
        ).fetchall()
    finally:
        conn.close()

    meta = {row[0]: row[1:] for row in rows}
    output: List[Dict[str, Any]] = []
    for cid, dist in results:
        info = meta.get(cid)
        if info is None:
            continue
        path, heading, content = info
        output.append(
            {
                "path": path,
                "heading": heading,
                "content": content,
                "score": dist,
            }
        )
    return output


def get_note(path: str) -> str:
    """Return the raw Markdown for ``path`` within the selected vault.

    Parameters
    ----------
    path:
        Path to the note relative to the root of the Obsidian vault.
    """

    vault, _, _ = _paths()
    note_path = (vault / path).resolve()
    try:
        note_path.relative_to(vault)
    except ValueError as exc:
        raise ValueError("path is outside the vault") from exc
    if not note_path.exists() or not note_path.is_file():
        raise FileNotFoundError(f"note not found: {path}")
    return note_path.read_text(encoding="utf-8")


def create_note(path: str, text: str) -> Path:
    """Append timestamped Markdown ``text`` to ``path`` within the selected vault.

    Parameters
    ----------
    path:
        Relative path of the note inside the Obsidian vault.
    text:
        Markdown content to append.

    Returns
    -------
    Path
        The resolved path to the note file.

    Raises
    ------
    RuntimeError
        If no vault has been selected.
    ValueError
        If ``path`` points outside the vault.
    """

    vault = get_vault()
    if vault is None:
        raise RuntimeError("Obsidian vault has not been selected")

    note_path = (vault / path).resolve()
    try:
        note_path.relative_to(vault)
    except ValueError as exc:
        raise ValueError("path is outside the vault") from exc

    note_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat(timespec="seconds")
    entry = f"\n\n## {timestamp}\n{text}\n"
    if note_path.exists():
        with note_path.open("a", encoding="utf-8") as fh:
            fh.write(entry)
    else:
        note_path.write_text(entry.lstrip(), encoding="utf-8")
    return note_path


def list_npcs() -> List[Dict[str, Any]]:
    """Return metadata for all notes tagged ``#npc``.

    The chunk database is queried for any notes containing an ``npc`` tag and
    each matching note is parsed to extract its metadata.
    """

    vault, db_path, _ = _paths()
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT c.path FROM chunks c
            JOIN tags t ON c.id = t.chunk_id
            WHERE lower(t.tag) = 'npc'
            """
        ).fetchall()
    finally:
        conn.close()

    results: List[Dict[str, Any]] = []
    for (rel_path,) in rows:
        note_file = vault / rel_path
        try:
            parsed = parse_note(note_file)
        except NoteParseError:
            continue
        results.append(
            {
                "path": rel_path,
                "aliases": parsed.aliases,
                "tags": parsed.tags,
                "fields": parsed.fields,
            }
        )
    return results
