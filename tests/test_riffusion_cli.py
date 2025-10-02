from __future__ import annotations

import math
import sys
import types
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:  # pragma: no cover - defensive
    sys.path.insert(0, str(REPO_ROOT))

import pytest

try:  # pragma: no cover - exercised depending on environment
    import numpy as np  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    class _FakeArray(list):
        """Very small subset of numpy ndarray used by the CLI in tests."""

        @property
        def ndim(self) -> int:
            return 1

        @property
        def size(self) -> int:
            return len(self)

        def astype(self, dtype, copy: bool = True):
            return _FakeArray(dtype(x) for x in self)

        def mean(self, axis=None):
            values = [float(x) for x in self]
            if not values:
                return 0.0
            return sum(values) / len(values)

        def all(self):
            return all(bool(x) for x in self)

    def _to_array(data, dtype=None):
        if isinstance(data, _FakeArray):
            arr = _FakeArray(data)
        else:
            arr = _FakeArray(data)
        if dtype is not None:
            arr = arr.astype(dtype)
        return arr

    def _zeros(length, dtype=float):
        return _to_array((dtype(0) for _ in range(length)), dtype=dtype)

    def _isfinite(data):
        arr = _to_array(data, dtype=float)
        return _to_array((1 if math.isfinite(x) else 0 for x in arr), dtype=int)

    def _clip(data, lo, hi):
        arr = _to_array(data, dtype=float)
        return _to_array((min(max(x, lo), hi) for x in arr), dtype=float)

    def _abs(data):
        arr = _to_array(data, dtype=float)
        return _to_array((abs(x) for x in arr), dtype=float)

    def _max(data):
        arr = _to_array(data, dtype=float)
        return max(arr) if arr else 0.0

    fake_np = types.ModuleType("numpy")
    fake_np.float32 = float
    fake_np.asarray = _to_array
    fake_np.array = _to_array
    fake_np.zeros = _zeros
    fake_np.isfinite = _isfinite
    fake_np.clip = _clip
    fake_np.abs = _abs
    fake_np.max = _max
    fake_np.ceil = math.ceil
    sys.modules["numpy"] = fake_np
    np = fake_np

try:  # pragma: no cover
    import PIL  # type: ignore  # noqa: F401 - imported for side effects
except ModuleNotFoundError:  # pragma: no cover
    import types

    class _StubImage:
        def __init__(self, mode: str = "L", size=(0, 0)) -> None:
            self.mode = mode
            self.size = size

        def convert(self, mode: str):
            self.mode = mode
            return self

        def resize(self, size, resample=None):
            self.size = size
            return self

        def save(self, _path):
            return None

    def _fromarray(_arr, mode="L"):
        return _StubImage(mode=mode)

    image_module = types.ModuleType("PIL.Image")
    image_module.Image = _StubImage
    image_module.fromarray = _fromarray
    image_module.BICUBIC = 0

    pil_module = types.ModuleType("PIL")
    pil_module.Image = image_module

    sys.modules["PIL"] = pil_module
    sys.modules["PIL.Image"] = image_module

try:  # pragma: no cover
    import librosa  # type: ignore  # noqa: F401 - imported for side effects
except ModuleNotFoundError:  # pragma: no cover
    import types

    librosa_module = types.ModuleType("librosa")
    librosa_module.db_to_power = lambda x: x
    librosa_module.power_to_db = lambda x, ref=1.0: x

    feature_module = types.SimpleNamespace(
        melspectrogram=lambda **kwargs: [],
        inverse=types.SimpleNamespace(mel_to_audio=lambda **kwargs: []),
    )
    librosa_module.feature = feature_module

    sys.modules["librosa"] = librosa_module

try:  # pragma: no cover
    import soundfile  # type: ignore  # noqa: F401 - imported for side effects
except ModuleNotFoundError:  # pragma: no cover
    soundfile_module = types.ModuleType("soundfile")
    soundfile_module.write = lambda *args, **kwargs: None

    sys.modules["soundfile"] = soundfile_module

if "torch" not in sys.modules:  # pragma: no cover
    torch_module = types.ModuleType("torch")
    torch_module.cuda = SimpleNamespace(is_available=lambda: False)
    torch_module.backends = SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))
    sys.modules["torch"] = torch_module

if "blossom.audio.vocoders.hifigan" not in sys.modules:  # pragma: no cover
    hifigan_stub = types.ModuleType("blossom.audio.vocoders.hifigan")

    def _stub_load_hifigan(device: str = "cpu"):
        return object(), {}, None

    def _stub_mel_to_audio(*args, **kwargs):
        return []

    hifigan_stub.load_hifigan = _stub_load_hifigan
    hifigan_stub.mel_to_audio_hifigan = _stub_mel_to_audio
    sys.modules["blossom.audio.vocoders.hifigan"] = hifigan_stub

