from __future__ import annotations

import sys
import types

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import service_api
from notes import search as note_search


def _fake_embed_texts(texts, model_name=note_search.DEFAULT_MODEL):
    items = list(texts)
    if not items:
        return np.zeros((0, 1), dtype="float32")
    return np.zeros((len(items), 1), dtype="float32")


class _FakeFaissIndex:
    def reconstruct(self, vector_id: int) -> np.ndarray:  # pragma: no cover - defensive
        return np.zeros(1, dtype="float32")


def test_empty_database_returns_no_results(tmp_path: Path, monkeypatch) -> None:
    """APIs backed by an empty database should yield empty results."""

    db_path = tmp_path / "chunks.sqlite"
    db_path.touch()

    # Avoid loading heavy models or native dependencies during the test.
    monkeypatch.setattr(note_search, "embed_texts", _fake_embed_texts)
    fake_faiss = types.SimpleNamespace(read_index=lambda path: _FakeFaissIndex())
    monkeypatch.setitem(sys.modules, "faiss", fake_faiss)

    # Point the service API at the temporary vault directory.
    monkeypatch.setattr(service_api, "get_vault", lambda: tmp_path)

    assert service_api.search("anything") == []
    assert service_api.list_npcs() == []
    assert service_api.list_lore() == []
    assert (
        note_search.search_chunks(
            "anything", db_path, tmp_path / note_search.DEFAULT_INDEX_PATH
        )
        == []
    )
