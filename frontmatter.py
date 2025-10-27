from __future__ import annotations

"""Minimal frontmatter parser used for tests.

Implements a small subset of functionality with :func:`load` and the
:class:`Post` dataclass, which are sufficient for the unit tests in this
repository.
"""

from dataclasses import dataclass
from io import StringIO
from typing import Any, Dict, IO
import json

import mini_yaml as yaml


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


def loads(text: str) -> Post:
    """Parse a string containing frontmatter into a :class:`Post`."""

    return load(StringIO(text))


def _format_value(value: Any) -> str:
    if isinstance(value, (list, dict, bool, int, float)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def dumps(post: Post) -> str:
    """Serialise ``post`` back into a frontmatter string."""

    lines = ["---"]
    for key, value in post.metadata.items():
        lines.append(f"{key}: {_format_value(value)}")
    lines.append("---")
    body = "\n".join(lines)
    content = post.content or ""
    if content:
        if not content.startswith("\n"):
            body += "\n"
        body += content
        if not content.endswith("\n"):
            body += "\n"
    else:
        body += "\n"
    return body
