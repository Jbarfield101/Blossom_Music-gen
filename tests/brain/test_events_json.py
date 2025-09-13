import json
from pathlib import Path
import sys
import pytest
import json
import types

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

requests_stub = types.SimpleNamespace(post=lambda *a, **k: None)
requests_stub.Response = type("Response", (), {})
requests_stub.exceptions = types.SimpleNamespace(
    HTTPError=Exception, RequestException=Exception, Timeout=Exception
)
sys.modules.setdefault("requests", requests_stub)
sys.modules.setdefault("requests.exceptions", requests_stub.exceptions)

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from brain import dialogue


def _setup(monkeypatch, response: str):
    monkeypatch.setattr(dialogue.prompt_router, "classify", lambda _: "other")
    monkeypatch.setattr(dialogue.ollama_client, "generate", lambda _: response)


def test_parses_valid_json(monkeypatch):
    payload = {
        "who": "hero",
        "action": "attack",
        "targets": ["dragon"],
        "effects": ["fire"],
        "narration": "The hero breathes fire on the dragon.",
    }
    _setup(monkeypatch, json.dumps(payload))
    event = dialogue.respond("Attack the dragon")
    assert event.who == "hero"
    assert event.action == "attack"
    assert event.targets == ["dragon"]
    assert event.effects == ["fire"]
    assert event.narration.startswith("The hero")
    assert json.loads(event.to_json()) == payload


def test_invalid_json_raises(monkeypatch):
    _setup(monkeypatch, "not-json")
    with pytest.raises(ValueError):
        dialogue.respond("Attack the dragon")
