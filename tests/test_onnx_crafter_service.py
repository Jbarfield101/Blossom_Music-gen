import pytest
from pathlib import Path

pytest.importorskip("onnxruntime")
pytest.importorskip("numpy")

from core.onnx_crafter_service import ModelSession

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"


def test_modelsessions_are_isolated():
    model = MODELS_DIR / "bass_phrase.onnx"
    ms1 = ModelSession()
    ms2 = ModelSession()
    ms1.load_session(model)
    ms2.load_session(model)
    ms1.generate([], 0, {})
    ms2.generate([], 0, {})
    assert ms1.sess is not ms2.sess
    assert ms1.telemetry is not ms2.telemetry
    assert "device" in ms1.telemetry and "device" in ms2.telemetry