if "blossom.audio.riffusion.post" not in sys.modules:  # pragma: no cover
    post_stub = types.ModuleType("blossom.audio.riffusion.post")

    class EqSettings:
        def __init__(self, high_shelf_freq_hz: float = 5000.0, high_shelf_gain_db: float = 2.0, lowcut_hz: float = 35.0) -> None:
            self.high_shelf_freq_hz = high_shelf_freq_hz
            self.high_shelf_gain_db = high_shelf_gain_db
            self.lowcut_hz = lowcut_hz

    class ReverbSettings:
        def __init__(self, wet: float = 0.12) -> None:
            self.wet = wet

    class DitherSettings:
        def __init__(self) -> None:
            self.target_peak_dbfs = -1.0
            self.bit_depth = 16

    class ChainSettings:
        def __init__(self, eq: EqSettings | None = None, reverb: ReverbSettings | None = None, dither: DitherSettings | None = None) -> None:
            self.eq = eq or EqSettings()
            self.reverb = reverb or ReverbSettings()
            self.dither = dither or DitherSettings()

    def process_audio_chain(audio, sr, chain=None, seed=None):  # noqa: D401 - stub
        return audio

    def write_metadata_json(path, data):  # noqa: D401 - stub
        p = Path(path)
        meta_path = p.with_suffix(".json")
        meta_path.write_text("{}", encoding="utf-8")
        return meta_path.as_posix()

    post_stub.EqSettings = EqSettings
    post_stub.ReverbSettings = ReverbSettings
    post_stub.DitherSettings = DitherSettings
    post_stub.ChainSettings = ChainSettings
    post_stub.process_audio_chain = process_audio_chain
    post_stub.write_metadata_json = write_metadata_json
    sys.modules["blossom.audio.riffusion.post"] = post_stub

try:  # pragma: no cover
    import scipy  # type: ignore  # noqa: F401 - imported for side effects
except ModuleNotFoundError:  # pragma: no cover
    scipy_module = types.ModuleType("scipy")
    signal_module = types.ModuleType("scipy.signal")
    signal_module.fftconvolve = lambda *args, **kwargs: []
    signal_module.lfilter = lambda *args, **kwargs: []
    scipy_module.signal = signal_module
    sys.modules["scipy"] = scipy_module
    sys.modules["scipy.signal"] = signal_module


@pytest.mark.parametrize("use_tiles", [1])
def test_riffusion_cli_hub_hifigan_cpu(monkeypatch, tmp_path, use_tiles):
    """CLI should prefer HiFi-GAN even when only CPU is available."""

    from blossom.audio.riffusion import mel_codec
    from blossom.audio.riffusion import cli_riffusion
    from blossom.audio.riffusion import stitcher as stitcher_mod

    # Simulate CPU-only runtime by forcing torch device checks to fail for CUDA/MPS
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    mps_backend = getattr(torch.backends, "mps", None)
    if mps_backend is not None:
        monkeypatch.setattr(mps_backend, "is_available", lambda: False)

    # Stub heavy pipeline pieces so the CLI can run quickly inside the test
    class DummyTile:
        width = 16

        @staticmethod
        def save(_path: str) -> None:
            # No-op save to satisfy CLI expectations
            return None

    class DummyPipe:
        def __init__(self, cfg) -> None:  # noqa: D401 - simple stub
            self.cfg = cfg

        def generate_tile(self, **_kwargs):
            return DummyTile()

    monkeypatch.setattr(cli_riffusion, "RiffusionPipelineWrapper", DummyPipe)

    def fake_stitch(tiles, overlap_px):  # noqa: D401 - simple stub for stitching
        assert tiles  # ensure tiles were generated
        assert overlap_px >= 0
        return SimpleNamespace(width=DummyTile.width)

    monkeypatch.setattr(stitcher_mod, "stitch_tiles_horizontally", fake_stitch)

    def fake_image_to_mel(_stitched, target_shape):
        return SimpleNamespace(shape=target_shape)

    monkeypatch.setattr(mel_codec, "image_to_mel", fake_image_to_mel)

    calls: dict[str, object] = {}

    def fake_hub_load_hifigan(*, device: str):
        calls["load_device"] = device
        return object(), {"n_mel_channels": 80}, object()

    def fake_hub_mel_to_audio(mel, vsetup, _hifi, denoiser=None, device: str = "cpu"):
        calls["mel_device"] = device
        calls["mel_shape"] = mel.shape
        calls["denoiser"] = denoiser
        return np.zeros(32, dtype=np.float32)

    monkeypatch.setattr(cli_riffusion, "hub_load_hifigan", fake_hub_load_hifigan)
    monkeypatch.setattr(cli_riffusion, "hub_mel_to_audio", fake_hub_mel_to_audio)

    monkeypatch.setattr(
        cli_riffusion,
        "process_audio_chain",
        lambda audio, _sr, chain, seed=None: audio,
    )

    def fake_write_metadata_json(outfile: Path, metadata):
        meta_path = outfile.with_suffix(".json")
        meta_path.write_text("{}", encoding="utf-8")
        return meta_path

    monkeypatch.setattr(cli_riffusion, "write_metadata_json", fake_write_metadata_json)

    def fake_sf_write(path: str, data, sr, subtype):
        Path(path).write_bytes(b"RIFFUSION")

    monkeypatch.setattr(cli_riffusion.sf, "write", fake_sf_write)

    outfile = tmp_path / "riffusion.wav"

    argv = [
        "python",
        "--preset",
        "piano",
        "--tiles",
        str(use_tiles),
        "--hub_hifigan",
        "--outfile",
        str(outfile),
    ]
    monkeypatch.setattr(sys, "argv", argv)

    exit_code = cli_riffusion.main()

    assert exit_code == 0
    assert calls.get("load_device") == "cpu"
    assert calls.get("mel_device") == "cpu"

    log_path = outfile.with_suffix(".log")
    assert log_path.exists()
    log_text = log_path.read_text(encoding="utf-8")
    assert "vocoder: synthesizing audio (hub, device=cpu)" in log_text
    assert "vocoder_used: griffinlim" not in log_text

    assert outfile.exists()
    assert outfile.with_suffix(".json").exists()
