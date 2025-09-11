import pytest
from pathlib import Path

import torch
import onnxruntime as ort

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_NAMES = ["bass_phrase", "drum_phrase", "keys_phrase"]

@pytest.mark.parametrize("name", MODEL_NAMES)
def test_torchscript_model_loads(name):
    """Each TorchScript model should be loadable on CPU."""
    ts_path = MODELS_DIR / f"{name}.ts.pt"
    torch.jit.load(ts_path.as_posix(), map_location="cpu")


@pytest.mark.parametrize("name", MODEL_NAMES)
def test_onnx_model_loads(name):
    """Each ONNX model should create an inference session."""
    onnx_path = MODELS_DIR / f"{name}.onnx"
    ort.InferenceSession(onnx_path.as_posix(), providers=["CPUExecutionProvider"])
