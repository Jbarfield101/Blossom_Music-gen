from __future__ import annotations

"""Simple arrangement helpers."""

from typing import Dict, List, Mapping
import random

from .song_spec import SongSpec
from .stems import Stem, bars_to_beats, beats_to_secs, _steps_per_beat
from . import dynamics


def _section_index(spec: SongSpec, bar: int) -> int | None:
    """Return the index of ``spec.sections`` containing ``bar``."""
    cursor = 0
    for idx, sec in enumerate(spec.sections):
        if cursor <= bar < cursor + sec.length:
            return idx
        cursor += sec.length
    return None


def arrange_song(
    spec: SongSpec,
    stems: Mapping[str, List[Stem]],
    style: Mapping[str, object] | None,
    seed: int,
) -> Dict[str, List[Stem]]:
    """Return arranged copy of ``stems`` according to ``spec`` and ``style``.

    Parameters
    ----------
    spec:
        Song specification describing structure and cadences.
    stems:
        Mapping of instrument name to note events as produced by
        :func:`core.stems.build_stems_for_song`.
    style:
        Arrangement style dictionary.  ``style['onoff']`` may provide a
        mapping of instrument name to lists of truthy values describing whether
        the instrument is active for each section.
    seed:
        Random seed for deterministic humanisation of added events.
    """

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_beat = beats_to_secs(spec.tempo)
    sec_per_bar = beats_per_bar * sec_per_beat
    spb = _steps_per_beat(spec.meter)
    sec_per_step = sec_per_beat / spb

    onoff: Dict[str, List[int]] = {}
    fx: Mapping[str, object] = {}
    if style:
        if isinstance(style.get("onoff"), Mapping):
            onoff = {k: list(v) for k, v in style["onoff"].items() if isinstance(v, (list, tuple))}
        if isinstance(style.get("fx"), Mapping):
            fx = style["fx"]

    out: Dict[str, List[Stem]] = {}

    # ------------------------------------------------------------------
    # Section muting/activation based on style['onoff']
    # ------------------------------------------------------------------
    for inst, notes in stems.items():
        toggles = onoff.get(inst)
        if not toggles:
            out[inst] = list(notes)
            continue
        filtered: List[Stem] = []
        for n in notes:
            bar_idx = int(n.start // sec_per_bar)
            sec_idx = _section_index(spec, bar_idx)
            if sec_idx is None or sec_idx >= len(toggles) or toggles[sec_idx]:
                filtered.append(n)
        out[inst] = filtered

    rng = random.Random(seed)

    # ------------------------------------------------------------------
    # Cadence handling: drum fills, bass approaches and optional FX
    # ------------------------------------------------------------------
    cadences = spec.cadence_bars()
    if cadences:
        for bar_idx in sorted(cadences):
            bar_start = bar_idx * sec_per_bar
            bar_end = bar_start + sec_per_bar
            # Drum fill: simple snare hit on the last 16th note of the bar
            fill_start = bar_end - sec_per_step
            vel = int(rng.uniform(100, 120))
            out.setdefault("drums", []).append(
                Stem(start=fill_start, dur=sec_per_step, pitch=38, vel=vel, chan=9)
            )
            # Optional tom roll across the bar
            if fx.get("cadence_toms"):
                tom_pitches = [45, 47, 50, 47]
                step = sec_per_bar / len(tom_pitches)
                for i, p in enumerate(tom_pitches):
                    start = bar_start + i * step
                    vel_t = int(rng.uniform(80, 110))
                    out.setdefault("drums", []).append(
                        Stem(start=start, dur=sec_per_step, pitch=p, vel=vel_t, chan=9)
                    )
            # Optional noise sweep leading into cadence
            if fx.get("cadence_noise"):
                vel_n = int(rng.uniform(70, 100))
                out.setdefault("fx", []).append(
                    Stem(start=bar_start, dur=sec_per_bar, pitch=0, vel=vel_n, chan=15)
                )
            # Bass approach: chromatic approach to first note of next bar
            next_start = (bar_idx + 1) * sec_per_bar
            next_end = next_start + sec_per_bar
            target_pitch = None
            target_vel = 96
            for bn in out.get("bass", []):
                if next_start <= bn.start < next_end:
                    target_pitch = bn.pitch
                    target_vel = bn.vel
                    break
            if target_pitch is not None:
                approach = target_pitch - 1
                low, high = spec.register_policy.get("bass", (0, 127))
                if approach < low:
                    approach = low
                if approach > high:
                    approach = high
                start = bar_end - sec_per_step
                vel_b = int(rng.uniform(80, target_vel))
                out.setdefault("bass", []).append(
                    Stem(start=start, dur=sec_per_step, pitch=approach, vel=vel_b, chan=0)
                )

    # ------------------------------------------------------------------
    # Chorus entry swells
    # ------------------------------------------------------------------
    if fx.get("chorus_swells"):
        for name, r in spec.bars_by_section().items():
            if "chorus" in name.lower():
                bar_start = r.start * sec_per_bar
                swell_start = max(0.0, bar_start - sec_per_bar)
                swell_dur = bar_start - swell_start
                vel_p = int(rng.uniform(60, 100))
                out.setdefault("pads", []).append(
                    Stem(start=swell_start, dur=swell_dur, pitch=60, vel=vel_p, chan=2)
                )

    # ------------------------------------------------------------------
    # Drop drums on first bar of bridge sections
    # ------------------------------------------------------------------
    if fx.get("bridge_drop") and out.get("drums"):
        drop_ranges: List[tuple[float, float]] = []
        for name, r in spec.bars_by_section().items():
            if "bridge" in name.lower():
                start = r.start * sec_per_bar
                end = start + sec_per_bar
                drop_ranges.append((start, end))
        if drop_ranges:
            kept: List[Stem] = []
            for n in out["drums"]:
                if any(s <= n.start < e for s, e in drop_ranges):
                    continue
                kept.append(n)
            out["drums"] = kept

    # ------------------------------------------------------------------
    # Outro handling
    # ------------------------------------------------------------------
    if (
        getattr(spec, "outro", None)
        and spec.sections
        and spec.sections[-1].name == "outro"
    ):
        outro_len = spec.sections[-1].length
        start_outro = (spec.total_bars() - outro_len) * sec_per_bar
        if spec.outro == "hit":
            dur = outro_len * sec_per_bar
            for inst, notes in out.items():
                if not notes:
                    continue
                last = notes[-1]
                out.setdefault(inst, []).append(
                    Stem(start=start_outro, dur=dur, pitch=last.pitch, vel=last.vel, chan=last.chan)
                )
        elif spec.outro == "ritard":
            beat = sec_per_beat
            for inst, notes in out.items():
                if not notes:
                    continue
                last = notes[-1]
                out.setdefault(inst, []).extend(
                    [
                        Stem(start=start_outro, dur=beat, pitch=last.pitch, vel=last.vel, chan=last.chan),
                        Stem(start=start_outro + beat, dur=beat * 1.5, pitch=last.pitch, vel=last.vel, chan=last.chan),
                        Stem(start=start_outro + beat * 2.5, dur=beat * 2.0, pitch=last.pitch, vel=last.vel, chan=last.chan),
                    ]
                )

    # ensure deterministic order
    for notes in out.values():
        notes.sort(key=lambda n: n.start)

    # Apply performance dynamics before rendering
    out = dynamics.apply(spec, out, seed)

    return out
