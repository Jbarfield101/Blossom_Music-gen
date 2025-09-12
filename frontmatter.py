from __future__ import annotations

"""Minimal frontmatter parser used for tests.

This provides a tiny subset of the :mod:`python-frontmatter` package.  It only
implements :func:`load` and the :class:`Post` dataclass, which are sufficient
for the unit tests in this repository.
"""

from dataclasses import dataclass
from typing import Any, Dict, IO
import yaml


@dataclass
class Post:
    content: str
    metadata: Dict[str, Any]


def load(fh: IO[str]) -> Post:
    text = fh.read()
    if text.startswith("---"):
        try:
            _, rest = text.split("---", 1)
            fm, body = rest.split("---", 1)
        except ValueError:
            # No closing fence; treat the entire file as content
            return Post(content=text, metadata={})
        metadata = yaml.safe_load(fm) or {}
        if body.startswith("\n"):
            body = body[1:]
        return Post(content=body, metadata=metadata)
    return Post(content=text, metadata={})
