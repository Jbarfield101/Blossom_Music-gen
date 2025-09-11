from __future__ import annotations

"""Helpers for loading arrangement style data."""

from pathlib import Path
from typing import Any, Mapping, Union
import json

# Mapping of human readable style names to token IDs used by phrase models
STYLE_TOKENS = {"lofi": 0, "rock": 1, "cinematic": 2}


def style_to_token(name: Union[str, Path, None]) -> int | None:
    """Return token ID for style ``name`` if known."""
    if not name:
        return None
    if isinstance(name, Path):
        name = name.stem
    return STYLE_TOKENS.get(str(name).lower())


def load_style(name_or_path: str | Path) -> Mapping[str, Any]:
    """Return style dictionary loaded from ``name_or_path``.

    ``name_or_path`` may be the name of a style JSON located in
    ``assets/styles`` (without extension) or a direct path to a JSON file.
    """
    p = Path(name_or_path)
    if not p.suffix:
        p = Path("assets/styles") / f"{p.name}.json"
    if not p.exists():
        raise FileNotFoundError(f"Unknown style specification: {name_or_path}")
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)
