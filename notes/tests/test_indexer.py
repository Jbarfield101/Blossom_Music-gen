from __future__ import annotations

import json
from pathlib import Path

from notes import watchdog
from notes import indexer


NOTE_TEMPLATE = """---
id: {note_id}
type: npc
name: {name}
aliases: [{alias}]
tags: [{tag}]
---
Body content.
"""


def _write_note(path: Path, note_id: str, name: str, alias: str = "Alias", tag: str = "tag") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        NOTE_TEMPLATE.format(note_id=note_id, name=name, alias=alias, tag=tag),
        encoding="utf-8",
    )


def test_bootstrap_creates_index(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    note_path = vault / "npcs" / "alice.md"
    _write_note(note_path, "npc_alice", "Alice", alias="Ally", tag="hero")

    watchdog.bootstrap_vault(vault)

    index_file = vault / indexer.INDEX_FILENAME
    assert index_file.exists()
    data = json.loads(index_file.read_text(encoding="utf-8"))
    assert data["version"] == indexer.INDEX_VERSION
    assert "generated_at" in data
    entity = data["entities"]["npc_alice"]
    assert entity["name"] == "Alice"
    assert entity["type"] == "npc"
    assert entity["path"] == "npcs/alice.md"
    assert entity["aliases"] == ["Ally"]
    assert entity["tags"] == ["hero"]


def test_process_events_updates_index_on_rename_and_delete(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    original_rel = "npcs/alice.md"
    renamed_rel = "npcs/alice_renamed.md"
    note_path = vault / original_rel
    _write_note(note_path, "npc_alice", "Alice")

    watchdog.bootstrap_vault(vault)

    target = vault / renamed_rel
    note_path.rename(target)

    watchdog.process_events(
        vault,
        [{"kind": "rename", "path": renamed_rel, "old_path": original_rel}],
        rebuild=False,
    )
    indexer.save_index(vault, force=True)

    entity = indexer.get_by_id(vault, "npc_alice")
    assert entity is not None
    assert entity["path"] == renamed_rel

    data = indexer.load_index(vault)
    assert data["entities"]["npc_alice"]["path"] == renamed_rel

    target.unlink()
    watchdog.process_events(vault, [{"kind": "remove", "path": renamed_rel}], rebuild=False)
    indexer.save_index(vault, force=True)

    assert indexer.get_by_id(vault, "npc_alice") is None
    data_after = indexer.load_index(vault)
    assert "npc_alice" not in data_after["entities"]
