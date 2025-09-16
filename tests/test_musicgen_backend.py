import logging
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import musicgen_backend


class DummyPipeline:
    def __init__(self, limit: int, fail_first: bool = False):
        self.limit = limit
        self.fail_first = fail_first
        self.calls = []
        self.model = SimpleNamespace(
            config=SimpleNamespace(max_position_embeddings=limit)
        )

    def __call__(self, prompt, generate_kwargs=None, **kwargs):
        if generate_kwargs is not None:
            tokens = generate_kwargs.get("max_new_tokens")
        else:
            tokens = kwargs.get("max_new_tokens")
            if tokens is None:
                tokens = kwargs.get("max_length")
        self.calls.append(tokens)

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
