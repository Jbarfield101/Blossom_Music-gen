import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

sys.modules.setdefault(
    "numpy",
    types.SimpleNamespace(
        asarray=lambda *a, **k: [],
        array=lambda *a, **k: [],
        vstack=lambda xs: xs,
        arange=lambda n: list(range(n)),
    ),
)

sys.modules.setdefault(
    "watchfiles",
    types.SimpleNamespace(Change=object, watch=lambda *a, **k: None),
)

requests_stub = types.ModuleType("requests")
requests_stub.Response = type("Response", (), {})
requests_stub.post = lambda *a, **k: None
requests_stub.get = lambda *a, **k: None
exceptions_stub = types.ModuleType("exceptions")
exceptions_stub.HTTPError = Exception
exceptions_stub.RequestException = Exception
exceptions_stub.Timeout = Exception
requests_stub.exceptions = exceptions_stub
sys.modules.setdefault("requests", requests_stub)
sys.modules.setdefault("requests.exceptions", exceptions_stub)

import service_api
from brain import dialogue, ollama_client


def test_dialogue_creates_note(tmp_path, monkeypatch):
    # Redirect vault path and LLM generate
    monkeypatch.setattr(service_api, "get_vault", lambda: tmp_path)
    monkeypatch.setattr(dialogue.service_api, "get_vault", lambda: tmp_path)

    called = {}
    def fake_generate(prompt: str) -> str:
        called["prompt"] = prompt
        return prompt
    monkeypatch.setattr(ollama_client, "generate", fake_generate)
    monkeypatch.setattr(dialogue.ollama_client, "generate", fake_generate)

    out = dialogue.respond("note journal/today.md: Remember the milk")

    note_file = tmp_path / "journal" / "today.md"
    assert note_file.exists()
    assert "Remember the milk" in note_file.read_text(encoding="utf-8")
    assert out == "Saved note to journal/today.md"
    assert called == {}
