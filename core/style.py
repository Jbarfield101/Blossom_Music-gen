from __future__ import annotations

"""Helpers for loading arrangement style data."""

from pathlib import Path
from typing import Any, Mapping, Union, Dict
from enum import IntEnum
import json


class StyleToken(IntEnum):
    """Enumeration of supported style tokens."""

    LOFI = 0
    ROCK = 1
    CINEMATIC = 2
    CHILL_LOFI_JAM = 3
    AMBIENT_DREAMSCAPE = 5


# Mapping of human readable style names to token IDs used by phrase models
STYLE_TOKENS = {
    name.lower(): token for name, token in StyleToken.__members__.items()
}

# Convenience count of available styles
NUM_STYLES = len(StyleToken)

# Backwards compatible constant aliases
STYLE_LOFI = StyleToken.LOFI
STYLE_ROCK = StyleToken.ROCK
STYLE_CINEMATIC = StyleToken.CINEMATIC


def style_to_token(name: Union[str, Path, None]) -> StyleToken | None:
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
    The loader performs light validation and normalisation of optional
    fields such as ``synth_defaults`` and ``drums.swing``.
    """
    p = Path(name_or_path)
    if not p.suffix:
        p = Path("assets/styles") / f"{p.name}.json"
    if not p.exists():
        raise FileNotFoundError(f"Unknown style specification: {name_or_path}")
    with p.open("r", encoding="utf-8") as fh:
        style: Dict[str, Any] = json.load(fh)

    # Normalise nested mappings -------------------------------------------------
    synth = style.get("synth_defaults", {}) or {}
    if synth:
        style["synth_defaults"] = {
            k: float(synth.get(k, 0.0))
            for k in ("lpf_cutoff", "chorus", "saturation")
            if k in synth
        }
    drums = style.get("drums", {}) or {}
    if drums:
        style["drums"] = {"swing": float(drums.get("swing", 0.0))}

    return style
