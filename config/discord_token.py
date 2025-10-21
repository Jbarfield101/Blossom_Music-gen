from __future__ import annotations

"""Utilities for persisting the Discord bot token."""

from pathlib import Path
import json

__all__ = ["get_token", "set_token", "TOKEN_FILE"]

# Location where the Discord token will be stored.
TOKEN_FILE = Path(__file__).with_name("discord_token.txt")

# Shared secrets helpers.
from . import secrets as secrets_cfg

PROJECT_ROOT = secrets_cfg.PROJECT_ROOT
SECRETS_FILE_NAME = secrets_cfg.SECRETS_FILE_NAME
TAURI_IDENTIFIER = secrets_cfg.TAURI_IDENTIFIER

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

    for secrets_file in secrets_cfg.iter_candidate_files(project_root=PROJECT_ROOT):
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
