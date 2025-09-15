from __future__ import annotations

"""Utilities for persisting the Discord bot token."""

from pathlib import Path

__all__ = ["get_token", "set_token", "TOKEN_FILE"]

# Location where the Discord token will be stored.
TOKEN_FILE = Path(__file__).with_name("discord_token.txt")

# Internal cached token value.
_TOKEN: str | None = None


def get_token() -> str | None:
    """Return the stored Discord token, if available."""

    global _TOKEN
    if _TOKEN is not None:
        return _TOKEN
    if TOKEN_FILE.exists():
        _TOKEN = TOKEN_FILE.read_text().strip()
    return _TOKEN


def set_token(token: str) -> str:
    """Persist ``token`` to :data:`TOKEN_FILE`.

    The token is treated as read-only once written. Subsequent attempts to
    modify it will raise a :class:`RuntimeError`.
    """

    token = token.strip()
    existing = get_token()
    if existing is not None:
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
