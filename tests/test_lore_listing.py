import sqlite3
from pathlib import Path

import pytest

# Ensure repository root on sys.path so ``service_api`` can be imported when tests
# are executed directly.
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import service_api  # noqa: E402  (import after path adjustment)
from notes.chunker import ensure_chunk_tables  # noqa: E402
from notes.watchdog import DEFAULT_DB_PATH  # noqa: E402


@pytest.mark.parametrize("subdir", ["", "lore"])
def test_list_lore_includes_note_content(tmp_path: Path, monkeypatch, subdir: str) -> None:
    """Notes tagged ``#lore`` should surface content and metadata."""

    vault = tmp_path
    note_dir = vault / subdir if subdir else vault
    note_dir.mkdir(parents=True, exist_ok=True)
    note_rel_path = f"{subdir + '/' if subdir else ''}ancient-tales.md"
    note_path = note_dir / "ancient-tales.md"
    note_path.write_text(
        """---
aliases: [Ancient Tales]
tags: [lore, story]
---
First paragraph about the lost city.

Second paragraph with extra details.
""",
        encoding="utf-8",
    )

    db_path = vault / DEFAULT_DB_PATH
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
        conn.execute(
            "INSERT OR REPLACE INTO chunks(id, path, heading, content) VALUES(?, ?, ?, ?)",
            (
                "chunk-1",
                note_rel_path,
                "",
                "First paragraph about the lost city.\n\nSecond paragraph with extra details.",
            ),
        )
        conn.execute(
            "INSERT INTO tags(chunk_id, tag) VALUES(?, ?)",
            ("chunk-1", "lore"),
        )
        conn.execute(
            "INSERT INTO tags(chunk_id, tag) VALUES(?, ?)",
            ("chunk-1", "story"),
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setattr(service_api, "get_vault", lambda: vault)

    items = service_api.list_lore()
    assert len(items) == 1
    entry = items[0]

    assert entry["path"] == note_rel_path
    assert entry["title"] == "Ancient Tales"
    assert entry["summary"] == "First paragraph about the lost city."
    assert (
        entry["content"]
        == "First paragraph about the lost city.\n\nSecond paragraph with extra details."
    )
    assert entry["aliases"] == ["Ancient Tales"]
    assert sorted(entry["tags"]) == ["lore", "story"]
    assert entry["fields"] == {}

