from __future__ import annotations

"""Utilities for selecting an Obsidian vault.

This module exposes :func:`select_vault` which stores the path to an
Obsidian vault in a small settings file.  The stored path is treated as
read-only once written.  Subsequent attempts to change the path will
raise a :class:`RuntimeError`.
"""

from pathlib import Path

__all__ = ["select_vault", "get_vault", "VAULT_FILE"]

# Location where the selected vault path will be persisted.
VAULT_FILE = Path(__file__).with_name("obsidian_vault.txt")

# Internal cached vault path.  This should be treated as read-only.
_VAULT_PATH: Path | None = None


def get_vault() -> Path | None:
    """Return the currently selected vault path, if any."""

    global _VAULT_PATH
    if _VAULT_PATH is not None:
        return _VAULT_PATH
    if VAULT_FILE.exists():
        _VAULT_PATH = Path(VAULT_FILE.read_text().strip())
    return _VAULT_PATH


def select_vault(root: Path) -> Path:
    """Persist the Obsidian vault path in a read-only settings file.

    Parameters
    ----------
    root:
        Directory containing the Obsidian vault.

    Returns
    -------
    Path
        The resolved vault path.

    Raises
    ------
    FileNotFoundError
        If ``root`` does not exist.
    RuntimeError
        If a vault has already been selected.
    """

    resolved = root.expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Vault path {resolved} does not exist")

    existing = get_vault()
    if existing is not None:
        raise RuntimeError(f"Vault already selected: {existing}")

    VAULT_FILE.write_text(str(resolved))
    try:
        # Make the settings file read-only so that it cannot be modified
        # by the running service.
        VAULT_FILE.chmod(0o444)
    except Exception:
        # If changing permissions fails we still continue – the runtime
        # checks above will prevent further writes.
        pass

    global _VAULT_PATH
    _VAULT_PATH = resolved
    # Start background watcher for note changes. Any failure to start the
    # watcher should not prevent the vault from being set, hence the
    # broad ``try`` block.
    try:
        from notes.watchdog import start_watchdog

        start_watchdog(resolved)
    except Exception:
        pass
    return resolved
