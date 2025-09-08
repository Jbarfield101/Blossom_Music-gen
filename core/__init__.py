# core/__init__.py
from .song_spec import SongSpec, Section
from .theory import generate_satb, parse_chord_symbol  # if you want to expose it
from .pattern_synth import build_patterns_for_song

__all__ = [
    "SongSpec", "Section",
    "generate_satb", "parse_chord_symbol",
    "build_patterns_for_song",
]
