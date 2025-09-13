from __future__ import annotations

"""Manage hotword models and configuration.

This module maintains a mapping of available hotword detector models and
whether they are currently enabled.  Hotword models are simple files placed
inside a configurable directory (``BLOSSOM_HOTWORD_DIR`` environment variable
or ``ears/hotwords`` relative to this module).  The enabled/disabled state is
stored in a JSON configuration file (``BLOSSOM_HOTWORD_CONFIG`` or
``hotwords.json`` inside the hotword directory).

The public API provides two helper functions:

``list_hotwords()``
    Return a mapping of hotword names to booleans indicating whether each is
    enabled.  Any model file present in the directory but missing from the
    configuration is automatically added as disabled.
``set_hotword(name, enabled)``
    Update the enabled state of a given hotword and persist the change.

The module is intentionally lightweight; loading of the actual model files is
left to the caller.
"""

import json
import os
from pathlib import Path
from typing import Dict

__all__ = ["list_hotwords", "set_hotword"]

# Directory containing hotword model files.  This can be overridden via the
# ``BLOSSOM_HOTWORD_DIR`` environment variable to point to a user-writable
# location when running within a packaged application.
MODELS_DIR = Path(
    os.environ.get("BLOSSOM_HOTWORD_DIR", Path(__file__).with_name("hotwords"))
)

# Configuration file storing the enabled state for each hotword.  Defaults to a
# ``hotwords.json`` file inside ``MODELS_DIR`` but can be overridden with
# ``BLOSSOM_HOTWORD_CONFIG``.
CONFIG_FILE = Path(
    os.environ.get("BLOSSOM_HOTWORD_CONFIG", MODELS_DIR / "hotwords.json")
)


def _load_config() -> Dict[str, bool]:
    """Load the hotword configuration from ``CONFIG_FILE``."""
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {str(k): bool(v) for k, v in data.items()}
        except Exception:
            pass
    return {}


def _save_config(cfg: Dict[str, bool]) -> None:
    """Persist configuration to ``CONFIG_FILE``."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def list_hotwords() -> Dict[str, bool]:
    """Return mapping of available hotword models to their enabled state."""
    cfg = _load_config()

    # Discover model files in the models directory.  Any file with a typical
    # model extension is treated as a hotword model; the stem becomes the
    # hotword name.
    if MODELS_DIR.exists():
        for path in MODELS_DIR.iterdir():
            if path.is_file() and path.suffix.lower() in {".tflite", ".onnx", ".pt"}:
                cfg.setdefault(path.stem, False)

    _save_config(cfg)
    return cfg


def set_hotword(name: str, enabled: bool) -> Dict[str, bool]:
    """Enable or disable ``name`` and return the updated configuration."""
    cfg = list_hotwords()
    if name not in cfg:
        raise KeyError(f"Unknown hotword: {name}")
    cfg[name] = bool(enabled)
    _save_config(cfg)
    return cfg


if __name__ == "__main__":  # pragma: no cover - simple CLI wrapper
    import sys

    if len(sys.argv) == 1:
        print(json.dumps(list_hotwords()))
    elif len(sys.argv) == 3:
        name = sys.argv[1]
        state = sys.argv[2].lower() in {"1", "true", "yes", "on"}
        try:
            print(json.dumps(set_hotword(name, state)))
        except KeyError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
    else:
        print("Usage: python -m ears.hotword [name] [true|false]", file=sys.stderr)
        sys.exit(1)
