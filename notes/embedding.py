from __future__ import annotations

"""Utilities for embedding note chunks and maintaining a FAISS index.

This module provides :func:`rebuild_index` which rebuilds a FAISS index from
the ``chunks`` table produced by :mod:`notes.chunker`. Chunk content is
embedded using a local sentence-transformer model (MiniLM/E5 variants) and the
vector identifiers are stored back into the SQLite database.
"""

from pathlib import Path
import sqlite3
from typing import Iterable
import numpy as np

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_INDEX_PATH = "obsidian_index.faiss"


def _load_model(model_name: str):
    """Return a :class:`SentenceTransformer` for ``model_name``.

    Import is deferred so that the heavy dependency is only required when
    embeddings are actually generated.
    """

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def embed_texts(texts: Iterable[str], model_name: str = DEFAULT_MODEL) -> np.ndarray:
    """Embed ``texts`` into vectors using ``model_name``."""

    model = _load_model(model_name)
    vectors = model.encode(list(texts), show_progress_bar=False)
    return np.asarray(vectors, dtype="float32")


def _ensure_vector_column(conn: sqlite3.Connection) -> None:
    """Ensure the ``chunks`` table has a ``vector_id`` column."""

    cols = [row[1] for row in conn.execute("PRAGMA table_info(chunks)")]
    if "vector_id" not in cols:
        conn.execute("ALTER TABLE chunks ADD COLUMN vector_id INTEGER")
        conn.commit()


def _build_index(embeddings: np.ndarray, index_path: str | Path) -> np.ndarray:
    """Create a FAISS index for ``embeddings`` and persist it to ``index_path``.

    Returns the vector ids assigned to each embedding.
    """

    import faiss

    index = faiss.IndexIDMap(faiss.IndexFlatL2(embeddings.shape[1]))
    ids = np.arange(len(embeddings))
    index.add_with_ids(embeddings, ids)
    faiss.write_index(index, str(index_path))
    return ids


def rebuild_index(
    db_path: str | Path,
    index_path: str | Path = DEFAULT_INDEX_PATH,
    model_name: str = DEFAULT_MODEL,
) -> None:
    """Rebuild the FAISS index from the ``chunks`` table in ``db_path``.

    The function embeds all chunk content using ``model_name``, writes a FAISS
    index to ``index_path`` and stores the assigned ``vector_id`` for each chunk
    in the database.
    """

    db_path = Path(db_path)
    index_path = Path(index_path)

    conn = sqlite3.connect(db_path)
    try:
        _ensure_vector_column(conn)
        rows = conn.execute("SELECT id, content FROM chunks").fetchall()
        chunk_ids = [row[0] for row in rows]
        texts = [row[1] for row in rows]

        if texts:
            embeddings = embed_texts(texts, model_name)
            vector_ids = _build_index(embeddings, index_path)
            conn.executemany(
                "UPDATE chunks SET vector_id=? WHERE id=?",
                [(int(vid), cid) for vid, cid in zip(vector_ids, chunk_ids)],
            )
        else:
            # Create an empty index with the correct dimension
            model = _load_model(model_name)
            dim = model.get_sentence_embedding_dimension()
            import faiss

            index = faiss.IndexIDMap(faiss.IndexFlatL2(dim))
            faiss.write_index(index, str(index_path))
            conn.execute("UPDATE chunks SET vector_id=NULL")
        conn.commit()
    finally:
        conn.close()
