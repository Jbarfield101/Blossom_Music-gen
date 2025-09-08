# core/utils.py (helpers for Step 2; safe to append to your existing utils)
from __future__ import annotations
from pathlib import Path
import json
from typing import TypedDict

def read_json(path: str | Path):
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def write_json(path: str | Path, obj) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)

def ensure_file(path: str | Path, err: str = "File missing"):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{err}: {p}")

def density_bucket_from_float(x: float) -> str:
    """Map [0..1] -> 'sparse' | 'med' | 'busy'."""
    try:
        x = float(x)
    except Exception:
        x = 0.5
    if x <= 0.33:
        return "sparse"
    if x <= 0.66:
        return "med"
    return "busy"


# ---------------------------------------------------------------------------
# Musical helpers
# ---------------------------------------------------------------------------


class Event(TypedDict):
    """Canonical event description used by pattern generators."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


def bars_to_beats(n_bars: float, meter: str) -> float:
    """Convert ``n_bars`` to beats for ``meter`` (e.g., ``'4/4'``)."""

    beats_per_bar = int(meter.split("/", 1)[0])
    return n_bars * beats_per_bar


def beats_to_bars(n_beats: float, meter: str) -> float:
    """Convert ``n_beats`` to bars for ``meter`` (e.g., ``'4/4'``)."""

    beats_per_bar = int(meter.split("/", 1)[0])
    if beats_per_bar == 0:
        raise ValueError("Invalid meter string")
    return n_beats / beats_per_bar

