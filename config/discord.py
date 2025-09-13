from __future__ import annotations

"""Load and cache Discord command permission rules."""

from pathlib import Path
from typing import Dict, List

__all__ = ["get_permission_rules"]

# Location of the permission configuration file.
PERMISSIONS_FILE = Path(__file__).with_name("discord.yaml")

# Internal cache of loaded permission rules.
_RULE_CACHE: Dict[str, Dict[str, List[int]]] | None = None


def _parse_list(value: str) -> List[int]:
    """Parse a ``[1, 2, 3]`` style list into integers."""
    if not value.startswith("[") or not value.endswith("]"):
        raise ValueError("Expected list in square brackets")
    items = [v.strip() for v in value[1:-1].split(",") if v.strip()]
    return [int(v) for v in items]


def _load_file() -> Dict[str, Dict[str, List[int]]]:
    text = PERMISSIONS_FILE.read_text(encoding="utf-8")
    result: Dict[str, Dict[str, List[int]]] = {}
    current: Dict[str, List[int]] | None = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" ") and line.endswith(":"):
            key = line[:-1].strip()
            current = result.setdefault(key, {"channels": [], "roles": []})
        elif line.startswith(" ") and current is not None:
            stripped = line.strip()
            if ":" not in stripped:
                raise ValueError(f"Malformed line: {line}")
            subkey, value = [s.strip() for s in stripped.split(":", 1)]
            if subkey not in ("channels", "roles"):
                raise ValueError(f"Unknown key '{subkey}' in permissions file")
            current[subkey] = _parse_list(value)
        else:
            raise ValueError(f"Malformed line: {line}")
    return result


def get_permission_rules() -> Dict[str, Dict[str, List[int]]]:
    """Return cached command permission rules."""
    global _RULE_CACHE
    if _RULE_CACHE is None:
        if PERMISSIONS_FILE.exists():
            _RULE_CACHE = _load_file()
        else:
            _RULE_CACHE = {}
    return _RULE_CACHE
