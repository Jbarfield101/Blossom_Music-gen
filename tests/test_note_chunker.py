from pathlib import Path
import sqlite3
import hashlib

from notes import parse_note
from notes.chunker import chunk_note, store_chunks


def test_chunk_note_and_store(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    note_path = vault / "note.md"
    note_path.write_text("# H1\nPara1\n## H1.1\nSub\n# H2\nPara2", encoding="utf-8")

    parsed = parse_note(note_path)
    rel_path = note_path.relative_to(vault)
    chunks = chunk_note(parsed, rel_path.as_posix())

    headings = ["H1", "H1/H1.1", "H2"]
    contents = ["Para1", "Sub", "Para2"]

    assert [c.heading for c in chunks] == headings
    assert [c.content for c in chunks] == contents

    expected_ids = [
        hashlib.sha1(f"{rel_path.as_posix()}:{h}".encode("utf-8")).hexdigest()
        for h in headings
    ]
    assert [c.id for c in chunks] == expected_ids
    assert all(c.path == rel_path.as_posix() for c in chunks)

    db_path = tmp_path / "chunks.sqlite"
    store_chunks(chunks, db_path)
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT id, path, heading, content FROM chunks").fetchall()
    conn.close()
    expected_rows = [(c.id, c.path, c.heading, c.content) for c in chunks]
    assert sorted(rows) == sorted(expected_rows)
