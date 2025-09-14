import numpy as np
import pytest

from core.style import load_style, StyleToken
from core.mixer import mix

def test_synthwave_retro_loaded():
    style = load_style("synthwave_retro")
    assert StyleToken.SYNTHWAVE_RETRO == 7
    assert style["swing"] == pytest.approx(0.05)
    assert style["drums"]["swing"] == pytest.approx(0.03)
    synth = style["synth_defaults"]
    assert synth["lpf_cutoff"] == pytest.approx(5000.0)
    assert synth["chorus"] == pytest.approx(0.5)
    assert synth["saturation"] == pytest.approx(0.4)


def test_synthwave_retro_lpf_between_lofi_and_rock():
    sr = 44100
    t = np.arange(sr, dtype=np.float32) / sr
    tone = np.sin(2 * np.pi * 5000 * t).astype(np.float32)
    stems = {"keys": tone}
    style_lofi = load_style("assets/styles/lofi.json")
    style_rock = load_style("assets/styles/rock.json")
    style_synth = load_style("assets/styles/synthwave_retro.json")
    out_lofi = mix(stems, sr, {}, style=style_lofi)
    out_rock = mix(stems, sr, {}, style=style_rock)
    out_synth = mix(stems, sr, {}, style=style_synth)
    n = out_lofi.shape[0]
    idx = int(5000 * n / sr)
    amp_lofi = np.abs(np.fft.rfft(out_lofi[:, 0])[idx])
    amp_rock = np.abs(np.fft.rfft(out_rock[:, 0])[idx])
    amp_synth = np.abs(np.fft.rfft(out_synth[:, 0])[idx])
    assert amp_lofi < amp_synth < amp_rock
