import importlib.util
from pathlib import Path

style_path = Path(__file__).resolve().parents[1] / "core" / "style.py"
spec = importlib.util.spec_from_file_location("style", style_path)
style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(style)

StyleToken = style.StyleToken
style_to_token = style.style_to_token
load_style = style.load_style


def test_synthwave_retro_token_mapped():
    assert style_to_token("synthwave_retro") is StyleToken.SYNTHWAVE_RETRO


def test_synthwave_retro_defaults():
    style = load_style("assets/styles/synthwave_retro.json")
    assert style["synth_defaults"] == {
        "lpf_cutoff": 5000.0,
        "chorus": 0.5,
        "saturation": 0.4,
    }
