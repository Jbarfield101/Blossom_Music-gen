import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import musicgen_backend


class DummyPipeline:
    def __init__(self, limit: int, fail_first: bool = False):
        self.limit = limit
        self.fail_first = fail_first
        self.calls = []
        self.kwargs = []
        self.extra_kwargs = []
        self.generate_kwargs = []
        self.model = SimpleNamespace(
            config=SimpleNamespace(max_position_embeddings=limit)
        )

    def __call__(self, prompt, forward_params=None, generate_kwargs=None, **kwargs):
        tokens = None
        if generate_kwargs is not None:
            tokens = generate_kwargs.get("max_new_tokens")
        self.calls.append(tokens)
        params = dict(forward_params or {})
        self.kwargs.append(params)
        self.extra_kwargs.append(dict(kwargs))
        self.generate_kwargs.append(dict(generate_kwargs or {}))

        if tokens is None:
            raise AssertionError("max_new_tokens was not provided to the pipeline")

        if tokens > self.limit:
            raise IndexError("Token count exceeded model limit")

        if self.fail_first:
            self.fail_first = False
            raise RuntimeError("Indexing.cu runtime failure")

        return [{"audio": [0.0, 0.0], "sampling_rate": 16000}]


def test_generate_music_clamps_to_model_limit(monkeypatch, tmp_path, caplog):
    caplog.set_level(logging.WARNING)

    gpu_pipe = DummyPipeline(limit=10, fail_first=True)
    cpu_pipe = DummyPipeline(limit=10)

    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    def fake_get_pipeline(model_name, device_override=None):
        if device_override == -1:
            return cpu_pipe
        return gpu_pipe

    monkeypatch.setattr(musicgen_backend, "_get_pipeline", fake_get_pipeline)

    written = {}

    def fake_write_wav(path, sample_rate, audio):
        written["path"] = path
        written["rate"] = sample_rate
        written["audio"] = audio

    monkeypatch.setattr(musicgen_backend, "write_wav", fake_write_wav)

    output_path = musicgen_backend.generate_music(
        prompt="test",
        duration=1.0,
        model_name="small",
        temperature=1.0,
        output_dir=str(tmp_path),
    )

    assert output_path
    assert written["rate"] == 16000
    assert written["audio"] == [0.0, 0.0]
    assert gpu_pipe.calls[0] == 10
    assert cpu_pipe.calls[0] == 10
    assert any("truncating" in record.message for record in caplog.records)


def test_melody_model_requires_reference(monkeypatch, tmp_path):
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    dummy_pipe = DummyPipeline(limit=10)

    monkeypatch.setattr(musicgen_backend, "_get_pipeline", lambda *_args, **_kwargs: dummy_pipe)
    monkeypatch.setattr(musicgen_backend, "write_wav", lambda *_args, **_kwargs: None)

    with pytest.raises(ValueError) as excinfo:
        musicgen_backend.generate_music(
            prompt="test",
            duration=1.0,
            model_name="melody",
            temperature=1.0,
            output_dir=str(tmp_path),
        )

    assert "melody" in str(excinfo.value).lower()


def test_non_melody_model_ignores_reference(monkeypatch, tmp_path):
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    dummy_pipe = DummyPipeline(limit=10)

    monkeypatch.setattr(musicgen_backend, "_get_pipeline", lambda *_args, **_kwargs: dummy_pipe)

    written = {}

    def fake_write_wav(path, sample_rate, audio):
        written["path"] = path
        written["rate"] = sample_rate
        written["audio"] = audio

    monkeypatch.setattr(musicgen_backend, "write_wav", fake_write_wav)

    output_path = musicgen_backend.generate_music(
        prompt="test",
        duration=1.0,
        model_name="small",
        temperature=1.0,
        output_dir=str(tmp_path),
        melody_path="/tmp/fake.wav",
    )

    assert output_path
    assert dummy_pipe.kwargs[0].get("audio") is None
    assert dummy_pipe.extra_kwargs[0] == {}
    assert "rate" in written


@pytest.mark.skipif(musicgen_backend.np is None, reason="numpy not available")
def test_melody_audio_forwarded(monkeypatch, tmp_path):
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    dummy_pipe = DummyPipeline(limit=10)

    monkeypatch.setattr(musicgen_backend, "_get_pipeline", lambda *_args, **_kwargs: dummy_pipe)

    arr = musicgen_backend.np.array([0, 32767, -32768], dtype=musicgen_backend.np.int16)

    def fake_read_wav(path):
        return 16000, arr

    monkeypatch.setattr(musicgen_backend, "read_wav", fake_read_wav)

    written = {}

    def fake_write_wav(path, sample_rate, audio):
        written["path"] = path
        written["rate"] = sample_rate
        written["audio"] = audio

    monkeypatch.setattr(musicgen_backend, "write_wav", fake_write_wav)

    clip_path = tmp_path / "clip.wav"
    clip_path.write_bytes(b"stub")

    output_path = musicgen_backend.generate_music(
        prompt="melody",
        duration=1.0,
        model_name="melody",
        temperature=1.0,
        output_dir=str(tmp_path),
        melody_path=str(clip_path),
    )

    assert output_path
    first_kwargs = dummy_pipe.kwargs[0]
    assert "audio" in first_kwargs
    assert "sampling_rate" in first_kwargs
    assert first_kwargs["sampling_rate"] == 16000
    assert isinstance(first_kwargs["audio"], musicgen_backend.np.ndarray)
    assert first_kwargs["audio"].dtype == musicgen_backend.np.float32
    assert musicgen_backend.np.isclose(first_kwargs["audio"][1], 32767.0 / 32768.0)
    assert musicgen_backend.np.isclose(first_kwargs["audio"][2], -1.0)
    assert dummy_pipe.extra_kwargs[0] == {}
    assert dummy_pipe.generate_kwargs[0]["temperature"] == 1.0
