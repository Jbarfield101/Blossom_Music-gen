"""Manage wake-word (hotword) configurations.

This module provides helper functions to list available hotword models
and enable/disable them.  Custom models are loaded from the
``ears/hotwords`` directory.  State is persisted in a small JSON file so
that the front‑end and other services can query and mutate the
configuration via the command interface.
"""
from __future__ import annotations

from pathlib import Path
import json
from typing import Dict

# Directory where custom hotword models are stored.  Users may drop model
# files (for example ``.tflite`` or ``.ppn``) in here and they will be
# discovered automatically.
HOTWORD_DIR = Path(__file__).with_name("hotwords")
# Configuration file tracking the enabled/disabled state for each model.
CONFIG_FILE = HOTWORD_DIR / "hotwords.json"


def _load_config() -> Dict[str, bool]:
    """Return the persisted hotword configuration."""
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text("utf-8"))
            if isinstance(data, dict):
                # ensure bool values
                return {str(k): bool(v) for k, v in data.items()}
        except Exception:
            pass
    return {}


def _save_config(cfg: Dict[str, bool]) -> None:
    HOTWORD_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def _discover_models(cfg: Dict[str, bool]) -> Dict[str, bool]:
    """Ensure configuration contains an entry for every model file."""
    if HOTWORD_DIR.exists():
        for path in HOTWORD_DIR.iterdir():
            if path.is_file() and path.name != CONFIG_FILE.name:
                cfg.setdefault(path.stem, False)
    return cfg


def list_hotwords() -> Dict[str, bool]:
    """Return a mapping of available hotword models to enabled state."""
    cfg = _discover_models(_load_config())
    _save_config(cfg)
    return cfg


def set_hotword(name: str, enabled: bool) -> Dict[str, bool]:
    """Enable or disable a specific hotword model.

    Parameters
    ----------
    name:
        Base name of the model file without extension.
    enabled:
        Whether the hotword should be active.

    The updated configuration mapping is returned.
    """
    cfg = _discover_models(_load_config())
    cfg[name] = bool(enabled)
    _save_config(cfg)
    return cfg


__all__ = ["list_hotwords", "set_hotword"]


if __name__ == "__main__":
    import sys

    if len(sys.argv) <= 1 or sys.argv[1] == "list":
        print(json.dumps(list_hotwords()))
    elif sys.argv[1] == "set" and len(sys.argv) >= 4:
        name = sys.argv[2]
        enabled = sys.argv[3].lower() in {"1", "true", "yes", "on"}
        print(json.dumps(set_hotword(name, enabled)))
    else:
        raise SystemExit("Usage: python -m ears.hotword [list|set <name> <enabled>]")
