import pytest
from pathlib import Path
import numpy as np

torch = pytest.importorskip("torch")
ort = pytest.importorskip("onnxruntime")

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


@pytest.mark.parametrize("name", MODEL_NAMES)
def test_onnx_handles_variable_length_prompts(name):
    """ONNX models should accept variable batch and time dimensions."""
    onnx_path = MODELS_DIR / f"{name}.onnx"
    sess = ort.InferenceSession(onnx_path.as_posix(), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    in_dim = sess.get_inputs()[0].shape[2]
    for batch in (1, 2):
        for steps in (1, 5):
            inp = np.zeros((batch, steps, in_dim), dtype=np.float32)
            out = sess.run(None, {input_name: inp})[0]
            assert out.shape[0] == batch
            assert out.shape[1] == steps