def test_get_pipeline_retries_without_safetensors(monkeypatch):
    calls = []

    class MissingSafetensorsError(RuntimeError):
        pass

    def fake_pipeline(task, **kwargs):
        assert task == "text-to-audio"
        captured = {
            **kwargs,
            "model_kwargs": dict(kwargs.get("model_kwargs", {})),
        }
        calls.append(captured)
        if captured["model_kwargs"].get("use_safetensors"):
            raise MissingSafetensorsError("safetensors not available")
        return SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace()))

    monkeypatch.setattr(musicgen_backend, "pipeline", fake_pipeline)
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})
    monkeypatch.setattr(
        musicgen_backend,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
    )

    pipe = musicgen_backend._get_pipeline("small")

    assert pipe is not None
    assert len(calls) == 2
    assert "use_safetensors" not in calls[0]
    assert "dtype" not in calls[0]
    assert "torch_dtype" not in calls[0]
    assert calls[0]["model_kwargs"]["use_safetensors"] is True
    assert "use_safetensors" not in calls[1]
    assert "dtype" not in calls[1]
    assert "torch_dtype" not in calls[1]
    assert calls[1]["model_kwargs"]["use_safetensors"] is False


def test_bin_only_models_skip_safetensors(monkeypatch):
    calls = []

    def fake_pipeline(task, **kwargs):
        assert task == "text-to-audio"
        captured = {
            **kwargs,
            "model_kwargs": dict(kwargs.get("model_kwargs", {})),
        }
        if captured["model_kwargs"].get("use_safetensors"):
            raise OSError("legacy format requires .bin weights")
        calls.append(captured)
        return SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace()))

    monkeypatch.setattr(musicgen_backend, "pipeline", fake_pipeline)
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})
    monkeypatch.setattr(
        musicgen_backend,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
    )

    pipe = musicgen_backend._get_pipeline("medium")

    assert pipe is not None
    assert len(calls) == 1
    assert "use_safetensors" not in calls[0]
    assert "dtype" not in calls[0]
    assert "torch_dtype" not in calls[0]
    assert calls[0]["model_kwargs"]["use_safetensors"] is False


def test_get_pipeline_gpu_dtype_passed_via_model_kwargs(monkeypatch):
    calls = []
    torch_float32 = object()

    def fake_pipeline(task, **kwargs):
        assert task == "text-to-audio"
        captured = {
            **kwargs,
            "model_kwargs": dict(kwargs.get("model_kwargs", {})),
        }
        calls.append(captured)
        return SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace()))

    stub_torch = SimpleNamespace(
        __version__="2.5.0",
        float16=object(),
        float32=torch_float32,
        cuda=SimpleNamespace(is_available=lambda: True),
    )

    monkeypatch.setattr(musicgen_backend, "pipeline", fake_pipeline)
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})
    monkeypatch.setattr(musicgen_backend, "torch", stub_torch)
    monkeypatch.setenv("MUSICGEN_FORCE_GPU", "0")
    monkeypatch.delenv("MUSICGEN_FP16", raising=False)

    pipe = musicgen_backend._get_pipeline("small")

    assert pipe is not None
    assert len(calls) == 1
    call = calls[0]
    assert "use_safetensors" not in call
    assert "dtype" not in call
    assert "torch_dtype" not in call
    assert call["model_kwargs"]["use_safetensors"] is True
    assert call["model_kwargs"]["torch_dtype"] is torch_float32


def test_get_pipeline_rejects_old_torch_versions(monkeypatch):
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    def fail_pipeline(*_args, **_kwargs):
        raise AssertionError("pipeline should not be constructed under unsupported torch")

    monkeypatch.setattr(musicgen_backend, "pipeline", fail_pipeline)

    stub_torch = SimpleNamespace(
        __version__="2.4.1",
        cuda=SimpleNamespace(is_available=lambda: False),
    )
    monkeypatch.setattr(musicgen_backend, "torch", stub_torch)

    with pytest.raises(RuntimeError) as excinfo:
        musicgen_backend._get_pipeline("medium")

    assert "torch>=2.5" in str(excinfo.value)


def test_get_pipeline_allows_supported_torch_versions(monkeypatch):
    monkeypatch.setattr(musicgen_backend, "_PIPELINE_CACHE", {})

    def fake_pipeline(task, **kwargs):
        assert task == "text-to-audio"
        return SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace()))

    monkeypatch.setattr(musicgen_backend, "pipeline", fake_pipeline)

    stub_torch = SimpleNamespace(
        __version__="2.5.0",
        cuda=SimpleNamespace(is_available=lambda: False),
    )
    monkeypatch.setattr(musicgen_backend, "torch", stub_torch)

    pipe = musicgen_backend._get_pipeline("medium")

    assert pipe is not None
