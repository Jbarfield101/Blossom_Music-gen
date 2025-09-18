from __future__ import annotations

import sys
import types
import sqlite3

from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

import service_api
from notes import search as note_search
from notes.chunker import ensure_chunk_tables


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
    conn = sqlite3.connect(db_path)
    try:
        ensure_chunk_tables(conn)
    finally:
        conn.close()

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


def test_missing_database_raises_helpful_error(tmp_path: Path, monkeypatch) -> None:
    """The guard should prompt users to run the indexer when DB is absent."""

    monkeypatch.setattr(service_api, "get_vault", lambda: tmp_path)
    expected = service_api.CHUNK_DB_NOT_READY_MESSAGE

    with pytest.raises(RuntimeError) as excinfo:
        service_api.list_npcs()
    assert str(excinfo.value) == expected

    with pytest.raises(RuntimeError) as excinfo:
        service_api.list_lore()
    assert str(excinfo.value) == expected

    with pytest.raises(RuntimeError) as excinfo:
        service_api.search("anything")
    assert str(excinfo.value) == expected
