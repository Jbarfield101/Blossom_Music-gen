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
import os
from notes.chunker import ensure_chunk_tables
from notes.parser import parse_note, NoteParseError
from brain.constants import DEFAULT_DREADHAVEN_ROOT, BANNED_TERMS
import re


CHUNK_DB_NOT_READY_MESSAGE = (
    "Obsidian chunks database is not initialized. "
    "Run the Obsidian indexer/watchdog to build the note index."
)

_REQUIRED_CHUNK_TABLES = {"chunks", "tags"}


def _paths() -> tuple[Path, Path, Path]:
    """Return ``(vault, db_path, index_path)`` for the selected vault.

    Raises
    ------
    RuntimeError
        If a vault has not been selected.
    """

    vault = get_vault()
    if vault is None:
        # Fallback to default DreadHaven path when no vault configured
        if DEFAULT_DREADHAVEN_ROOT.exists():
            vault = DEFAULT_DREADHAVEN_ROOT
        else:
            raise RuntimeError("Obsidian vault has not been selected")
    vault = vault.resolve()
    db_path = vault / DEFAULT_DB_PATH
    index_path = vault / DEFAULT_INDEX_PATH
    return vault, db_path, index_path


def _ensure_chunks_db_ready(db_path: Path) -> None:
    """Raise a helpful error if the chunks database is unavailable."""

    if not db_path.exists() or not db_path.is_file():
        raise RuntimeError(CHUNK_DB_NOT_READY_MESSAGE)

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as exc:  # pragma: no cover - defensive
        raise RuntimeError(CHUNK_DB_NOT_READY_MESSAGE) from exc

    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    finally:
        conn.close()

    tables = {row[0] for row in rows}
    if not _REQUIRED_CHUNK_TABLES.issubset(tables):
        raise RuntimeError(CHUNK_DB_NOT_READY_MESSAGE)


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

    try:
        _, db_path, index_path = _paths()
        _ensure_chunks_db_ready(db_path)
        normalized_tags = [tag.lower() for tag in tags] if tags else None
        results = search_chunks(
            query, db_path, index_path, tags=normalized_tags, top_k=5
        )
        if not results:
            return []

        chunk_ids = [cid for cid, _ in results]
        placeholders = ",".join("?" * len(chunk_ids))
        conn = sqlite3.connect(db_path)
        try:
            ensure_chunk_tables(conn)
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
    except Exception:
        # Fallback: naive filesystem search when chunks DB isn't ready
        root, _, _ = _paths()
        q = query.strip()
        tokens = [t for t in q.replace("\n", " ").split() if len(t) >= 3] or [q]
        patterns = [re.compile(rf"\b{re.escape(tok)}(?:[’']s)?\b", re.IGNORECASE) for tok in tokens]
        results: List[Dict[str, Any]] = []
        banned = [re.compile(re.escape(t), re.IGNORECASE) for t in BANNED_TERMS]
        # Prefer exact filename matches under directories that look like god folders
        name_candidates = re.findall(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b", query)
        if not name_candidates:
            # Build candidates from significant tokens by title-casing
            toks = [t for t in query.replace("\n"," ").split() if len(t) >= 3]
            stop = {"the","a","an","about","tell","asked","ask","please","hi","hello","howdy","of","and","in","to","for","on","me","you"}
            name_candidates = [t.capitalize() for t in toks if t.lower() not in stop and t.isalpha()]
        preferred_dirs: list[Path] = []
        for dirpath, _dirnames, _files in os.walk(root):
            dp = dirpath.lower()
            if any(h in dp for h in (h.lower() for h in GOD_DIR_HINTS)):
                preferred_dirs.append(Path(dirpath))
        seen = set()
        for pd in preferred_dirs:
                for nd in name_candidates:
                    fname = f"{nd}.md"
                    for wdir, _d, files in os.walk(pd):
                        lower_files = {f.lower() for f in files}
                        target = None
                        if fname.lower() in lower_files:
                            target = fname
                        elif f"{nd}.markdown".lower() in lower_files:
                            target = f"{nd}.markdown"
                        if not target:
                            continue
                        p = Path(wdir) / target
                        if p in seen:
                            continue
                        try:
                            raw = p.read_text(encoding="utf-8", errors="ignore")
                        except Exception:
                            continue
                        if any(bp.search(raw) for bp in banned):
                            continue
                        heading = None
                        for line in raw.splitlines():
                            if line.strip().startswith("# "):
                                heading = line.strip()[2:].strip()
                                break
                        if not heading:
                            heading = p.stem
                        para = raw.strip().split("\n\n", 1)[0]
                        results.append(
                            {
                                "path": str(p.relative_to(root)),
                                "heading": heading,
                                "content": para,
                                "score": 0.0,
                            }
                        )
                        seen.add(p)
                        if len(results) >= 5:
                            break
                    if len(results) >= 5:
                        break
                if len(results) >= 5:
                    break

        # General recursive scan as a fallback (OR on significant tokens)
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if not fn.lower().endswith((".md", ".markdown", ".txt")):
                    continue
                path = Path(dirpath) / fn
                try:
                    raw = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                if any(bp.search(raw) for bp in banned):
                    continue
                if any(p.search(raw) for p in patterns):
                    # Build a small result
                    # Heading: first H1 or file stem
                    heading = None
                    for line in raw.splitlines():
                        if line.strip().startswith("# "):
                            heading = line.strip()[2:].strip()
                            break
                    if not heading:
                        heading = path.stem
                    # Content: first paragraph
                    para = raw.strip().split("\n\n", 1)[0]
                    results.append(
                        {
                            "path": str(path.relative_to(root)),
                            "heading": heading,
                            "content": para,
                            "score": 0.0,
                        }
                    )
                    if len(results) >= 5:
                        break
            if len(results) >= 5:
                break
        return results


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
    _ensure_chunks_db_ready(db_path)
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
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


def list_lore() -> List[Dict[str, Any]]:
    """Return metadata for notes tagged ``#lore``.

    Each lore entry is parsed to gather aliases, tags, custom fields and the
    cleaned body text. The returned items include a user-facing title derived
    from the first alias (falling back to the filename) and a short summary
    built from the first paragraph of the note.
    """

    vault, db_path, _ = _paths()
    _ensure_chunks_db_ready(db_path)
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
        rows = conn.execute(
            """
            SELECT DISTINCT c.path FROM chunks c
            JOIN tags t ON c.id = t.chunk_id
            WHERE lower(t.tag) = 'lore'
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

        title = parsed.aliases[0] if parsed.aliases else Path(rel_path).stem
        summary = ""
        if parsed.text:
            paragraphs = [p.strip() for p in parsed.text.split("\n\n") if p.strip()]
            if paragraphs:
                summary = paragraphs[0]
            else:
                lines = [ln.strip() for ln in parsed.text.splitlines() if ln.strip()]
                if lines:
                    summary = lines[0]

        results.append(
            {
                "path": rel_path,
                "title": title,
                "summary": summary,
                "content": parsed.text,
                "aliases": parsed.aliases,
                "tags": parsed.tags,
                "fields": parsed.fields,
            }
        )

    return results
