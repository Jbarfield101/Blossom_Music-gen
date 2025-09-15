from __future__ import annotations

"""Utilities for parsing Obsidian style Markdown notes.

This module exposes :func:`parse_note` which loads the frontmatter and
content of a note, returning a :class:`ParsedNote` dataclass containing
plain text, aliases, tags and custom fields defined inside ``npc`` code
blocks.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List
import re

import frontmatter
import mini_yaml as yaml


class NoteParseError(Exception):
    """Raised when a note cannot be parsed."""


@dataclass
class ParsedNote:
    """Result of :func:`parse_note`.

    Attributes
    ----------
    text:
        Note body with frontmatter and ``npc`` blocks removed.
    aliases:
        Aliases from the frontmatter. Always a list.
    tags:
        Tags from the frontmatter. Always a list.
    fields:
        Custom fields collected from ``npc`` blocks.
    """

    text: str
    aliases: List[str]
    tags: List[str]
    fields: Dict[str, Any]


# Regex to capture fenced npc blocks.  The pattern allows blocks at the start of
# the file and consumes a preceding newline when present so that removing the
# block does not leave blank lines behind.
_NPC_BLOCK_RE = re.compile(r"(?:^|\n)```npc\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _parse_frontmatter(path: Path) -> frontmatter.Post:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return frontmatter.load(fh)
    except UnicodeDecodeError as exc:  # non UTF-8 file
        raise NoteParseError(f"{path} is not UTF-8 encoded") from exc
    except yaml.YAMLError as exc:  # malformed YAML frontmatter
        raise NoteParseError(f"Malformed frontmatter in {path}") from exc


def parse_note(path: Path) -> ParsedNote:
    """Parse ``path`` into a :class:`ParsedNote`.

    Parameters
    ----------
    path:
        Location of the Markdown note to parse.
    """

    post = _parse_frontmatter(path)
    text = post.content or ""
    metadata = post.metadata or {}

    aliases = metadata.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [aliases]
    elif not isinstance(aliases, list):
        aliases = []

    tags = metadata.get("tags", [])
    if isinstance(tags, str):
        tags = [t for t in re.split(r"[ ,]+", tags) if t]
    elif not isinstance(tags, list):
        tags = []

    fields: Dict[str, Any] = {}
    for block in _NPC_BLOCK_RE.findall(text):
        try:
            data = yaml.safe_load(block) or {}
        except yaml.YAMLError as exc:
            raise NoteParseError(f"Malformed npc block in {path}") from exc
        if isinstance(data, dict):
            fields.update(data)
    # Remove npc blocks from body text
    clean_text = _NPC_BLOCK_RE.sub("", text).strip()

    return ParsedNote(text=clean_text, aliases=aliases, tags=tags, fields=fields)
