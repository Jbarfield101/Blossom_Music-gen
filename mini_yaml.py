from __future__ import annotations

"""Very small YAML subset parser used for tests.

This module implements only :func:`safe_load` and :class:`YAMLError` for a
minimal subset of YAML needed by the unit tests.  It supports dictionaries with
string keys and values that are either strings or lists of strings written in
``[a, b]`` form.  It is **not** a full YAML parser.
"""

from typing import Any, Dict


class YAMLError(Exception):
    pass


def safe_load(text: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise YAMLError("Malformed line: missing ':'")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise YAMLError("Empty key")
        if "#" in value:
            hash_index = value.find("#")
            if hash_index == 0:
                value = ""
            else:
                value = value[:hash_index].rstrip()
        if value.startswith("["):
            if not value.endswith("]"):
                raise YAMLError("Unclosed list")
            items = [v.strip() for v in value[1:-1].split(",") if v.strip()]
            result[key] = items
        elif not value:
            result[key] = ""
        else:
            result[key] = value
    return result
