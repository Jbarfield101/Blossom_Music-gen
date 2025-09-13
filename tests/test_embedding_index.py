from pathlib import Path
import sqlite3
import numpy as np

import embedding_index as ei


def _fake_embed_texts(texts, model_name=ei.DEFAULT_MODEL):
    mapping = {
        "alpha": np.array([1.0, 0.0], dtype="float32"),
        "beta": np.array([0.0, 1.0], dtype="float32"),
        "gamma": np.array([1.0, 1.0], dtype="float32"),
    }
    return np.vstack([mapping[t] for t in texts])


def test_search_with_tag_filter(tmp_path: Path) -> None:
    ei.embed_texts = _fake_embed_texts  # type: ignore[assignment]

    chunks = [
        ("alpha", {"path": "a.txt", "tags": ["x"], "aliases": []}),
        ("beta", {"path": "b.txt", "tags": ["y"], "aliases": []}),
        ("gamma", {"path": "c.txt", "tags": ["x", "y"], "aliases": []}),
    ]
    index_path = tmp_path / "index.faiss"
    db_path = tmp_path / "meta.db"
    ei.build_index(chunks, index_path, db_path)

    # ensure tags stored
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT chunk_id, tags FROM metadata ORDER BY chunk_id").fetchall()
    conn.close()
    assert rows == [(0, "x"), (1, "y"), (2, "x,y")]

    # search with tag filter
    results = ei.search_index("beta", index_path, db_path, tags=["x"], top_k=5)
    returned_ids = [cid for cid, _ in results]
    assert 1 not in returned_ids  # chunk with tag 'y' only filtered out
    assert 2 in returned_ids  # chunk with tag 'x' included

