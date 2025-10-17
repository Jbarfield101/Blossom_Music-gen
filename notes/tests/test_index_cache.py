from __future__ import annotations

import json
from pathlib import Path

import mini_yaml as yaml

from notes.index_cache import BlossomIndex, load_index, save_index


def write_markdown(path: Path, metadata: dict[str, object], body: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    yaml_text = yaml.safe_dump(metadata)
    path.write_text(f"---\n{yaml_text}---\n{body}\n", encoding="utf-8")


def test_rebuild_and_upsert(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    npc_path = vault / "20_DM" / "NPC" / "Acolyte_Vorra.md"
    metadata = {
        "id": "npc_acolyte-vorra_abcd",
        "type": "npc",
        "name": "Acolyte Vorra",
        "region": "Arena Island",
        "tags": ["cult", "spy"],
    }
    write_markdown(npc_path, metadata, "## Body")

    index = BlossomIndex(vault, vault / ".blossom_index.json")
    index.rebuild()
    save_index(index, force=True)

    index_file = vault / ".blossom_index.json"
    payload = json.loads(index_file.read_text(encoding="utf-8"))
    assert payload["version"] == 1
    assert "npc_acolyte-vorra_abcd" in payload["entities"]

    # Update metadata and ensure upsert refreshes the entry
    metadata["region"] = "Stormreach"
    write_markdown(npc_path, metadata, "## Body")
    index.upsert_from_file(npc_path)
    save_index(index)
    payload = json.loads(index_file.read_text(encoding="utf-8"))
    entry = payload["entities"]["npc_acolyte-vorra_abcd"]
    assert entry["region"] == "Stormreach"

    # Loading via helper should succeed
    loaded = load_index(vault)
    assert loaded.get_by_id("npc_acolyte-vorra_abcd")["region"] == "Stormreach"
