from __future__ import annotations

"""Search utilities for note chunks."""

from pathlib import Path
import sqlite3
from typing import List, Tuple

import numpy as np

from .embedding import embed_texts, DEFAULT_MODEL, DEFAULT_INDEX_PATH


def search_chunks(
    query: str,
    db_path: str | Path,
    index_path: str | Path = DEFAULT_INDEX_PATH,
    tags: List[str] | None = None,
    top_k: int = 5,
    model_name: str = DEFAULT_MODEL,
) -> List[Tuple[str, float]]:
    """Return ``top_k`` chunk ids and distances matching ``query``.

    Parameters
    ----------
    query:
        Natural language search string.
    db_path:
        Path to the SQLite database created by :func:`notes.chunker.store_chunks`.
    index_path:
        Path to the FAISS index built by :func:`notes.embedding.rebuild_index`.
    tags:
        Optional list of tag strings. When provided, only chunks having at least
        one of these tags are considered.
    top_k:
        Number of results to return.
    model_name:
        Name of the sentence transformer model used for embedding.

    Returns
    -------
    list[tuple[str, float]]
        A list of ``(chunk_id, distance)`` pairs sorted by ascending distance.
    """

    # Embed the query text
    query_vec = embed_texts([query], model_name)[0].astype("float32")

    # Import faiss lazily to avoid a hard dependency when search is unused
    import faiss

    conn = sqlite3.connect(db_path)
    try:
        if tags:
            placeholders = ",".join("?" * len(tags))
            sql = (
                "SELECT id, vector_id FROM chunks "
                f"WHERE id IN (SELECT DISTINCT chunk_id FROM tags WHERE tag IN ({placeholders})) "
                "AND vector_id IS NOT NULL"
            )
            rows = conn.execute(sql, tags).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, vector_id FROM chunks WHERE vector_id IS NOT NULL"
            ).fetchall()
    finally:
        conn.close()

    if not rows:
        return []

    chunk_ids = [row[0] for row in rows]
    vector_ids = [int(row[1]) for row in rows]

    index = faiss.read_index(str(index_path))
    vectors = np.vstack([index.reconstruct(vid) for vid in vector_ids])
    diffs = vectors - query_vec
    dists = np.sum(diffs * diffs, axis=1)
    order = np.argsort(dists)[:top_k]
    return [(chunk_ids[i], float(dists[i])) for i in order]
