from __future__ import annotations

"""Access the campaign lore root used for DreadHaven content.

The repository previously allowed picking an arbitrary Obsidian vault. All lore
features now assume the hard-coded DreadHaven directory that ships with the
project. The helper below simply returns that path and ensures it exists on the
filesystem.
"""

from pathlib import Path

from brain.constants import DEFAULT_DREADHAVEN_ROOT

__all__ = ["get_vault", "select_vault"]


def get_vault() -> Path:
    """Return the DreadHaven lore directory, creating it if necessary."""

    DEFAULT_DREADHAVEN_ROOT.mkdir(parents=True, exist_ok=True)
    return DEFAULT_DREADHAVEN_ROOT


def select_vault(_root: Path | str) -> Path:
    """Deprecated shim kept for backwards compatibility.

    Manual vault selection is no longer supported. The hard-coded DreadHaven
    folder is always used instead.
    """

    raise RuntimeError(
        "Manual Obsidian vault selection has been removed. "
        "DreadHaven content is now loaded from the default folder at "
        f"{DEFAULT_DREADHAVEN_ROOT}"
    )
