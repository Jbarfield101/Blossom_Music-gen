from pathlib import Path

import pytest

sf = pytest.importorskip("soundfile")

from core.stems import Stem
from core.sfz_sampler import SFZSampler


@pytest.mark.parametrize(
    "sfz_path",
    [
        Path("assets/sfz/Piano/SplendidGrandPiano/Splendid Grand Piano.sfz"),
        Path("assets/sfz/Piano/UprightPiano/UprightPiano.sfz"),
        Path("assets/sfz/Pads/SynthPadChoir/SynthPadChoir.sfz"),
        Path("assets/sfz/Bass/LatelyBass/LatelyBass.sfz"),
    ],
)
def test_sfz_instruments_render_note_sequence(sfz_path):
    sampler = SFZSampler(sfz_path)
    sr = 44100
    # Four sequential quarter notes at middle C
    notes = [Stem(start=i * 0.25, dur=0.25, pitch=60, vel=100, chan=0) for i in range(4)]
    audio = sampler.render(notes, sample_rate=sr)
    expected_len = int(sr * (notes[-1].start + notes[-1].dur))
    assert len(audio) == expected_len
    assert any(abs(x) > 0 for x in audio)
