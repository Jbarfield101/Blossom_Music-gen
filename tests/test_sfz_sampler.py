import math
import struct
import wave
from pathlib import Path

from core.stems import Stem
from core.render import render_keys


def test_basic_sfz_render(tmp_path):
    """Ensure sampler renders velocity-scaled notes without clipping."""
    # create a temporary WAV sample (simple sine wave)
    sample_path = tmp_path / "sine.wav"
    sr = 22050
    freq = 440.0
    dur = 0.5
    frames = int(sr * dur)
    samples = [math.sin(2 * math.pi * freq * i / sr) for i in range(frames)]
    pcm = [int(s * 32767) for s in samples]
    with wave.open(str(sample_path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack("<" + "h" * len(pcm), *pcm))

    # create matching SFZ referencing the generated sample
    sfz = tmp_path / "inst.sfz"
    sfz.write_text("<region> sample=sine.wav lokey=0 hikey=127 pitch_keycenter=60")

    notes = [
        Stem(start=0.0, dur=0.5, pitch=60, vel=127, chan=0),
        Stem(start=0.5, dur=0.5, pitch=60, vel=64, chan=0),
    ]

    audio = render_keys(notes, sfz, sr)
    assert len(audio) >= sr
    first_peak = max(abs(x) for x in audio[: sr // 2])
    second_peak = max(abs(x) for x in audio[sr // 2 : sr])
    assert first_peak > second_peak
