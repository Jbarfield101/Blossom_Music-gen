from __future__ import annotations

from textwrap import dedent

from notes.parser import parse_note


def test_parse_note_handles_block_list_frontmatter(tmp_path):
    path = tmp_path / "bane.md"
    path.write_text(
        dedent(
            """\
            ---
            tags:
            - pantheon
            - deity
            - war
            alignment: chaotic evil
            ---
            # Bane
            """
        ),
        encoding="utf-8",
    )

    parsed = parse_note(path)

    assert parsed.metadata["tags"] == ["pantheon", "deity", "war"]
    assert parsed.metadata["alignment"] == "chaotic evil"


def test_parse_note_preserves_empty_scalars(tmp_path):
    path = tmp_path / "empty.md"
    path.write_text(
        dedent(
            """\
            ---
            summary:
            tags:
            - entry
            ---
            Body text.
            """
        ),
        encoding="utf-8",
    )

    parsed = parse_note(path)

    assert parsed.metadata["summary"] == ""
    assert parsed.metadata["tags"] == ["entry"]
