"""Minimal SFZ sampler and parser."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List
import math
import numpy as np
import soundfile as sf

from .stems import Stem


@dataclass
class SFZRegion:
    lokey: int = 0
    hikey: int = 127
    pitch_keycenter: int = 60
    sample_path: Path = Path()
    sample_rate: int = 0
    samples: List[float] | None = None

    def load(self) -> None:
        if self.samples is not None:
            return
        data, sr = sf.read(str(self.sample_path), always_2d=True, dtype="float32")
        self.sample_rate = sr
        if data.shape[1] > 1:
            data = np.mean(data, axis=1)
        else:
            data = data[:, 0]
        self.samples = data.tolist()


class SFZSampler:
    """Tiny SFZ parser and sampler supporting a handful of opcodes."""

    def __init__(self, sfz_path: Path):
        self.sfz_path = sfz_path
        if not sfz_path.exists():
            raise FileNotFoundError(f"SFZ instrument not found: {sfz_path}")
        self.regions = self._parse(sfz_path)
        missing = [r.sample_path for r in self.regions if not r.sample_path.exists()]
        if missing:
            raise FileNotFoundError(
                f"Missing SFZ sample(s): {', '.join(str(p) for p in missing)}"
            )

    # ------------------------------------------------------------------ parsing
    def _parse(self, path: Path) -> List[SFZRegion]:
        regions: List[SFZRegion] = []
        global_attrs: dict[str, str] = {}
        group_attrs: dict[str, str] = {}
        region_attrs: dict[str, str] = {}
        current = global_attrs
        root = path.parent

        def finalize_region() -> None:
            nonlocal region_attrs
            if region_attrs.get("sample"):
                attrs = {**global_attrs, **group_attrs, **region_attrs}
                regions.append(self._region_from(attrs, root))
            region_attrs = {}

        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("//") or line.startswith("#"):
                    continue
                tokens = line.split()
                for tok in tokens:
                    tl = tok.lower()
                    if tl == "<region>":
                        finalize_region()
                        current = region_attrs
                    elif tl == "<group>":
                        finalize_region()
                        group_attrs = {}
                        current = group_attrs
                    elif tl == "<control>":
                        finalize_region()
                        global_attrs = {}
                        current = global_attrs
                    elif "=" in tok:
                        k, v = tok.split("=", 1)
                        current[k.lower()] = v
        finalize_region()
        return regions

    def _region_from(self, attrs: dict[str, str], root: Path) -> SFZRegion:
        lokey = int(attrs.get("lokey", 0))
        hikey = int(attrs.get("hikey", 127))
        pk = int(attrs.get("pitch_keycenter", lokey))
        sample = root / attrs["sample"]
        return SFZRegion(lokey, hikey, pk, sample)

    def _region_for(self, pitch: int) -> SFZRegion:
        for r in self.regions:
            if r.lokey <= pitch <= r.hikey:
                r.load()
                return r
        raise ValueError(f"No region for pitch {pitch}")

    # ---------------------------------------------------------------- rendering
    def render(self, notes: List[Stem], sample_rate: int) -> np.ndarray:
        if not notes:
            return np.zeros(0)
        # compute total length
        end_time = 0.0
        for n in notes:
            r = self._region_for(n.pitch)
            ratio = 2 ** ((n.pitch - r.pitch_keycenter) / 12)
            samp_dur = len(r.samples) / r.sample_rate / ratio
            dur = min(n.dur, samp_dur)
            end_time = max(end_time, n.start + dur)
        total_len = int(math.ceil(end_time * sample_rate))
        out = [0.0 for _ in range(total_len)]

        for n in notes:
            r = self._region_for(n.pitch)
            ratio = (r.sample_rate / sample_rate) * (2 ** ((n.pitch - r.pitch_keycenter) / 12))
            data = self._resample(r.samples, ratio)
            note_len = min(int(n.dur * sample_rate), len(data))
            start_idx = int(n.start * sample_rate)
            gain = n.vel / 127.0
            for i in range(note_len):
                idx = start_idx + i
                if idx >= len(out):
                    out.append(0.0)
                out[idx] += data[i] * gain

        peak = max(abs(x) for x in out) if out else 1.0
        if peak > 1.0:
            out = [x / peak for x in out]
        return np.array(out)

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _resample(data: List[float], factor: float) -> List[float]:
        if factor == 1.0:
            return list(data)
        new_len = int(len(data) / factor)
        if new_len <= 1:
            return [data[0]]
        return [SFZSampler._interp(data, i * factor) for i in range(new_len)]

    @staticmethod
    def _interp(data: List[float], pos: float) -> float:
        i0 = int(math.floor(pos))
        i1 = min(i0 + 1, len(data) - 1)
        frac = pos - i0
        return data[i0] * (1 - frac) + data[i1] * frac
