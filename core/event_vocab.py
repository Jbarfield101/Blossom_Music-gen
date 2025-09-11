"""Token vocabulary and encoding helpers for musical events."""

from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

from .stems import Stem, bars_to_beats

# Token type identifiers
BAR = 0
BEAT = 1
INST = 2
CHORD = 3
DENS = 4
NOTE_ON = 5
NOTE_OFF = 6
VEL = 7
DUR = 8
SECTION = 9
CADENCE = 10
METER = 11
SEED = 12
CADENCE_SOON = 13
FINAL = 14

# Simple vocabularies for section and chord names used in conditioning tokens.
SECTION_NAMES = ["A", "B", "C", "D", "E"]
SECTION_TO_ID = {name: idx for idx, name in enumerate(SECTION_NAMES)}
ID_TO_SECTION = {idx: name for name, idx in SECTION_TO_ID.items()}

CHORD_CLASSES = ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]
CHORD_TO_ID = {name: idx for idx, name in enumerate(CHORD_CLASSES)}
ID_TO_CHORD = {idx: name for name, idx in CHORD_TO_ID.items()}


def density_to_bucket(density: float, buckets: int = 10) -> int:
    """Convert a ``density`` value in ``[0, 1]`` to an integer bucket."""

    density = max(0.0, min(1.0, density))
    return int(round(density * (buckets - 1)))


def encode(
    notes: Sequence[Stem],
    *,
    section: str,
    meter: str,
    density: float,
    chord: str,
    seed: int,
    cadence: bool = False,
    cadence_soon: bool = False,
    final: bool = False,
) -> List[Tuple[int, int]]:
    """Encode ``notes`` into a sequence of ``(token, value)`` pairs.

    Parameters
    ----------
    notes:
        Iterable of :class:`~core.stems.Stem` events whose ``start`` and ``dur``
        fields are expressed in beats.
    section:
        Section type such as ``"A"`` or ``"B"``.
    meter:
        Meter string like ``"4/4"``.
    density:
        Density value in ``[0, 1]`` used to compute a bucket.
    chord:
        Chord class such as ``"C"``.
    seed:
        Arbitrary seed value hashed into the token sequence.
    cadence:
        Optional cadence flag stored as a token.
    cadence_soon:
        Optional flag signaling a cadence is approaching.
    final:
        Optional flag indicating the final section.
    """

    beats_per_bar = bars_to_beats(meter)
    tokens: List[Tuple[int, int]] = []

    # Conditioning tokens
    tokens.append((SECTION, SECTION_TO_ID.get(section, 0)))
    tokens.append((METER, beats_per_bar))
    tokens.append((DENS, density_to_bucket(density)))
    tokens.append((CHORD, CHORD_TO_ID.get(chord, 0)))
    tokens.append((SEED, seed & 0xFFFF))
    tokens.append((CADENCE, 1 if cadence else 0))
    tokens.append((CADENCE_SOON, 1 if cadence_soon else 0))
    tokens.append((FINAL, 1 if final else 0))

    # Event tokens
    for n in sorted(notes, key=lambda x: x.start):
        bar = int(n.start // beats_per_bar)
        beat = int(n.start % beats_per_bar)
        dur = int(round(n.dur))
        tokens.extend(
            [
                (BAR, bar),
                (BEAT, beat),
                (INST, n.chan),
                (NOTE_ON, n.pitch),
                (VEL, n.vel),
                (DUR, dur),
                (NOTE_OFF, n.pitch),
            ]
        )

    return tokens


def decode(tokens: Sequence[Tuple[int, int]]) -> Tuple[List[Stem], Dict[str, int]]:
    """Decode a token ``sequence`` back into notes and conditioning metadata."""

    it = iter(tokens)

    def _next(expected: int | None = None) -> Tuple[int, int]:
        tok, val = next(it)
        if expected is not None and tok != expected:
            raise ValueError(f"Expected token {expected} but got {tok}")
        return tok, val

    meta: Dict[str, int] = {}
    _, section_id = _next(SECTION)
    meta["section"] = section_id
    _, beats_per_bar = _next(METER)
    meta["meter_beats"] = beats_per_bar
    _, density_bucket = _next(DENS)
    meta["density_bucket"] = density_bucket
    _, chord_id = _next(CHORD)
    meta["chord"] = chord_id
    _, seed_hash = _next(SEED)
    meta["seed"] = seed_hash
    _, cadence_flag = _next(CADENCE)
    meta["cadence"] = cadence_flag
    _, cadence_soon_flag = _next(CADENCE_SOON)
    meta["cadence_soon"] = cadence_soon_flag
    _, final_flag = _next(FINAL)
    meta["final"] = final_flag

    notes: List[Stem] = []
    while True:
        try:
            _, bar = _next(BAR)
        except StopIteration:
            break
        _, beat = _next(BEAT)
        _, inst = _next(INST)
        _, pitch = _next(NOTE_ON)
        _, vel = _next(VEL)
        _, dur = _next(DUR)
        _, off_pitch = _next(NOTE_OFF)
        if off_pitch != pitch:
            raise ValueError("NOTE_OFF pitch does not match NOTE_ON pitch")
        start = bar * beats_per_bar + beat
        notes.append(Stem(start=float(start), dur=float(dur), pitch=pitch, vel=vel, chan=inst))

    return notes, meta
