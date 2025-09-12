from pathlib import Path

import pytest

from notes.parser import NoteParseError, parse_note


def test_parse_note(tmp_path: Path) -> None:
    note = tmp_path / "note.md"
    note.write_text(
        "---\naliases: [Bob, Bobby]\ntags: [npc, human]\n---\nHello\n```npc\nname: Bob\nrole: merchant\n```\nWorld",
        encoding="utf-8",
    )
    parsed = parse_note(note)
    assert parsed.text == "Hello\nWorld"
    assert parsed.aliases == ["Bob", "Bobby"]
    assert parsed.tags == ["npc", "human"]
    assert parsed.fields == {"name": "Bob", "role": "merchant"}


def test_bad_frontmatter(tmp_path: Path) -> None:
    note = tmp_path / "bad.md"
    note.write_text("---\naliases: [\n---\ntext", encoding="utf-8")
    with pytest.raises(NoteParseError):
        parse_note(note)


def test_non_utf8(tmp_path: Path) -> None:
    note = tmp_path / "latin1.md"
    note.write_bytes(b"---\naliases: Bob\n---\n\xff")
    with pytest.raises(NoteParseError):
        parse_note(note)


def test_bad_npc_block(tmp_path: Path) -> None:
    note = tmp_path / "npc.md"
    note.write_text("---\n---\n```npc\n: - bad\n```", encoding="utf-8")
    with pytest.raises(NoteParseError):
        parse_note(note)
