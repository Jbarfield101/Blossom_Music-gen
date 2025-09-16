from __future__ import annotations

"""Utilities for splitting parsed notes into smaller chunks.

This module exposes :func:`chunk_note` which takes a :class:`ParsedNote`
and optionally a vault relative path, returning a list of :class:`NoteChunk`
objects.  Each chunk represents a heading section within the note.  Chunks are
identified by deterministic hashes of ``path`` + ``heading`` and may be
persisted into a lightweight SQLite database via :func:`store_chunks`.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List
import hashlib
import re
import sqlite3

from .parser import ParsedNote


@dataclass
class NoteChunk:
    """Represents a single chunk of a note."""

    id: str
    path: str
    heading: str
    content: str
    tags: List[str]


_HEADING_RE = re.compile(r"^(#+)\s+(.*)$")

_CREATE_CHUNKS_TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS chunks("
    "id TEXT PRIMARY KEY, path TEXT, heading TEXT, content TEXT)"
)
_CREATE_TAGS_TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS tags("
    "chunk_id TEXT, tag TEXT)"
)


def _make_id(path: str, heading: str) -> str:
    """Return a deterministic identifier for ``path`` and ``heading``."""

    data = f"{path}:{heading}".encode("utf-8")
    return hashlib.sha1(data).hexdigest()


def chunk_note(parsed: ParsedNote, path: str | Path = "") -> List[NoteChunk]:
    """Split ``parsed`` into heading based chunks.

    Tags from ``parsed`` are propagated to each resulting chunk so they can be
    persisted separately.

    Parameters
    ----------
    parsed:
        Parsed note returned from :func:`notes.parser.parse_note`.
    path:
        Vault relative path of the note.  Used to derive deterministic chunk
        identifiers.  Defaults to an empty string, which is adequate for
        tests that do not care about path uniqueness.
    """

    rel_path = str(path)
    lines = parsed.text.splitlines()
    chunks: List[NoteChunk] = []
    heading_stack: List[str] = []
    buffer: List[str] = []

    def push() -> None:
        """Flush the buffer as a chunk using the current heading stack."""

        if not buffer:
            return
        full_heading = "/".join(heading_stack)
        content = "\n".join(buffer).strip()
        buffer.clear()
        if not content and not full_heading:
            return
        chunk_id = _make_id(rel_path, full_heading)
        chunks.append(
            NoteChunk(chunk_id, rel_path, full_heading, content, list(parsed.tags))
        )

    for line in lines:
        match = _HEADING_RE.match(line)
        if match:
            push()
            level = len(match.group(1))
            heading = match.group(2).strip()
            heading_stack[:] = heading_stack[: level - 1]
            heading_stack.append(heading)
        else:
            buffer.append(line)

    push()
    return chunks


def ensure_chunk_tables(conn: sqlite3.Connection) -> None:
    """Ensure the ``chunks`` and ``tags`` tables exist in ``conn``."""

    conn.execute(_CREATE_CHUNKS_TABLE_SQL)
    conn.execute(_CREATE_TAGS_TABLE_SQL)


def store_chunks(chunks: Iterable[NoteChunk], db_path: str | Path) -> None:
    """Persist ``chunks`` and their tags into ``db_path``.

    Two tables are maintained:

    ``chunks``
        ``(id TEXT PRIMARY KEY, path TEXT, heading TEXT, content TEXT)``
    ``tags``
        ``(chunk_id TEXT, tag TEXT)`` mapping chunk identifiers to tag strings.
    """

    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)

        conn.executemany(
            "REPLACE INTO chunks(id, path, heading, content) VALUES(?, ?, ?, ?)",
            [(c.id, c.path, c.heading, c.content) for c in chunks],
        )

        chunk_ids = [(c.id,) for c in chunks]
        conn.executemany("DELETE FROM tags WHERE chunk_id=?", chunk_ids)
        tag_rows = [(c.id, tag) for c in chunks for tag in c.tags]
        if tag_rows:
            conn.executemany(
                "INSERT INTO tags(chunk_id, tag) VALUES(?, ?)", tag_rows
            )

        conn.commit()
    finally:
        conn.close()
