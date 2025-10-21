from __future__ import annotations

"""Shared helpers for locating and reading the ``secrets.json`` store."""

from collections.abc import Iterable
import json
import os
from pathlib import Path
import sys
from typing import Any

__all__ = [
    "SECRETS_FILE_NAME",
    "TAURI_IDENTIFIER",
    "PROJECT_ROOT",
    "iter_candidate_files",
    "load_secrets",
]

# Canonical ``secrets.json`` file name and Tauri identifier.
SECRETS_FILE_NAME = "secrets.json"
TAURI_IDENTIFIER = "com.blossom.musicgen"

# Repository root used for the project-level secrets file.
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def iter_candidate_files(
    platform: str | None = None,
    project_root: Path | None = None,
) -> Iterable[Path]:
    """Yield candidate paths where ``secrets.json`` might live."""

    root = project_root or PROJECT_ROOT
    yield root / SECRETS_FILE_NAME
    yield from _tauri_store_secret_files(platform=platform)


def load_secrets() -> dict[str, Any]:
    """Return the first successfully parsed secrets mapping, if any."""

    for path in iter_candidate_files():
        data = _read_json(path)
        if isinstance(data, dict):
            return data
    return {}


def _tauri_store_secret_files(platform: str | None = None) -> Iterable[Path]:
    """Return possible ``secrets.json`` locations for the Tauri store."""

    platform = platform or sys.platform
    store_name = SECRETS_FILE_NAME
    identifier = TAURI_IDENTIFIER
    candidates: list[Path] = []

    if platform.startswith("win"):
        for env_var in ("APPDATA", "LOCALAPPDATA"):
            base = os.environ.get(env_var)
            if base:
                candidates.append(Path(base) / identifier / store_name)
        home = Path.home()
        candidates.extend(
            [
                home / "AppData" / "Roaming" / identifier / store_name,
                home / "AppData" / "Local" / identifier / store_name,
            ]
        )
    elif platform == "darwin":
        candidates.append(
            Path.home()
            / "Library"
            / "Application Support"
            / identifier
            / store_name
        )
    else:
        home = Path.home()
        candidates.extend(
            [
                home / ".local" / "share" / identifier / store_name,
                home / ".config" / identifier / store_name,
            ]
        )

    data_home = os.environ.get("XDG_DATA_HOME")
    if data_home:
        candidates.append(Path(data_home) / identifier / store_name)
    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        candidates.append(Path(config_home) / identifier / store_name)

    seen: set[Path] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        yield path


def _read_json(path: Path) -> dict[str, Any] | None:
    """Safely read ``path`` as JSON, returning ``None`` on failure."""

    if not path.exists():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if isinstance(data, dict):
        return data
    return None
