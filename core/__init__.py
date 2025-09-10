# core/__init__.py
from .song_spec import SongSpec, Section
from .theory import generate_satb, parse_chord_symbol  # if you want to expose it
from .pattern_synth import build_patterns_for_song
from .stems import (
    Note,
    Stem,
    Stems,
    bars_to_beats,
    beats_to_secs,
    enforce_register,
    dedupe_collisions,
    build_stems_for_song,
)
from .arranger import arrange_song
from .dynamics import apply as apply_dynamics

__all__ = [
    "SongSpec", "Section",
    "generate_satb", "parse_chord_symbol",
    "build_patterns_for_song", "build_stems_for_song", "arrange_song", "apply_dynamics",
    "Note", "Stem", "Stems",
    "bars_to_beats", "beats_to_secs",
    "enforce_register", "dedupe_collisions",
]
