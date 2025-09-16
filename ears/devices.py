"""List audio input/output devices using sounddevice."""

from __future__ import annotations

from typing import Dict, List
import json

try:  # pragma: no cover - optional dependency
    import sounddevice as sd
except Exception:  # pragma: no cover - handled at runtime
    sd = None  # type: ignore[assignment]


def list_devices() -> Dict[str, List[Dict[str, object]]]:
    """Return available input and output audio devices.

    The result is a dictionary with ``"input"`` and ``"output"`` keys
    mapping to lists of ``{"id": int, "name": str}`` objects.
    """
    # If the optional dependency is not available, degrade gracefully by
    # returning empty device lists so the caller/UI can continue loading.
    if sd is None:
        return {"input": [], "output": []}

    devices = sd.query_devices()
    inputs: List[Dict[str, object]] = []
    outputs: List[Dict[str, object]] = []
    for idx, info in enumerate(devices):
        name = info.get("name", f"Device {idx}")
        if info.get("max_input_channels", 0) > 0:
            inputs.append({"id": idx, "name": name})
        if info.get("max_output_channels", 0) > 0:
            outputs.append({"id": idx, "name": name})
    return {"input": inputs, "output": outputs}


__all__ = ["list_devices"]


if __name__ == "__main__":
    print(json.dumps(list_devices()))
