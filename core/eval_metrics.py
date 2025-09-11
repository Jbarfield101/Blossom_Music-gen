from __future__ import annotations

from typing import Dict, Mapping, Sequence, List

import numpy as np

from .stems import Stem, bars_to_beats
from .song_spec import SongSpec
from .theory import parse_chord_symbol, generate_satb


def chord_tone_coverage(stems: Mapping[str, Sequence[Stem]], spec: SongSpec) -> float:
    """Return fraction of bass/keys/pads notes that match the chord.

    If a chord symbol cannot be parsed, the corresponding note is treated as a
    non-match without raising an error.
    """
    chords = spec.all_chords()
    beats_per_bar = bars_to_beats(spec.meter)
    total = 0
    matches = 0
    for inst in ("bass", "keys", "pads"):
        for n in stems.get(inst, []):
            bar = int(n.start // beats_per_bar)
            if bar >= len(chords):
                continue
            total += 1
            try:
                root, intervals = parse_chord_symbol(chords[bar])
            except Exception:
                continue
            pcs = {(root + iv) % 12 for iv in intervals}
            if n.pitch % 12 in pcs:
                matches += 1
    return matches / total if total else 0.0


def voice_leading_smoothness(spec: SongSpec) -> float:
    """Average absolute interval movement across SATB voices."""
    chords = spec.all_chords()
    if len(chords) < 2:
        return 0.0
    bass, tenor, alto, soprano = generate_satb(chords)
    voices = [bass, tenor, alto, soprano]
    intervals: List[float] = []
    for voice in voices:
        intervals.extend(abs(voice[i] - voice[i - 1]) for i in range(1, len(voice)))
    return float(np.mean(intervals)) if intervals else 0.0


def rhythmic_stability(stems: Mapping[str, Sequence[Stem]]) -> Dict[str, float]:
    """Return IOI variance per instrument."""
    out: Dict[str, float] = {}
    for inst, notes in stems.items():
        starts = sorted(n.start for n in notes)
        if len(starts) < 2:
            out[inst] = 0.0
            continue
        iois = np.diff(starts)
        out[inst] = float(np.var(iois))
    return out


def cadence_fill_rate(stems: Mapping[str, Sequence[Stem]], spec: SongSpec) -> float:
    """Fraction of cadence bars preceded by above-average density."""
    beats_per_bar = bars_to_beats(spec.meter)
    cad_map = spec.cadence_bars()
    pre_cadence = [b - 1 for b in cad_map if b > 0]
    if not pre_cadence:
        return 0.0
    counts: Dict[int, int] = {}
    for notes in stems.values():
        for n in notes:
            bar = int(n.start // beats_per_bar)
            counts[bar] = counts.get(bar, 0) + 1
    normal = [cnt for bar, cnt in counts.items() if bar not in pre_cadence]
    avg_normal = float(np.mean(normal)) if normal else 0.0
    filled = sum(1 for b in pre_cadence if counts.get(b, 0) > avg_normal)
    return filled / len(pre_cadence)


def density_alignment(stems: Mapping[str, Sequence[Stem]], spec: SongSpec) -> Dict[str, Dict[str, float]]:
    """Return normalized actual vs. expected note density per section."""
    beats_per_bar = bars_to_beats(spec.meter)
    counts: Dict[int, int] = {}
    for notes in stems.values():
        for n in notes:
            bar = int(n.start // beats_per_bar)
            counts[bar] = counts.get(bar, 0) + 1
    sec_map = spec.bars_by_section()
    raw: Dict[str, float] = {}
    for sec in spec.sections:
        bars = list(sec_map[sec.name])
        if bars:
            total = sum(counts.get(b, 0) for b in bars)
            actual = total / (len(bars) * beats_per_bar)
        else:
            actual = 0.0
        raw[sec.name] = actual
    max_ref = max(raw.values(), default=0.0)
    if max_ref <= 0.0:
        max_ref = 1.0
    out: Dict[str, Dict[str, float]] = {}
    for sec in spec.sections:
        expected = float(spec.density_curve.get(sec.name, 0.0))
        normalized = raw[sec.name] / max_ref
        normalized = float(np.clip(normalized, 0.0, 1.0))
        out[sec.name] = {"expected": expected, "actual": normalized}
    return out


def audio_stats(audio: np.ndarray) -> Dict[str, float]:
    """Return peak and RMS levels in dBFS for ``audio``."""
    if audio.size == 0:
        return {"peak_db": 0.0, "rms_db": 0.0}
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(np.square(audio))))
    if peak <= 0.0 and rms <= 0.0:
        return {"peak_db": 0.0, "rms_db": 0.0}
    peak_db = 20 * np.log10(peak) if peak > 0.0 else 0.0
    rms_db = 20 * np.log10(rms) if rms > 0.0 else 0.0
    return {"peak_db": float(peak_db), "rms_db": float(rms_db)}


def evaluate_render(stems: Mapping[str, Sequence[Stem]], spec: SongSpec, audio: np.ndarray) -> Dict[str, object]:
    """Compute all evaluation metrics for a render."""
    return {
        "chord_tone_coverage": chord_tone_coverage(stems, spec),
        "voice_leading_smoothness": voice_leading_smoothness(spec),
        "rhythmic_stability": rhythmic_stability(stems),
        "cadence_fill_rate": cadence_fill_rate(stems, spec),
        "density_alignment": density_alignment(stems, spec),
        "audio_stats": audio_stats(audio),
    }
