import os
import sys
import types

from fastapi.testclient import TestClient

# Patch ``multipart`` as done in other tests to satisfy FastAPI dependency
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

multipart_mod = types.ModuleType("multipart")
multipart_submod = types.ModuleType("multipart.multipart")
multipart_mod.__version__ = "0"

def parse_options_header(value: str) -> tuple[str, dict[str, str]]:
    return value, {}

multipart_submod.parse_options_header = parse_options_header
sys.modules.setdefault("multipart", multipart_mod)
sys.modules.setdefault("multipart.multipart", multipart_submod)

from webui.app import app  # noqa: E402
from config import obsidian  # noqa: E402
from notes.parser import parse_note  # noqa: E402
from notes.chunker import chunk_note, store_chunks  # noqa: E402


def _reset_vault() -> None:
    if obsidian.VAULT_FILE.exists():
        obsidian.VAULT_FILE.unlink()
    if "_VAULT_PATH" in obsidian.__dict__:
        obsidian.__dict__["_VAULT_PATH"] = None


def _setup_vault(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()

    (vault / "npc_a.md").write_text(
        """---
aliases: [Alice]
tags: [npc, friend]
---
# Bio
Alice is a friendly NPC.
# Story
Alice has a pet dragon.
""",
        encoding="utf-8",
    )

    (vault / "npc_b.md").write_text(
        """---
aliases: Bob
tags: npc
---
# Bio
Bob is an NPC.
# Story
Bob lost his sword.
""",
        encoding="utf-8",
    )

    (vault / "lore.md").write_text(
        """---
tags: lore
---
# History
The ancient sword was forged in fire.
""",
        encoding="utf-8",
    )

    # Build chunk database
    chunks = []
    for path in vault.glob("*.md"):
        parsed = parse_note(path)
        rel = path.relative_to(vault).as_posix()
        chunks.extend(chunk_note(parsed, rel))
    store_chunks(chunks, vault / "chunks.db")

    _reset_vault()
    obsidian.select_vault(vault)
    return vault


def test_get_note(tmp_path):
    _setup_vault(tmp_path)
    client = TestClient(app)

    resp = client.get("/obsidian/note", params={"path": "npc_a.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["aliases"] == ["Alice"]
    assert "friendly NPC" in data["content"]

    resp = client.get("/obsidian/note", params={"path": "missing.md"})
    assert resp.status_code == 404


def test_search(tmp_path):
    _setup_vault(tmp_path)
    client = TestClient(app)

    resp = client.get("/obsidian/search", params={"q": "sword"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    paths = {r["path"] for r in data["results"]}
    assert "npc_b.md" in paths
    assert "lore.md" in paths

    resp = client.get(
        "/obsidian/search", params={"q": "sword", "limit": 1, "offset": 1}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1


def test_npcs(tmp_path):
    _setup_vault(tmp_path)
    client = TestClient(app)

    resp = client.get("/obsidian/npcs")
    assert resp.status_code == 200
    data = resp.json()
    paths = {r["path"] for r in data["results"]}
    assert {"npc_a.md", "npc_b.md"} <= paths

    resp = client.get("/obsidian/npcs", params={"limit": 1})
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 1
