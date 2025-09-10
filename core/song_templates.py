from __future__ import annotations

"""Helpers for loading song template data."""

from pathlib import Path
from typing import Any, Mapping
import json


def load_song_template(name_or_path: str | Path) -> Mapping[str, Any]:
    """Return SongSpec dictionary loaded from ``name_or_path``.

    ``name_or_path`` may be the name of a template JSON located in
    ``assets/presets`` (without extension) or a direct path to a JSON file.
    """
    p = Path(name_or_path)
    if not p.suffix:
        p = Path("assets/presets") / f"{p.name}.json"
    if not p.exists():
        raise FileNotFoundError(f"Unknown song template: {name_or_path}")
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)
