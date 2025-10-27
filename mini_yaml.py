from __future__ import annotations

"""Very small YAML subset parser used for tests.

This module implements only :func:`safe_load` and :class:`YAMLError` for a
minimal subset of YAML needed by the unit tests.  It supports dictionaries with
string keys and values that are either strings or lists of strings written in
``[a, b]`` form.  It is **not** a full YAML parser.
"""

from typing import Any, Dict, List, Optional


class YAMLError(Exception):
    pass


def _strip_inline_comment(value: str) -> str:
    if "#" not in value:
        return value.strip()
    hash_index = value.find("#")
    if hash_index == 0:
        return ""
    return value[:hash_index].rstrip()


def safe_load(text: str) -> Dict[str, Any]:
    """Parse a tiny YAML subset supporting scalars and string lists."""

    result: Dict[str, Any] = {}
    pending_key: Optional[str] = None
    pending_list: Optional[List[str]] = None

    def finalize_pending() -> None:
        nonlocal pending_key, pending_list
        if pending_key is not None and pending_list is None:
            result[pending_key] = ""
        pending_key = None
        pending_list = None

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if pending_key is not None and stripped.startswith("-"):
            item = stripped[1:].strip()
            item = _strip_inline_comment(item)
            if pending_list is None:
                pending_list = []
                result[pending_key] = pending_list
            if item:
                pending_list.append(item)
            else:
                pending_list.append("")
            continue

        if ":" not in raw_line:
            raise YAMLError("Malformed line: missing ':'")

        if pending_key is not None:
            finalize_pending()

        key, value = raw_line.split(":", 1)
        key = key.strip()
        if not key:
            raise YAMLError("Empty key")

        value = _strip_inline_comment(value.strip())
        if not value:
            pending_key = key
            pending_list = None
            continue

        if value.startswith("["):
            if not value.endswith("]"):
                raise YAMLError("Unclosed list")
            items = [v.strip() for v in value[1:-1].split(",") if v.strip()]
            result[key] = items
            continue

        result[key] = value

    if pending_key is not None:
        finalize_pending()

    return result
