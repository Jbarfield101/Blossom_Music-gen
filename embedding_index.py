from __future__ import annotations

"""Utilities for building a FAISS embedding index with metadata.

This module embeds text chunks using a local MiniLM/E5 sentence-transformer
model, stores the vectors in a FAISS index and records associated metadata in
an SQLite database. Metadata rows are keyed by the chunk id used for the vector
in the FAISS index.

Examples
--------
>>> chunks = [
...     ("An example document chunk", {"path": "doc1.txt", "tags": ["x"], "aliases": ["ex"]}),
... ]
>>> build_index(chunks, "embeddings.faiss", "meta.db")
"""

from pathlib import Path
import sqlite3
from typing import Iterable, Tuple, Dict, Any

import numpy as np

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _load_model(model_name: str):
    """Load and return a :class:`SentenceTransformer` instance."""

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def embed_texts(texts: Iterable[str], model_name: str = DEFAULT_MODEL) -> np.ndarray:
    """Return embeddings for ``texts`` using ``model_name``.

    Embeddings are returned as a NumPy ``float32`` array.
    """

    model = _load_model(model_name)
    vectors = model.encode(list(texts), show_progress_bar=False, normalize_embeddings=True)
    return np.asarray(vectors, dtype="float32")


def _open_db(db_path: str | Path) -> sqlite3.Connection:
    """Open ``db_path`` and ensure the metadata table exists."""

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS metadata (
            chunk_id INTEGER PRIMARY KEY,
            path TEXT,
            tags TEXT,
            aliases TEXT
        )
        """
    )
    return conn


def build_index(
    chunks: Iterable[Tuple[str, Dict[str, Any]]],
    index_path: str | Path,
    db_path: str | Path,
    model_name: str = DEFAULT_MODEL,
) -> None:
    """Build a FAISS index and SQLite metadata for ``chunks``.

    Parameters
    ----------
    chunks:
        Iterable of ``(text, metadata)`` pairs. ``metadata`` should contain
        ``path``, ``tags`` and ``aliases`` keys.
    index_path:
        Destination path for the FAISS index.
    db_path:
        Destination path for the SQLite database storing metadata.
    model_name:
        Sentence-transformer model to use for embeddings.
    """

    index_path = Path(index_path)
    db_path = Path(db_path)

    texts: list[str] = []
    meta: list[Dict[str, Any]] = []
    for text, m in chunks:
        texts.append(text)
        meta.append(m)

    if not texts:
        raise ValueError("No chunks provided")

    embeddings = embed_texts(texts, model_name)

    import faiss

    index = faiss.IndexIDMap(faiss.IndexFlatL2(embeddings.shape[1]))
    ids = np.arange(len(embeddings), dtype="int64")
    index.add_with_ids(embeddings, ids)
    save_index(index, index_path)

    conn = _open_db(db_path)
    try:
        rows = [
            (
                int(i),
                m.get("path"),
                ",".join(m.get("tags", [])),
                ",".join(m.get("aliases", [])),
            )
            for i, m in zip(ids, meta)
        ]
        conn.executemany(
            "INSERT OR REPLACE INTO metadata(chunk_id, path, tags, aliases) VALUES (?, ?, ?, ?)",
            rows,
        )
        save_metadata(conn)
    finally:
        conn.close()


def load_index(index_path: str | Path) -> Any:
    """Return a FAISS index loaded from ``index_path``."""

    import faiss

    return faiss.read_index(str(index_path))


def save_index(index: Any, index_path: str | Path) -> None:
    """Persist ``index`` to ``index_path``."""

    import faiss

    faiss.write_index(index, str(index_path))


def load_metadata(db_path: str | Path) -> sqlite3.Connection:
    """Return a connection to the SQLite metadata database."""

    return _open_db(db_path)


def save_metadata(conn: sqlite3.Connection) -> None:
    """Commit and persist any pending metadata changes."""

    conn.commit()
