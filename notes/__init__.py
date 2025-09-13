"""Note parsing utilities."""
from .parser import ParsedNote, NoteParseError, parse_note
from .chunker import NoteChunk, chunk_note, store_chunks

try:  # Optional dependency: numpy
    from .search import search_chunks  # type: ignore[assignment]
except Exception:  # pragma: no cover - optional module
    search_chunks = None

__all__ = [
    "ParsedNote",
    "parse_note",
    "NoteParseError",
    "NoteChunk",
    "chunk_note",
    "store_chunks",
]
if search_chunks is not None:
    __all__.append("search_chunks")
