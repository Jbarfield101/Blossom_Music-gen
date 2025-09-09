import numpy as np
import soundfile as sf
from pathlib import Path

from core.render import _load_drum_samples, _render_drums
from core.stems import Stem


def test_drum_sample_mapping_and_round_robin(tmp_path: Path) -> None:
    sr = 8000
    # create two distinct samples for the same pitch
    s1 = np.full(100, 0.1, dtype=np.float32)
    s2 = np.full(100, 0.2, dtype=np.float32)
    sf.write(tmp_path / "a.wav", s1, sr)
    sf.write(tmp_path / "b.wav", s2, sr)

    mapping = {"a.wav": 36, "b.wav": 36}
    loaded = _load_drum_samples(tmp_path, sr, mapping)
    assert 36 in loaded
    assert len(loaded[36]) == 2

    notes = [
        Stem(start=0.0, dur=0.0125, pitch=36, vel=127, chan=9),
        Stem(start=0.0125, dur=0.0125, pitch=36, vel=127, chan=9),
        Stem(start=0.025, dur=0.0125, pitch=36, vel=127, chan=9),
    ]
    audio = _render_drums(notes, sr, tmp_path, mapping)
    # ensure round-robin cycling a->b->a
    assert np.allclose(audio[0:100], s1, atol=1e-4)
    assert np.allclose(audio[100:200], s2, atol=1e-4)
    assert np.allclose(audio[200:300], s1, atol=1e-4)

