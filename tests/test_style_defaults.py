import numpy as np

from core.style import load_style
from core.mixer import mix


def test_style_loader_fields():
    style = load_style("assets/styles/lofi.json")
    assert "synth_defaults" in style
    assert "drums" in style and "swing" in style["drums"]


def test_mixer_style_defaults_apply():
    sr = 44100
    tone = np.ones(sr, dtype=np.float32)
    stems = {"keys": tone}
    style = {"synth_defaults": {"chorus": 1.0, "saturation": 1.0}}
    wet = mix(stems, sr, {}, style=style)
    dry = mix(stems, sr, {}, style={})
    assert wet.shape == (sr, 2)
    assert not np.allclose(wet, dry)
