from __future__ import annotations

"""FastAPI endpoints for interacting with Obsidian vault notes."""

from pathlib import Path
import sqlite3
from typing import List

from fastapi import HTTPException, Query

from .app import app
from config.obsidian import get_vault
from notes.parser import parse_note, NoteParseError


def _get_vault() -> Path:
    """Return the configured Obsidian vault path or raise an error."""

    vault = get_vault()
    if vault is None:
        raise HTTPException(status_code=400, detail="vault not set")
    return vault


@app.get("/obsidian/note")
def get_note(path: str = Query(..., description="Vault relative path")) -> dict:
    """Return raw note content and metadata for ``path``.

    Parameters
    ----------
    path:
        Path to the note relative to the configured vault.
    """

    vault = _get_vault()
    note_path = (vault / path).resolve()
    try:
        note_path.relative_to(vault.resolve())
    except ValueError:  # outside vault
        raise HTTPException(status_code=400, detail="invalid path")
    if not note_path.exists() or not note_path.is_file():
        raise HTTPException(status_code=404, detail="note not found")

    try:
        parsed = parse_note(note_path)
    except NoteParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    content = note_path.read_text(encoding="utf-8")
    return {
        "path": path,
        "content": content,
        "aliases": parsed.aliases,
        "tags": parsed.tags,
        "fields": parsed.fields,
    }


@app.get("/obsidian/search")
def search_notes(
    q: str = Query(..., description="Search query"),
    tags: str | None = Query(None, description="Comma separated list of tags"),
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict:
    """Return ranked chunk summaries matching ``q``.

    A simple substring search is used which honours an optional list of
    ``tags``. Results are paginated via ``limit`` and ``offset``.
    """

    vault = _get_vault()
    db_path = vault / "chunks.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="chunk database not found")

    tag_list: List[str] = [t for t in (tags.split(",") if tags else []) if t]

    conn = sqlite3.connect(db_path)
    try:
        if tag_list:
            placeholders = ",".join("?" * len(tag_list))
            sql = (
                "SELECT c.path, c.heading, c.content FROM chunks c "
                "JOIN tags t ON c.id = t.chunk_id "
                f"WHERE t.tag IN ({placeholders})"
            )
            rows = conn.execute(sql, tag_list).fetchall()
        else:
            rows = conn.execute(
                "SELECT path, heading, content FROM chunks"
            ).fetchall()
    finally:
        conn.close()

    q_lower = q.lower()
    matches = []
    for path_, heading, content in rows:
        idx = content.lower().find(q_lower)
        if idx != -1:
            summary = content[:200]
            matches.append(
                {
                    "path": path_,
                    "heading": heading,
                    "summary": summary,
                    "score": idx,
                }
            )

    matches.sort(key=lambda x: x["score"])  # smaller index => better match
    total = len(matches)
    items = matches[offset : offset + limit]
    return {"total": total, "results": items}


@app.get("/obsidian/npcs")
def list_npcs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """Return notes tagged ``#npc`` with their aliases."""

    vault = _get_vault()
    npcs = []
    for path in sorted(vault.rglob("*.md")):
        try:
            parsed = parse_note(path)
        except NoteParseError:
            continue
        if any(tag.lower() == "npc" for tag in parsed.tags):
            rel = path.relative_to(vault).as_posix()
            npcs.append({"path": rel, "aliases": parsed.aliases})

    total = len(npcs)
    items = npcs[offset : offset + limit]
    return {"total": total, "results": items}
