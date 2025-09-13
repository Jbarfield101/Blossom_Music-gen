"""Audio device utilities using sounddevice.

Provides helpers to list available input and output devices and to
retrieve the currently selected device IDs from the Tauri settings
store.  The store file is expected to be named ``settings.dat`` and live
in the current working directory.  When sounddevice is unavailable the
module falls back to returning empty information.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Dict, Optional, Tuple
import json

try:  # pragma: no cover - optional dependency
    import sounddevice as sd  # type: ignore
except Exception:  # pragma: no cover - exercised when sounddevice missing
    sd = None  # type: ignore

STORE_FILE = Path("settings.dat")
INPUT_KEY = "input_device_id"
OUTPUT_KEY = "output_device_id"


def list_devices() -> List[Dict[str, object]]:
    """Return a simplified list of available audio devices.

    Each entry contains the device ``id`` along with its ``name`` and the
    maximum number of input/output channels.  When ``sounddevice`` is not
    installed an empty list is returned instead.
    """
    if sd is None:  # pragma: no cover - exercised when sounddevice missing
        return []
    devices = sd.query_devices()
    result = []
    for idx, dev in enumerate(devices):
        result.append(
            {
                "id": idx,
                "name": dev.get("name", f"Device {idx}"),
                "max_input_channels": dev.get("max_input_channels", 0),
                "max_output_channels": dev.get("max_output_channels", 0),
            }
        )
    return result


def get_device_ids(path: Path = STORE_FILE) -> Tuple[Optional[int], Optional[int]]:
    """Return ``(input_id, output_id)`` from the settings store.

    The store is expected to contain JSON data.  Missing files or keys
    result in ``(None, None)``.
    """
    try:
        data = json.loads(path.read_text())
    except Exception:  # pragma: no cover - file missing or invalid
        return None, None
    return data.get(INPUT_KEY), data.get(OUTPUT_KEY)


if __name__ == "__main__":  # pragma: no cover - manual utility
    import sys

    json.dump(list_devices(), sys.stdout)
