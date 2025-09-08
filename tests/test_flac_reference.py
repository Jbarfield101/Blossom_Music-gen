import math
from pathlib import Path

import pytest

sf = pytest.importorskip("soundfile")

from core.stems import Stem
from core.render import render_keys


def test_flac_reference_renders(tmp_path):
    sample_path = tmp_path / "tone.flac"
    sr = 22050
    freq = 440.0
    frames = sr // 10
    samples = [math.sin(2 * math.pi * freq * i / sr) for i in range(frames)]
    sf.write(sample_path, samples, sr)

    sfz = tmp_path / "inst.sfz"
    sfz.write_text("<region> sample=tone.flac lokey=0 hikey=127 pitch_keycenter=60")

    notes = [Stem(start=0.0, dur=0.1, pitch=60, vel=100, chan=0)]
    audio = render_keys(notes, sfz, sr)
    assert any(abs(x) > 0 for x in audio)
