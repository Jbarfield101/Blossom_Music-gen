"""Performance dynamic processing utilities."""

from __future__ import annotations

from typing import Dict, List, Mapping
import random

from .song_spec import SongSpec
from .stems import Stem, bars_to_beats, beats_to_secs

# Section velocity adjustments in dB
_SECTION_VEL_DB: Dict[str, float] = {
    "verse": -6.0,
    "chorus": 3.0,
}

# Micro-timing jitter per instrument in seconds
_INST_JITTER: Dict[str, float] = {
    "drums": 0.004,
    "bass": 0.006,
    "keys": 0.008,
    "pads": 0.010,
}


def _section_index(spec: SongSpec, bar: int) -> int | None:
    """Return the index of ``spec.sections`` containing ``bar``."""
    cursor = 0
    for idx, sec in enumerate(spec.sections):
        if cursor <= bar < cursor + sec.length:
            return idx
        cursor += sec.length
    return None


def _db_to_mul(db: float) -> float:
    """Convert ``db`` value to a linear multiplier."""
    return 10 ** (db / 20.0)


def apply(spec: SongSpec, stems: Mapping[str, List[Stem]], seed: int) -> Dict[str, List[Stem]]:
    """Apply velocity curves, micro-timing jitter and drum embellishments.

    Parameters
    ----------
    spec:
        Song specification with section information.
    stems:
        Mapping of instrument name to note events.
    seed:
        Seed used to initialise random generators.

    Returns
    -------
    Dict[str, List[Stem]]
        Processed copy of ``stems``.
    """

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_beat = beats_to_secs(spec.tempo)
    sec_per_bar = beats_per_bar * sec_per_beat

    out: Dict[str, List[Stem]] = {}

    for inst, notes in stems.items():
        rng = random.Random(f"{seed}-{inst}")
        jitter = _INST_JITTER.get(inst, 0.0)
        processed: List[Stem] = []
        for n in notes:
            start = n.start
            dur = n.dur
            vel = n.vel

            # Section-level velocity curve
            bar_idx = int(start // sec_per_bar)
            sec_idx = _section_index(spec, bar_idx)
            if sec_idx is not None:
                sec_name = spec.sections[sec_idx].name.lower()
                mult = _db_to_mul(_SECTION_VEL_DB.get(sec_name, 0.0))
                vel = int(round(max(1, min(127, vel * mult))))

            # Micro timing jitter
            if jitter:
                start += rng.uniform(-jitter, jitter)

            # Drum note length shaping
            if inst == "drums":
                dur = max(0.03, dur * 0.5)

            processed.append(Stem(start=start, dur=dur, pitch=n.pitch, vel=vel, chan=n.chan))

            # Drum ghost-note generation (snare)
            if inst == "drums" and n.pitch == 38:
                ghost_start = n.start - 0.05
                if ghost_start > 0:
                    ghost = Stem(
                        start=ghost_start + rng.uniform(-jitter, jitter),
                        dur=max(0.02, dur * 0.5),
                        pitch=38,
                        vel=max(1, int(vel * 0.4)),
                        chan=n.chan,
                    )
                    processed.append(ghost)

        processed.sort(key=lambda s: s.start)
        out[inst] = processed

    return out
