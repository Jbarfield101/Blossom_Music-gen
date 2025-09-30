from pathlib import Path
import sys
import sys
import sqlite3
import types
import pytest

from pathlib import Path


class _Array(list):
    def astype(self, _):
        return self
    
    @property
    def shape(self):
        if not self:
            return (0, 0)
        first = self[0]
        if isinstance(first, list):
            return (len(self), len(first))
        return (len(self),)


sys.modules.setdefault(
    "numpy",
    types.SimpleNamespace(
        asarray=lambda x, dtype=None: _Array(x) if isinstance(x, list) else x,
        array=lambda x, dtype=None: _Array(x) if isinstance(x, list) else x,
        vstack=lambda xs: _Array(xs),
    ),
)

sys.modules.setdefault(
    "faiss",
    types.SimpleNamespace(
        IndexIDMap=lambda base: _IndexIDMap(base),
        IndexFlatL2=lambda dim: _IndexFlatL2(dim),
        write_index=lambda index, path: None,
    ),
)

sys.modules.setdefault(
    "watchfiles",
    types.SimpleNamespace(Change=object, watch=lambda *a, **k: None),
)

requests_stub = types.SimpleNamespace(post=lambda *a, **k: None)
requests_stub.Response = type("Response", (), {})
requests_stub.exceptions = types.SimpleNamespace(
    HTTPError=Exception, RequestException=Exception, Timeout=Exception
)
sys.modules.setdefault("requests", requests_stub)
sys.modules.setdefault("requests.exceptions", requests_stub.exceptions)


class _IndexFlatL2:
    def __init__(self, dim):
        self.dim = dim


class _IndexIDMap:
    def __init__(self, base):
        self.base = base

    def add_with_ids(self, vectors, ids):
        pass

import numpy as np
import faiss

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import service_api
from brain import dialogue, ollama_client
import notes.search as search_mod
import json


def _fake_embed(texts, model_name=None):
    vecs = []
    for text in texts:
        t = text.lower()
        if "dragon" in t:
            vecs.append(_Array([1.0, 0.0]))
        elif "king" in t:
            vecs.append(_Array([0.0, 1.0]))
        else:
            vecs.append(_Array([0.0, 0.0]))
    return _Array(vecs)


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


def _patch_common(monkeypatch, vault, chunks):
    monkeypatch.setattr(service_api, "get_vault", lambda: vault)
    monkeypatch.setattr(dialogue.service_api, "get_vault", lambda: vault)

    def fake_search(query, tags=None):
        results = []
        for ch in chunks:
            if tags and not any(t in ch["tags"] for t in tags):
                continue
            results.append({"content": ch["content"]})
        return results

    monkeypatch.setattr(service_api, "search", fake_search)
    monkeypatch.setattr(dialogue.service_api, "search", fake_search)
    captured = {}

    def fake_generate(prompt: str) -> str:
        captured["prompt"] = prompt
        payload = {
            "who": "tester",
            "action": "say",
            "targets": [],
            "effects": [],
            "narration": prompt,
        }
        return json.dumps(payload)

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
    captured = _patch_common(monkeypatch, tmp_path, chunks)

    out = dialogue.respond("Tell me some lore about dragons")
    assert "Relevant notes (your campaign):" in out.narration
    assert "- Dragons are ancient creatures." in out.narration
    assert captured["prompt"] == out.narration


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
    captured = _patch_common(monkeypatch, tmp_path, chunks)

    out = dialogue.respond("Hello, what do I know about the king?")
    assert "Relevant notes (your campaign):" in out.narration
    assert "- King Arthur" in out.narration
    assert captured["prompt"] == out.narration


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
    captured = _patch_common(monkeypatch, tmp_path, chunks)

    msg = "Tell me some lore about dragons"
    out = dialogue.respond(msg)
    assert isinstance(out, str)
    expected = "No matching lore found in your campaign notes for: Tell me some lore about dragons"
    assert out == expected
    assert "Relevant notes" not in out


def test_dialogue_handles_common_queries(tmp_path, monkeypatch):
    chunks = [
        {
            "id": "npc_arannis",
            "path": "npcs/arannis.md",
            "heading": "Arannis",
            "content": "- Arannis Silverwind\n- Elven ranger of Emberfell\n- Scout for the Emberfell guard",
            "vector_id": 0,
            "tags": ["npc"],
            "vector": np.array([1.0, 0.0], dtype="float32"),
        },
        {
            "id": "lore_emberfell",
            "path": "lore/emberfell.md",
            "heading": "Emberfell",
            "content": "Emberfell is a bustling city built atop magma vents.\nIts markets never sleep.",
            "vector_id": 1,
            "tags": ["lore"],
            "vector": np.array([0.0, 1.0], dtype="float32"),
        },
        {
            "id": "lore_pantheon",
            "path": "lore/pantheon.md",
            "heading": "Pantheon",
            "content": "The Emberfell pantheon is ruled by a triad of flame gods.\nThey guard the city's forges.",
            "vector_id": 2,
            "tags": ["lore"],
            "vector": np.array([0.5, 0.5], dtype="float32"),
        },
    ]
    _build_vault(tmp_path, chunks)
    captured = _patch_common(monkeypatch, tmp_path, chunks)

    cases = [
        ("Who is Arannis?", "- Arannis Silverwind"),
        ("Tell me about the city of Emberfell", "- Emberfell is a bustling city built atop magma vents."),
        ("What gods rule the pantheon?", "- The Emberfell pantheon is ruled by a triad of flame gods."),
    ]

    for prompt, expected in cases:
        out = dialogue.respond(prompt)
        assert not isinstance(out, str)
        assert "Relevant notes (your campaign):" in out.narration
        assert expected in out.narration
        assert captured["prompt"] == out.narration
