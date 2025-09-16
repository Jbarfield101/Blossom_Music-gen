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


def select_vault(root: Path | str) -> Path:
    """Persist or update the Obsidian vault path and (re)start the watcher.

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
        No longer raised for re-selection. Previous behavior disallowed
        changing the vault once set; now this function updates the stored
        path and restarts the watcher as needed.
    """

    # Accept either Path or string inputs from the Tauri bridge
    root_path = root if isinstance(root, Path) else Path(root)
    resolved = root_path.expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Vault path {resolved} does not exist")

    existing = get_vault()
    # Persist new path (or overwrite if changed)
    if VAULT_FILE.exists():
        try:
            VAULT_FILE.chmod(0o666)
        except Exception:
            pass
    VAULT_FILE.write_text(str(resolved))
    try:
        # Permissions best-effort; not strictly required for correctness
        VAULT_FILE.chmod(0o444)
    except Exception:
        pass

    global _VAULT_PATH
    _VAULT_PATH = resolved

    # (Re)start background watcher for note changes. Any failure to manage
    # the watcher should not block vault selection.
    try:
        from notes.watchdog import start_watchdog, stop_watchdog

        # If an old watcher is running for a different vault, stop it first.
        if existing is not None and existing.resolve() != resolved:
            try:
                stop_watchdog()
            except Exception:
                pass
        start_watchdog(resolved)
    except Exception:
        pass
    return resolved
