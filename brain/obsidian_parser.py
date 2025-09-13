from __future__ import annotations

"""Parse an Obsidian vault into normalized document chunks.

The :func:`parse_vault` function walks a directory looking for Markdown
files.  Each file is parsed using :func:`notes.parser.parse_note` to extract
metadata such as aliases, tags and custom fields from ``npc`` blocks.  The
note body is then split into sections based on Markdown headings and each
section is returned as a :class:`DocumentChunk` with associated metadata.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List
import re

from notes.parser import parse_note


@dataclass
class DocumentChunk:
    """A normalized chunk of text extracted from a Markdown note."""

    id: str
    text: str
    tags: List[str]
    aliases: List[str]
    fields: Dict[str, Any]


_HEADING_RE = re.compile(r"^#+\s", re.MULTILINE)


def _split_sections(text: str) -> List[str]:
    """Split ``text`` into sections using Markdown headings.

    The heading lines themselves are kept at the start of each section.  Any
    leading or trailing whitespace around sections is stripped.
    """

    if not text:
        return []

    sections: List[str] = []
    start = 0
    for match in _HEADING_RE.finditer(text):
        if match.start() != start:
            sections.append(text[start:match.start()].strip())
        start = match.start()
    sections.append(text[start:].strip())
    return [s for s in sections if s]


def parse_vault(root: Path) -> List[DocumentChunk]:
    """Parse all Markdown notes under ``root``.

    Parameters
    ----------
    root:
        Directory containing the Obsidian vault.
    """

    chunks: List[DocumentChunk] = []
    for file_id, path in enumerate(sorted(root.rglob("*.md")), start=1):
        if not path.is_file():
            continue
        note = parse_note(path)
        sections = _split_sections(note.text)
        for section_id, section in enumerate(sections):
            chunk_id = f"{file_id}-{section_id}"
            chunks.append(
                DocumentChunk(
                    id=chunk_id,
                    text=section,
                    tags=note.tags,
                    aliases=note.aliases,
                    fields=note.fields,
                )
            )
    return chunks
