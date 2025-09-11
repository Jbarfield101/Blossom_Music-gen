#!/usr/bin/env python3
"""A/B evaluation of algorithmic vs. learned phrase generation.

The script renders two versions of a song specification: one using the
deterministic pattern synthesiser and one using the optional neural phrase
models. Audio, note data and a suite of metrics are written to the output
directory to enable reproducible comparisons.
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Mapping, Sequence, Tuple

import numpy as np

# Ensure repository root on import path when run as script
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

# Optional scipy stub for lightweight environments
import types

try:  # pragma: no cover - optional dependency
    import scipy.signal  # type: ignore
except Exception:  # pragma: no cover - used when scipy is unavailable
    signal = types.SimpleNamespace(lfilter=lambda b, a, x: x)
    sys.modules.setdefault("scipy", types.SimpleNamespace(signal=signal))
    sys.modules.setdefault("scipy.signal", signal)

from core.song_spec import SongSpec
from core.pattern_synth import build_patterns_for_song
from core.stems import Stem, bars_to_beats
from core import event_vocab
from core.render import render_song
from core.mixer import mix
from core.loudness import estimate_lufs
from core.utils import beats_to_samples

SR = 44100

# ---------------------------------------------------------------------------
# Helpers for token handling and WAV writing
# ---------------------------------------------------------------------------

TOKEN_BASE = 128  # token packing uses 7 bits for values

def _unpack_tokens(tokens: Sequence[int]) -> List[Tuple[int, int]]:
    """Split packed integer ``tokens`` into ``(type, value)`` pairs."""
    return [(int(t) // TOKEN_BASE, int(t) % TOKEN_BASE) for t in tokens]


def _write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    """Write ``audio`` to ``path`` as 16‑bit PCM WAV."""
    import struct

    data = np.clip(audio, -1.0, 1.0)
    if data.ndim == 1:
        data = data[:, None]
    pcm = (data * 32767).astype("<i2").tobytes()
    channels = data.shape[1]
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sr,
        sr * channels * 2,
        channels * 2,
        16,
        b"data",
        len(pcm),
    )
    with path.open("wb") as fh:
        fh.write(header)
        fh.write(pcm)


# ---------------------------------------------------------------------------
# Conversion from pattern plans to stems
# ---------------------------------------------------------------------------

def _stems_from_plan(plan: Mapping[str, object], spec: SongSpec) -> Dict[str, List[Stem]]:
    """Convert a pattern ``plan`` into stems in beats."""
    beats_per_bar = bars_to_beats(spec.meter)
    sec_map = spec.bars_by_section()
    stems: Dict[str, List[Stem]] = {"drums": [], "bass": [], "keys": [], "pads": []}

    for sec in plan.get("sections", []):  # type: ignore[assignment]
        sec_name = sec.get("section")
        bar_range = sec_map.get(sec_name, range(0))
        offset = bar_range.start * beats_per_bar
        patterns = sec.get("patterns", {})
        for inst, patt in patterns.items():
            notes: List[Stem]
            if patt and isinstance(patt, list) and patt and isinstance(patt[0], int):
                pairs = _unpack_tokens(patt)  # type: ignore[arg-type]
                notes, _meta = event_vocab.decode(pairs)
            else:
                notes = [Stem(**ev) for ev in patt] if isinstance(patt, list) else []
            for n in notes:
                n.start += offset
            stems.setdefault(inst, []).extend(notes)

    for ns in stems.values():
        ns.sort(key=lambda n: n.start)
    return stems


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def _note_diversity(stems: Mapping[str, Sequence[Stem]]) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {}
    for inst, notes in stems.items():
        pitches = {n.pitch for n in notes}
        out[inst] = {"unique_pitches": len(pitches), "total_notes": len(notes)}
    return out


def _ioi_histogram(stems: Mapping[str, Sequence[Stem]], *, bins: Sequence[float]) -> Dict[str, Dict[str, List[float]]]:
    out: Dict[str, Dict[str, List[float]]] = {}
    for inst, notes in stems.items():
        starts = sorted(n.start for n in notes)
        if len(starts) < 2:
            counts = [0] * (len(bins) - 1)
        else:
            iois = np.diff(starts)
            counts, edges = np.histogram(iois, bins=bins)
            out[inst] = {"bins": list(map(float, edges)), "counts": counts.astype(int).tolist()}
            continue
        out[inst] = {"bins": list(map(float, bins)), "counts": counts}
    return out


def _cadence_density(stems: Mapping[str, Sequence[Stem]], spec: SongSpec) -> Dict[str, float]:
    beats_per_bar = bars_to_beats(spec.meter)
    cadence_map = spec.cadence_bars()
    pre_cadence = {b - 1 for b in cadence_map if b > 0}
    counts: Dict[int, int] = {}
    for notes in stems.values():
        for n in notes:
            bar = int(n.start // beats_per_bar)
            counts[bar] = counts.get(bar, 0) + 1
    densities = {bar: cnt / beats_per_bar for bar, cnt in counts.items()}
    cad = [densities.get(b, 0.0) for b in pre_cadence]
    normal = [d for bar, d in densities.items() if bar not in pre_cadence]
    avg_cad = float(np.mean(cad)) if cad else 0.0
    avg_norm = float(np.mean(normal)) if normal else 0.0
    return {"cadence": avg_cad, "non_cadence": avg_norm}


def _section_loudness(audio: np.ndarray, sr: int, spec: SongSpec) -> List[Dict[str, float]]:
    beats_per_bar = bars_to_beats(spec.meter)
    res = []
    for sec in spec.sections:
        start_bar = spec.bars_by_section()[sec.name].start
        end_bar = start_bar + sec.length
        start_samp = beats_to_samples(start_bar * beats_per_bar, spec.tempo, sr)
        end_samp = beats_to_samples(end_bar * beats_per_bar, spec.tempo, sr)
        seg = audio[start_samp:end_samp]
        if seg.size == 0:
            rms = float("-inf")
            lufs = float("-inf")
        else:
            rms_v = float(np.sqrt(np.mean(np.square(seg))))
            rms = -np.inf if rms_v <= 0 else 20 * np.log10(rms_v)
            lufs = estimate_lufs(seg, sr)
        res.append({"section": sec.name, "rms_db": rms, "lufs": lufs})
    return res


# ---------------------------------------------------------------------------
# Evaluation pipeline
# ---------------------------------------------------------------------------

def _save_stems(path: Path, stems: Mapping[str, Sequence[Stem]]) -> None:
    data = {inst: [asdict(n) for n in notes] for inst, notes in stems.items()}
    path.write_text(json.dumps({"stems": data}, indent=2))


def _evaluate_variant(name: str, spec: SongSpec, use_phrase_model: str, out_dir: Path) -> Dict[str, object]:
    plan = build_patterns_for_song(spec, seed=spec.seed, sampler_seed=spec.seed, use_phrase_model=use_phrase_model)
    stems = _stems_from_plan(plan, spec)
    rendered = render_song(stems, sr=SR, tempo=spec.tempo, meter=spec.meter)
    mix_audio = mix(rendered, SR)
    _write_wav(out_dir / f"{name}.wav", mix_audio, SR)
    _save_stems(out_dir / f"{name}_stems.json", stems)
    metrics = {
        "note_diversity": _note_diversity(stems),
        "ioi_histogram": _ioi_histogram(stems, bins=np.arange(0.0, 5.0, 0.5)),
        "cadence_density": _cadence_density(stems, spec),
        "section_loudness": _section_loudness(mix_audio, SR, spec),
    }
    return metrics


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True, help="SongSpec JSON file")
    parser.add_argument("--out", type=Path, default=Path("ab_eval_out"), help="Output directory")
    parser.add_argument("--seed", type=int, default=0, help="Seed controlling generation")
    args = parser.parse_args(argv)

    spec = SongSpec.from_json(args.spec)
    spec.seed = args.seed
    spec.validate()

    args.out.mkdir(parents=True, exist_ok=True)

    results: Dict[str, Dict[str, object]] = {}
    results["algorithmic"] = _evaluate_variant("algorithmic", spec, "no", args.out)
    results["learned"] = _evaluate_variant("learned", spec, "yes", args.out)

    # Structured JSON
    (args.out / "ab_eval.json").write_text(json.dumps(results, indent=2))

    # Flattened CSV for quick inspection
    rows = []
    for variant, mets in results.items():
        for inst, nd in mets["note_diversity"].items():
            rows.append({"variant": variant, "metric": "note_diversity", "instrument": inst, **nd})
        for inst, hist in mets["ioi_histogram"].items():
            rows.append({
                "variant": variant,
                "metric": "ioi_histogram",
                "instrument": inst,
                "bins": ";".join(map(str, hist["bins"])),
                "counts": ";".join(map(str, hist["counts"])),
            })
        cd = mets["cadence_density"]
        rows.append({"variant": variant, "metric": "cadence_cadence", "value": cd["cadence"]})
        rows.append({"variant": variant, "metric": "cadence_non_cadence", "value": cd["non_cadence"]})
        for sec in mets["section_loudness"]:
            rows.append({
                "variant": variant,
                "metric": "section_loudness",
                "section": sec["section"],
                "rms_db": sec["rms_db"],
                "lufs": sec["lufs"],
            })
    with (args.out / "metrics.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=sorted({k for row in rows for k in row}))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
