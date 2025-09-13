from pathlib import Path
import sys
import sqlite3
import numpy as np
import faiss
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import service_api
from brain import dialogue, ollama_client
import notes.search as search_mod


def _fake_embed(texts, model_name=None):
    vecs = []
    for text in texts:
        t = text.lower()
        if "dragon" in t:
            vecs.append([1.0, 0.0])
        elif "king" in t:
            vecs.append([0.0, 1.0])
        else:
            vecs.append([0.0, 0.0])
    return np.asarray(vecs, dtype="float32")


def _build_vault(root: Path, chunks):
    db_path = root / "chunks.sqlite"
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE chunks (id TEXT PRIMARY KEY, path TEXT, heading TEXT, content TEXT, vector_id INTEGER)"
    )
    conn.execute("CREATE TABLE tags (chunk_id TEXT, tag TEXT)")
    for ch in chunks:
        conn.execute(
            "INSERT INTO chunks VALUES (?, ?, ?, ?, ?)",
            (ch["id"], ch["path"], ch["heading"], ch["content"], ch["vector_id"]),
        )
        for tag in ch["tags"]:
            conn.execute(
                "INSERT INTO tags VALUES (?, ?)", (ch["id"], tag)
            )
    conn.commit()
    conn.close()

    vectors = np.vstack([c["vector"] for c in chunks]).astype("float32")
    index = faiss.IndexIDMap(faiss.IndexFlatL2(vectors.shape[1]))
    ids = np.array([c["vector_id"] for c in chunks], dtype="int64")
    index.add_with_ids(vectors, ids)
    faiss.write_index(index, str(root / "obsidian_index.faiss"))


def _patch_common(monkeypatch, vault):
    monkeypatch.setattr(service_api, "get_vault", lambda: vault)
    monkeypatch.setattr(dialogue.service_api, "get_vault", lambda: vault)
    monkeypatch.setattr(search_mod, "embed_texts", _fake_embed)
    captured = {}

    def fake_generate(prompt: str) -> str:
        captured["prompt"] = prompt
        return prompt

    monkeypatch.setattr(ollama_client, "generate", fake_generate)
    monkeypatch.setattr(dialogue.ollama_client, "generate", fake_generate)
    return captured


def test_lore_injection(tmp_path, monkeypatch):
    chunks = [
        {
            "id": "c1",
            "path": "lore/dragons.md",
            "heading": "Dragons",
            "content": "Dragons are ancient creatures.\nThey rule the sky.",
            "vector_id": 0,
            "tags": ["lore"],
            "vector": np.array([1.0, 0.0], dtype="float32"),
        },
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 1,
            "tags": ["npc"],
            "vector": np.array([0.0, 1.0], dtype="float32"),
        },
    ]
    _build_vault(tmp_path, chunks)
    captured = _patch_common(monkeypatch, tmp_path)

    out = dialogue.respond("Tell me some lore about dragons")
    assert "Relevant notes:" in out
    assert "- Dragons are ancient creatures." in out
    assert captured["prompt"] == out


def test_npc_injection(tmp_path, monkeypatch):
    chunks = [
        {
            "id": "c1",
            "path": "lore/dragons.md",
            "heading": "Dragons",
            "content": "Dragons are ancient creatures.\nThey rule the sky.",
            "vector_id": 0,
            "tags": ["lore"],
            "vector": np.array([1.0, 0.0], dtype="float32"),
        },
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 1,
            "tags": ["npc"],
            "vector": np.array([0.0, 1.0], dtype="float32"),
        },
    ]
    _build_vault(tmp_path, chunks)
    captured = _patch_common(monkeypatch, tmp_path)

    out = dialogue.respond("Hello, what do I know about the king?")
    assert "Relevant notes:" in out
    assert "- King Arthur" in out
    assert captured["prompt"] == out


def test_no_notes_fallback(tmp_path, monkeypatch):
    chunks = [
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 0,
            "tags": ["npc"],
            "vector": np.array([0.0, 1.0], dtype="float32"),
        }
    ]
    _build_vault(tmp_path, chunks)
    captured = _patch_common(monkeypatch, tmp_path)

    msg = "Tell me some lore about dragons"
    out = dialogue.respond(msg)
    assert out == msg
    assert captured["prompt"] == msg
