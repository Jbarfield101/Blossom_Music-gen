from __future__ import annotations

"""Simple arrangement helpers."""

from typing import Dict, List, Mapping
import random

from .song_spec import SongSpec, Section
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
    minutes: float | None = None,
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
    minutes:
        Optional target duration in minutes.  Sections are looped to approach
        this duration within ±2% where possible.
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
    # Section looping to approximate target minutes
    # ------------------------------------------------------------------
    target_minutes = minutes
    if target_minutes is None and style:
        m = style.get("minutes") if isinstance(style, Mapping) else None
        if isinstance(m, (int, float)):
            target_minutes = float(m)

    target_secs = None
    tol = 0.0
    current_dur = spec.total_bars() * sec_per_bar
    if target_minutes and target_minutes > 0:
        target_secs = target_minutes * 60.0
        tol = target_secs * 0.02

        # Pre-split notes by section for duplication
        section_info: List[tuple[float, float]] = []
        bar_cursor = 0
        for sec in spec.sections:
            start = bar_cursor * sec_per_bar
            dur = sec.length * sec_per_bar
            section_info.append((start, dur))
            bar_cursor += sec.length

        base_out = {inst: list(notes) for inst, notes in out.items()}
        section_notes: List[Dict[str, List[Stem]]] = [dict() for _ in section_info]
        for inst, notes in base_out.items():
            for n in notes:
                for idx, (start, dur) in enumerate(section_info):
                    if start - 0.01 <= n.start < start + dur - 0.01:
                        section_notes[idx].setdefault(inst, []).append(n)
                        break

        plan: List[int] = []
        cursor = current_dur
        sec_idx = 0
        while target_secs and cursor + section_info[sec_idx % len(section_info)][1] <= target_secs + tol:
            idx = sec_idx % len(section_info)
            plan.append(idx)
            cursor += section_info[idx][1]
            sec_idx += 1
            if cursor >= target_secs - tol:
                break

        if plan:
            # Extend spec sections
            new_secs = list(spec.sections)
            for idx in plan:
                tmpl = spec.sections[idx]
                new_secs.append(Section(name=tmpl.name, length=tmpl.length))
            spec.sections = new_secs

            # Duplicate notes
            cursor_offset = current_dur
            for idx in plan:
                start_off, dur = section_info[idx]
                for inst, notes in section_notes[idx].items():
                    for n in notes:
                        out.setdefault(inst, []).append(
                            Stem(
                                start=n.start - start_off + cursor_offset,
                                dur=n.dur,
                                pitch=n.pitch,
                                vel=n.vel,
                                chan=n.chan,
                            )
                        )
                cursor_offset += dur
            current_dur = cursor_offset

        leftover = 0.0
        if target_secs:
            leftover = max(0.0, target_secs - current_dur)
    else:
        leftover = 0.0

    # ------------------------------------------------------------------
    # Outro handling
    # ------------------------------------------------------------------
    outro_cfg = None
    if style and isinstance(style.get("outro"), (str, Mapping)):
        outro_cfg = style.get("outro")

    outro_type = ""
    outro_opts: Mapping[str, object] = {}
    if isinstance(outro_cfg, str):
        outro_type = outro_cfg
    elif isinstance(outro_cfg, Mapping):
        outro_type = str(outro_cfg.get("type", ""))
        outro_opts = outro_cfg

    if outro_type:
        if outro_type == "ritard":
            factor = float(outro_opts.get("factor", 1.5))
            if target_secs and current_dur < target_secs:
                # adjust factor to meet target length if needed
                needed = target_secs - (current_dur - sec_per_bar)
                if sec_per_bar > 0:
                    factor = max(factor, needed / sec_per_bar)
            last_bar_start = max(0.0, current_dur - sec_per_bar)
            for notes in out.values():
                for n in notes:
                    if n.start >= last_bar_start:
                        off = n.start - last_bar_start
                        end_off = off + n.dur
                        n.start = last_bar_start + off * factor
                        new_end = last_bar_start + end_off * factor
                        n.dur = new_end - n.start
                    elif n.start + n.dur > last_bar_start:
                        overlap = (n.start + n.dur) - last_bar_start
                        n.dur += overlap * (factor - 1)
            bar_end_new = last_bar_start + sec_per_bar * factor
            for notes in out.values():
                if not notes:
                    continue
                last = max(notes, key=lambda n: n.start + n.dur)
                if last.start + last.dur < bar_end_new:
                    last.dur = bar_end_new - last.start
            current_dur = bar_end_new
        else:  # final hit + hold
            hold = float(outro_opts.get("hold", sec_per_bar))
            if target_secs and current_dur + hold < target_secs:
                hold = target_secs - current_dur
            end_time = current_dur
            out.setdefault("drums", []).append(
                Stem(start=end_time, dur=hold * 2, pitch=49, vel=110, chan=9)
            )
            for inst, notes in out.items():
                if inst == "drums" or not notes:
                    continue
                last = max(notes, key=lambda n: n.start + n.dur)
                last.dur += hold
            current_dur += hold

    total_play_time = current_dur

    # ensure deterministic order
    for notes in out.values():
        notes.sort(key=lambda n: n.start)

    # Apply performance dynamics before rendering
    out = dynamics.apply(spec, out, seed)

    return out
