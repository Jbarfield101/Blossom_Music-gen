import math
from pathlib import Path

import pytest

sf = pytest.importorskip("soundfile")

from core.stems import Stem
from core.render import render_keys
from core.sfz_sampler import SFZSampler


def test_basic_sfz_render(tmp_path):
    """Ensure sampler renders velocity-scaled notes without clipping."""
    # create a temporary FLAC sample (simple sine wave)
    sample_path = tmp_path / "sine.flac"
    sr = 22050
    freq = 440.0
    dur = 0.5
    frames = int(sr * dur)
    samples = [math.sin(2 * math.pi * freq * i / sr) for i in range(frames)]
    sf.write(sample_path, samples, sr)

    # create matching SFZ referencing the generated sample
    sfz = tmp_path / "inst.sfz"
    sfz.write_text("<region> sample=sine.flac lokey=0 hikey=127 pitch_keycenter=60")

    notes = [
        Stem(start=0.0, dur=0.5, pitch=60, vel=127, chan=0),
        Stem(start=0.5, dur=0.5, pitch=60, vel=64, chan=0),
    ]

    audio = render_keys(notes, sfz, sr)
    assert len(audio) >= sr
    first_peak = max(abs(x) for x in audio[: sr // 2])
    second_peak = max(abs(x) for x in audio[sr // 2 : sr])
    assert first_peak > second_peak


def _write_sample(path: Path, freq: float = 440.0, sr: int = 22050) -> None:
    """Write a simple sine wave sample for testing."""
    dur = 0.1
    frames = int(sr * dur)
    samples = [math.sin(2 * math.pi * freq * i / sr) for i in range(frames)]
    sf.write(path, samples, sr)


def test_group_and_trailing_definitions(tmp_path):
    """Groups apply attributes to regions and trailing tokens are ignored."""
    s1 = tmp_path / "a.wav"
    s2 = tmp_path / "b.wav"
    _write_sample(s1, 440.0)
    _write_sample(s2, 660.0)

    sfz = tmp_path / "inst.sfz"
    sfz.write_text(
        """
<group> lokey=60 hikey=61 pitch_keycenter=60
<region> sample=a.wav
<group> hikey=63 pitch_keycenter=62
<region> sample=b.wav lokey=62
<group> lokey=70
""".strip()
    )

    sampler = SFZSampler(sfz)
    assert len(sampler.regions) == 2
    r1, r2 = sampler.regions
    assert (r1.lokey, r1.hikey, r1.pitch_keycenter) == (60, 61, 60)
    assert (r2.lokey, r2.hikey, r2.pitch_keycenter) == (62, 63, 62)
