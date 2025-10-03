import pytest


pytest.importorskip("numpy")
pytest.importorskip("torch")
pytest.importorskip("torchaudio")

import numpy as np

from blossom.audio.riffusion.vocoder_hifigan import mel512_power_to_mel80_log


def test_mel512_power_to_mel80_log_runs_without_error():
    mel_power = np.ones((512, 4), dtype=np.float32)
    result = mel512_power_to_mel80_log(
        mel_power,
        sr=22050,
        n_fft=1024,
        hop=256,
        fmin=30.0,
        fmax=8000.0,
    )

    assert result.shape == (80, mel_power.shape[1])
