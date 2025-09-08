# core/utils.py (helpers for Step 2; safe to append to your existing utils)
from __future__ import annotations
from pathlib import Path
import json

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
