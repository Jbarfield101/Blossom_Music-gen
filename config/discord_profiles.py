from __future__ import annotations

"""Manage Discord guild/channel specific profiles.

Profiles are stored in ``data/discord_profiles.json`` using the structure::

    {
        "<guild_id>": {
            "<channel_id>": {
                "voice": "narrator",
                "hotword": "hey bot",
                "models": {"whisper": "base"}
            }
        }
    }

The module exposes simple CRUD helpers to access and modify these
profiles.  All identifiers are coerced to strings in the JSON mapping
but callers may pass integers.
"""

from pathlib import Path
import json
from typing import Any, Dict

__all__ = [
    "get_profile",
    "set_profile",
    "delete_profile",
    "list_profiles",
]

# Path to the JSON file storing profile information.
PROFILES_FILE = Path(__file__).resolve().parents[1] / "data" / "discord_profiles.json"


def _load() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Load all profiles from :data:`PROFILES_FILE`."""
    if PROFILES_FILE.exists():
        try:
            return json.loads(PROFILES_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save(data: Dict[str, Dict[str, Dict[str, Any]]]) -> None:
    """Persist ``data`` to :data:`PROFILES_FILE`."""
    PROFILES_FILE.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")


def get_profile(guild_id: int | str, channel_id: int | str) -> Dict[str, Any]:
    """Return the profile for ``guild_id`` and ``channel_id``.

    Missing entries return an empty mapping.
    """
    data = _load()
    guild = data.get(str(guild_id), {})
    return guild.get(str(channel_id), {}).copy()


def set_profile(
    guild_id: int | str,
    channel_id: int | str,
    profile: Dict[str, Any],
) -> Dict[str, Any]:
    """Insert or replace a profile for ``guild_id``/``channel_id``.

    Returns the stored profile.
    """
    data = _load()
    guild = data.setdefault(str(guild_id), {})
    guild[str(channel_id)] = profile
    _save(data)
    return profile


def delete_profile(guild_id: int | str, channel_id: int | str) -> None:
    """Remove the profile for ``guild_id``/``channel_id`` if present."""
    data = _load()
    guild = data.get(str(guild_id))
    if guild and str(channel_id) in guild:
        del guild[str(channel_id)]
        if not guild:
            del data[str(guild_id)]
        _save(data)


def list_profiles() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Return all stored profiles."""
    return _load()
