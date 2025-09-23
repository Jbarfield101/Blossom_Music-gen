from __future__ import annotations

"""Utilities for persisting the Discord bot token."""

from collections.abc import Iterable
import json
import os
from pathlib import Path
import sys

__all__ = ["get_token", "set_token", "TOKEN_FILE"]

# Location where the Discord token will be stored.
TOKEN_FILE = Path(__file__).with_name("discord_token.txt")

# Canonical ``secrets.json`` file name and Tauri identifier.
SECRETS_FILE_NAME = "secrets.json"
TAURI_IDENTIFIER = "com.blossom.musicgen"

# Repository root used for the project-level secrets file.
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Internal cached token value.
_TOKEN: str | None = None


def get_token() -> str | None:
    """Return the stored Discord token, if available."""

    global _TOKEN
    if _TOKEN is not None:
        return _TOKEN
    if TOKEN_FILE.exists():
        _TOKEN = TOKEN_FILE.read_text(encoding="utf-8").strip()
        return _TOKEN

    for secrets_file in _candidate_secrets_files():
        token = _read_token_from_secrets(secrets_file)
        if token is not None:
            _TOKEN = token
            return token

    return None


def set_token(token: str) -> str:
    """Persist ``token`` to :data:`TOKEN_FILE`.

    The token is treated as read-only once written. Subsequent attempts to
    modify it will raise a :class:`RuntimeError`.
    """

    token = token.strip()
    if TOKEN_FILE.exists():
        raise RuntimeError("Token already set")

    TOKEN_FILE.write_text(token)
    try:
        # Make the settings file read-only so it cannot be modified by the
        # running service.
        TOKEN_FILE.chmod(0o444)
    except Exception:
        # Permission change failures are non-fatal.
        pass

    global _TOKEN
    _TOKEN = token
    return token


def _candidate_secrets_files() -> Iterable[Path]:
    """Yield candidate ``secrets.json`` paths in priority order."""

    yield PROJECT_ROOT / SECRETS_FILE_NAME
    yield from _tauri_store_secret_files()


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
        data_home = os.environ.get("XDG_DATA_HOME")
        if data_home:
            candidates.append(Path(data_home) / identifier / store_name)
        config_home = os.environ.get("XDG_CONFIG_HOME")
        if config_home:
            candidates.append(Path(config_home) / identifier / store_name)
        home = Path.home()
        candidates.extend(
            [
                home / ".local" / "share" / identifier / store_name,
                home / ".config" / identifier / store_name,
            ]
        )

    seen: set[Path] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        yield path


def _read_token_from_secrets(path: Path) -> str | None:
    """Extract the Discord token from ``secrets.json`` if available."""

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
    discord_section = data.get("discord", {})
    if not isinstance(discord_section, dict):
        return None
    token = discord_section.get("botToken")
    if isinstance(token, str):
        token = token.strip()
        if token:
            return token
    return None
