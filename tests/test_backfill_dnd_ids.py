from __future__ import annotations

import logging
from pathlib import Path

import frontmatter
import pytest

from scripts import backfill_dnd_ids


def test_backfill_dnd_ids_dry_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    note = vault / "entity.md"
    note.write_text("---\nname: Dry Run\n---\nBody", encoding="utf-8")

    upsert_calls: list[tuple[Path, Path]] = []

    def fake_upsert(vault_path: Path, rel_path: Path, parsed: object, *, index_path=None) -> bool:  # type: ignore[override]
        upsert_calls.append((vault_path, Path(rel_path)))
        return True

    monkeypatch.setattr(backfill_dnd_ids.index_cache, "upsert_from_file", fake_upsert)
    caplog.set_level(logging.INFO)

    original = note.read_text(encoding="utf-8")
    summary = backfill_dnd_ids.backfill_dnd_ids(vault, dry_run=True)

    assert summary.updated == 1
    assert summary.skipped == 0
    assert summary.errors == 0
    assert note.read_text(encoding="utf-8") == original
    assert not upsert_calls
    assert "Would assign" in caplog.text


def test_backfill_dnd_ids_writes_and_updates_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()

    with_id = vault / "existing.md"
    with_id.write_text(
        "---\nid: npc_existing-hero_abcd\nname: Existing\n---\nExisting", encoding="utf-8"
    )

    needs_id = vault / "new.md"
    needs_id.write_text("---\nname: New Hero\n---\nStory", encoding="utf-8")

    captured: dict[str, object] = {}

    def fake_upsert(vault_path: Path, rel_path: Path, parsed: backfill_dnd_ids.ParsedNote, *, index_path=None) -> bool:  # type: ignore[override]
        captured["vault"] = vault_path
        captured["rel_path"] = Path(rel_path)
        captured["parsed"] = parsed
        return True

    monkeypatch.setattr(backfill_dnd_ids.index_cache, "upsert_from_file", fake_upsert)

    summary = backfill_dnd_ids.backfill_dnd_ids(vault)

    assert summary.updated == 1
    assert summary.skipped == 1
    assert summary.errors == 0

    with needs_id.open("r", encoding="utf-8") as fh:
        parsed_note = frontmatter.load(fh)
    new_id = parsed_note.metadata.get("id")
    assert isinstance(new_id, str)
    assert backfill_dnd_ids.is_valid_npc_id(new_id)

    assert captured["vault"] == vault.resolve()
    assert captured["rel_path"] == needs_id.relative_to(vault)
    parsed = captured["parsed"]
    assert isinstance(parsed, backfill_dnd_ids.ParsedNote)
    assert parsed.metadata["id"] == new_id

    with with_id.open("r", encoding="utf-8") as fh:
        existing_meta = frontmatter.load(fh).metadata
    assert existing_meta.get("id") == "npc_existing-hero_abcd"
