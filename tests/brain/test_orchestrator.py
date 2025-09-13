from pathlib import Path
import sys
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Provide lightweight stubs to avoid heavy dependencies during import.
fake_service_api = types.SimpleNamespace(search=lambda q, tags=None: [])
sys.modules.setdefault("service_api", fake_service_api)

fake_requests = types.SimpleNamespace(post=lambda *a, **k: None)
class _Resp:  # minimal placeholder for requests.Response
    pass
fake_requests.Response = _Resp
fake_requests.exceptions = types.SimpleNamespace(
    HTTPError=Exception, RequestException=Exception, Timeout=Exception
)
sys.modules.setdefault("requests", fake_requests)
sys.modules.setdefault("requests.exceptions", fake_requests.exceptions)

from brain import orchestrator, dialogue, ollama_client


def _patch_ollama(monkeypatch):
    captured = {}

    def fake_generate(prompt: str) -> str:
        captured["prompt"] = prompt
        return f"LLM:{prompt}"

    monkeypatch.setattr(ollama_client, "generate", fake_generate)
    monkeypatch.setattr(dialogue.ollama_client, "generate", fake_generate)
    monkeypatch.setattr(orchestrator.ollama_client, "generate", fake_generate)
    return captured


def test_dialogue_flow(monkeypatch):
    captured = _patch_ollama(monkeypatch)
    event = orchestrator.respond("Hello there")
    assert event["type"] == "dialogue"
    assert event["content"] == f"LLM:{captured['prompt']}"
    assert captured["prompt"] == "Hello there"


def test_note_flow(monkeypatch):
    captured = _patch_ollama(monkeypatch)
    event = orchestrator.respond("Note to self: buy milk")
    assert event["type"] == "note"
    assert event["content"] == f"LLM:{captured['prompt']}"
    assert "buy milk" in captured["prompt"]
