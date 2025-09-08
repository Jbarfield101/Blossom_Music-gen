"""Audio rendering helpers."""
from __future__ import annotations

from pathlib import Path
from typing import List

import numpy as np

from .stems import Stem
from .sfz_sampler import SFZSampler


def render_keys(stems: List[Stem], sfz_path: Path, sr: int) -> np.ndarray:
    """Render ``stems`` using the SFZ instrument at ``sfz_path``."""
    sampler = SFZSampler(sfz_path)
    return sampler.render(stems, sample_rate=sr)
