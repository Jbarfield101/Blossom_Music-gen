import numpy as np

from ears.pipeline import _resample


def test_resample_48k_to_16k_length():
    sr_in = 48000
    sr_out = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sr_in * duration), endpoint=False)
    sine = np.sin(2 * np.pi * 440 * t)
    stereo = np.stack([sine, sine], axis=1)
    pcm = (stereo * 32767).astype(np.int16).tobytes()
    resampled = _resample(pcm, sr_in, sr_out)
    out = np.frombuffer(resampled, dtype=np.int16)
    assert out.shape[0] == int(sr_out * duration)
