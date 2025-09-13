from pathlib import Path

from brain.obsidian_parser import parse_vault


def test_parse_vault(tmp_path: Path) -> None:
    # Create a simple vault with two notes
    note1 = tmp_path / "note1.md"
    note1.write_text(
        "---\naliases: [Alice]\ntags: [npc]\n---\n# Intro\nHello\n# Outro\nWorld\n```npc\nname: Alice\n```",
        encoding="utf-8",
    )
    sub = tmp_path / "sub"
    sub.mkdir()
    note2 = sub / "note2.md"
    note2.write_text(
        "---\naliases: Bob\ntags: npc human\n---\nJust text",
        encoding="utf-8",
    )

    chunks = parse_vault(tmp_path)
    # note1 has two sections, note2 has one
    assert len(chunks) == 3

    first, second, third = chunks

    # First two chunks come from the same file and share metadata
    assert first.aliases == ["Alice"]
    assert first.tags == ["npc"]
    assert first.fields == {"name": "Alice"}
    assert first.id.split("-")[0] == second.id.split("-")[0]

    # Third chunk is from a different file with different id
    assert third.aliases == ["Bob"]
    assert third.tags == ["npc", "human"]
    assert third.id.split("-")[0] != first.id.split("-")[0]
