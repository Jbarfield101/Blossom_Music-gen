"""Basic musical stem structures and conversion helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List
import random


@dataclass
class Note:
    """Single note event."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


@dataclass
class Stem:
    """A note container; currently identical to :class:`Note`."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


@dataclass
class Stems:
    """Placeholder for collections of notes; same fields as :class:`Note`."""

    start: float
    dur: float
    pitch: int
    vel: int
    chan: int


def bars_to_beats(meter: str) -> int:
    """Return the number of beats contained in one bar of ``meter``.

    ``meter`` should be a string of the form ``"N/D"`` such as ``"4/4"`` or
    ``"6/8"``. Only the numerator (``N``) is needed to compute beats per bar.
    """

    try:
        num_str, _ = meter.split("/", 1)
        return int(num_str)
    except Exception as e:  # pragma: no cover - defensive
        raise ValueError(f"Invalid meter string: {meter!r}") from e


def beats_to_secs(tempo: float) -> float:
    """Return seconds per beat for a given ``tempo`` in BPM."""

    if tempo <= 0:
        raise ValueError("tempo must be positive")
    return 60.0 / tempo


def _steps_per_beat(meter: str, subdivision: int = 16) -> int:
    """Return how many rhythmic ``subdivision`` steps form a beat.

    The helper mirrors the logic used in :mod:`core.pattern_synth` where a
    16th‑note grid is assumed.  ``meter`` must be in ``"N/D"`` form.
    """

    try:
        _, den_str = meter.split("/", 1)
        den = int(den_str)
        if den <= 0 or subdivision % den:
            raise ValueError
        return subdivision // den
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError(f"Invalid meter string: {meter!r}") from exc


def _humanize(val: float, spread: float, rng: random.Random) -> float:
    """Return ``val`` randomly offset by ``±spread``."""

    return val + rng.uniform(-spread, spread)


def render_drums(pattern: Dict[str, List[int]], meter: str, tempo: float, seed: int) -> List[Stem]:
    """Render a drum ``pattern`` into ``Stem`` note events.

    Parameters
    ----------
    pattern:
        Mapping containing ``"kick"``, ``"snare"`` and ``"hat"`` grids.  Each
        grid is a sequence of hits (``0`` for rests, ``1`` for hits, ``2`` for
        ghost snares).  Optionally a ``"density"`` float in ``[0, 1]`` may be
        present to scale velocities.
    meter:
        Meter string like ``"4/4"`` describing the rhythmic grid.
    tempo:
        Tempo in BPM used to convert beats to seconds.
    seed:
        Seed for the random humanisation.

    Returns
    -------
    List[Stem]
        A list of note events with simple humanisation applied.
    """

    density = float(pattern.get("density", 1.0))
    steps = len(pattern.get("kick", []))
    if steps == 0:
        return []

    spb = _steps_per_beat(meter)
    sec_per_beat = beats_to_secs(tempo)
    sec_per_step = sec_per_beat / spb

    rng = random.Random(seed)

    notes: List[Stem] = []

    def _add_note(start_idx: int, pitch: int, base_vel: int) -> None:
        start = start_idx * sec_per_step
        start = _humanize(start, 0.006, rng)
        vel = int(round(base_vel * density))
        vel = int(round(_humanize(vel, 6, rng)))
        vel = max(1, min(127, vel))
        notes.append(Stem(start=start, dur=sec_per_step, pitch=pitch, vel=vel, chan=9))

    for idx, hit in enumerate(pattern.get("kick", [])):
        if hit:
            _add_note(idx, 36, 96)

    for idx, hit in enumerate(pattern.get("snare", [])):
        if not hit:
            continue
        base = 60 if hit == 2 else 100
        _add_note(idx, 38, base)

    for idx, hit in enumerate(pattern.get("hat", [])):
        if hit:
            _add_note(idx, 42, 70)

    notes.sort(key=lambda n: n.start)
    return notes


def render_pads(
    pattern: Dict[str, List[int]],
    voiced_chords: List[List[int]],
    register: Dict[str, List[int]],
    meter: str,
    tempo: float,
    seed: int,
) -> List[Stem]:
    """Render sustained pad chords into :class:`Stem` events.

    Parameters
    ----------
    pattern:
        Mapping that may optionally contain a ``"density"`` float in ``[0, 1]``
        controlling textural thickness.
    voiced_chords:
        List of SATB style chord voicings aligned by bar.  Consecutive
        identical voicings are merged into a single multi-bar note event.
    register:
        Register policy from which the ``"pads"`` range is used to fold pitches
        into the allowed span.
    meter:
        Meter string like ``"4/4"`` describing the rhythmic grid.
    tempo:
        Tempo in BPM used to convert beats to seconds.
    seed:
        Random seed controlling subtle humanisation.

    Returns
    -------
    List[Stem]
        Rendered pad note events.
    """

    if not voiced_chords:
        return []

    beats_per_bar = bars_to_beats(meter)
    sec_per_beat = beats_to_secs(tempo)

    rng = random.Random(seed)
    density = float(pattern.get("density", 1.0))

    low, high = (register or {}).get("pads", (0, 127))

    notes: List[Stem] = []

    start_bar = 0
    prev_chord = voiced_chords[0]

    def _emit_group(start_bar: int, end_bar: int, chord: List[int]) -> None:
        dur_beats = (end_bar - start_bar) * beats_per_bar
        start = start_bar * beats_per_bar * sec_per_beat
        chord_notes = list(chord)
        if density < 0.4 and len(chord_notes) > 2:
            chord_notes = [chord_notes[0], chord_notes[-1]]
        for p in chord_notes:
            pitch = _fold_pitch_to_register(p, low, high)
            s = _humanize(start, 0.01, rng)
            vel = int(_humanize(48, 3, rng))
            vel = max(1, min(127, vel))
            notes.append(
                Stem(
                    start=s,
                    dur=dur_beats * sec_per_beat,
                    pitch=pitch,
                    vel=vel,
                    chan=2,
                )
            )

    for bar_idx in range(1, len(voiced_chords) + 1):
        chord = voiced_chords[bar_idx] if bar_idx < len(voiced_chords) else None
        if chord != prev_chord:
            _emit_group(start_bar, bar_idx, prev_chord)
            start_bar = bar_idx
            prev_chord = chord

    notes.sort(key=lambda n: n.start)
    return notes


def _fold_pitch_to_register(pitch: int, low: int, high: int) -> int:
    """Fold ``pitch`` into the inclusive ``[low, high]`` MIDI register.

    The function shifts ``pitch`` by octaves until it falls within the range
    and clamps the result as a last resort.  This mirrors the clamping strategy
    used in other modules but is kept local to avoid a heavier dependency.
    """

    while pitch < low:
        pitch += 12
    while pitch > high:
        pitch -= 12
    if pitch < low:
        pitch = low
    if pitch > high:
        pitch = high
    return pitch


def render_bass(
    pattern: List[int],
    voiced_chords: List[List[int]],
    register: Dict[str, List[int]],
    meter: str,
    tempo: float,
    seed: int,
) -> List[Stem]:
    """Render a bass line ``pattern`` into :class:`Stem` note events.

    Parameters
    ----------
    pattern:
        Sequence of hits on a 16th‑note grid.  Non‑zero entries denote note
        onsets.
    voiced_chords:
        List of chord tone lists aligned by bar with ``pattern``.  For each
        onset the nearest chord tone (or its chromatic approach notes) is
        selected.
    register:
        Register policy dictionary from which ``"bass"`` is used to fold pitches
        into an allowed range.
    meter:
        Meter string like ``"4/4"`` describing the rhythmic grid.
    tempo:
        Tempo in BPM used to convert beats to seconds.
    seed:
        Random seed controlling subtle humanisation.

    Returns
    -------
    List[Stem]
        List of rendered bass notes.
    """

    steps = len(pattern)
    if steps == 0:
        return []

    beats_per_bar = bars_to_beats(meter)
    spb = _steps_per_beat(meter)
    steps_per_bar = beats_per_bar * spb

    sec_per_beat = beats_to_secs(tempo)
    sec_per_step = sec_per_beat / spb

    rng = random.Random(seed)

    low, high = (register or {}).get("bass", (0, 127))

    notes: List[Stem] = []
    prev_pitch: int | None = None

    for idx, hit in enumerate(pattern):
        if not hit:
            continue

        bar_idx = idx // steps_per_bar
        chord = voiced_chords[bar_idx] if bar_idx < len(voiced_chords) else []
        if not chord:
            continue

        # Candidate pitches: chord tones and chromatic neighbours
        base_cands = set(chord)
        for tone in chord:
            base_cands.add(tone + 1)
            base_cands.add(tone - 1)

        candidates: List[int] = []
        for t in base_cands:
            # consider octave shifts so the pitch falls into the register and
            # stays near the previous note
            for shift in range(-4, 5):
                p = t + 12 * shift
                if low <= p <= high:
                    candidates.append(p)
        if not candidates:
            candidates = [_fold_pitch_to_register(t, low, high) for t in base_cands]

        if prev_pitch is None:
            # Choose the candidate closest to the centre of the register for the
            # first note to keep things predictable.
            centre = (low + high) // 2
            pitch = min(candidates, key=lambda p: abs(p - centre))
        else:
            pitch = min(candidates, key=lambda p: abs(p - prev_pitch))
            # Smooth excessive leaps by moving an octave towards ``prev_pitch``
            if prev_pitch is not None and abs(pitch - prev_pitch) > 7:
                direction = -12 if pitch > prev_pitch else 12
                while low <= pitch + direction <= high and abs((pitch + direction) - prev_pitch) < abs(pitch - prev_pitch):
                    pitch += direction

        prev_pitch = pitch

        start = idx * sec_per_step
        start = _humanize(start, 0.004, rng)
        vel = int(_humanize(96, 4, rng))
        vel = max(1, min(127, vel))

        notes.append(Stem(start=start, dur=sec_per_step, pitch=pitch, vel=vel, chan=0))

    notes.sort(key=lambda n: n.start)
    return notes


def render_keys(
    pattern: Dict[str, List[int]],
    voiced_chords: List[List[int]],
    register: Dict[str, List[int]],
    meter: str,
    tempo: float,
    seed: int,
) -> List[Stem]:
    """Render a simple keyboard ``pattern`` into :class:`Stem` events.

    Parameters
    ----------
    pattern:
        Mapping that may contain ``"stabs"`` and/or ``"arp"`` grids on a
        16th‑note resolution.  ``1`` entries denote note onsets.  Optionally a
        ``"tension_policy"`` mapping of bar index -> list of semitone tensions
        can be supplied to extend chord stabs.
    voiced_chords:
        List of SATB voicings aligned by bar.  Each entry is expected to be a
        list of MIDI pitches ordered from lowest (bass) to highest (soprano).
    register:
        Register policy from which the ``"keys"`` range is used to fold pitches
        into the allowed span.
    meter:
        Meter string like ``"4/4"`` describing the rhythmic grid.
    tempo:
        Tempo in BPM used to convert beats to seconds.
    seed:
        Random seed controlling subtle humanisation.

    Returns
    -------
    List[Stem]
        Rendered key part note events.
    """

    # Determine overall length from whichever grid is longer
    steps = max(len(pattern.get("stabs", [])), len(pattern.get("arp", [])))
    if steps == 0:
        return []

    beats_per_bar = bars_to_beats(meter)
    spb = _steps_per_beat(meter)
    steps_per_bar = beats_per_bar * spb

    sec_per_beat = beats_to_secs(tempo)
    sec_per_step = sec_per_beat / spb

    rng = random.Random(seed)

    low, high = (register or {}).get("keys", (0, 127))
    tension_policy = pattern.get("tension_policy", {}) or {}

    notes: List[Stem] = []

    # Helper to fold and humanise note creation
    def _emit(start_idx: int, pitch: int, vel_base: int = 80) -> None:
        p = _fold_pitch_to_register(pitch, low, high)
        start = start_idx * sec_per_step
        start = _humanize(start, 0.005, rng)
        vel = int(_humanize(vel_base, 5, rng))
        vel = max(1, min(127, vel))
        notes.append(Stem(start=start, dur=sec_per_step, pitch=p, vel=vel, chan=1))

    # ------------------------------------------------------------------
    # Chord stabs (guide tones + tensions)
    # ------------------------------------------------------------------
    stabs = pattern.get("stabs", [])
    for idx, hit in enumerate(stabs):
        if not hit:
            continue

        bar_idx = idx // steps_per_bar
        step_in_bar = idx % steps_per_bar
        chord = voiced_chords[bar_idx] if bar_idx < len(voiced_chords) else []
        if not chord:
            continue

        root = min(chord)

        third: int | None = None
        seventh: int | None = None
        for p in chord:
            iv = (p - root) % 12
            if iv in (3, 4) and third is None:
                third = p
            elif iv in (10, 11) and seventh is None:
                seventh = p

        cand: List[int] = []
        if third is not None:
            cand.append(third)
        if seventh is not None:
            cand.append(seventh)

        for interval in tension_policy.get(bar_idx) or tension_policy.get(str(bar_idx), []) or []:
            cand.append(root + interval)

        strong = step_in_bar % spb == 0
        if strong:
            leading_pc = (root + 11) % 12
            seen = False
            dedup: List[int] = []
            for p in cand:
                if p % 12 == leading_pc:
                    if seen:
                        continue
                    seen = True
                dedup.append(p)
            cand = dedup

        for p in cand:
            _emit(idx, p, 88)

    # ------------------------------------------------------------------
    # Arpeggios (iterate through SATB voicing)
    # ------------------------------------------------------------------
    arp = pattern.get("arp", [])
    voice_order = [3, 2, 1, 0]  # S, A, T, B if ``chord`` sorted low->high
    arp_count = 0
    for idx, hit in enumerate(arp):
        if not hit:
            continue
        bar_idx = idx // steps_per_bar
        chord = voiced_chords[bar_idx] if bar_idx < len(voiced_chords) else []
        if not chord:
            continue
        voice = voice_order[arp_count % len(voice_order)]
        if voice < len(chord):
            _emit(idx, chord[voice], 72)
        arp_count += 1

    notes.sort(key=lambda n: n.start)
    return notes

