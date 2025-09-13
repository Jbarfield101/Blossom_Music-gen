from pathlib import Path
import sys
import types
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Minimal stubs for optional dependencies
numpy_stub = types.ModuleType("numpy")
numpy_stub.asarray = lambda x, dtype=None: x
numpy_stub.array = lambda x, dtype=None: x
numpy_stub.vstack = lambda x: x
numpy_stub.float32 = float
numpy_stub.int64 = int
numpy_stub.arange = lambda n: list(range(n))
sys.modules["numpy"] = numpy_stub

requests_stub = types.ModuleType("requests")
class _Resp:
    def iter_lines(self):
        return []
    def raise_for_status(self):
        pass
requests_stub.Response = _Resp
requests_stub.post = lambda *a, **k: _Resp()
req_exc = types.ModuleType("exceptions")
class HTTPError(Exception):
    pass
class RequestException(Exception):
    pass
class Timeout(Exception):
    pass
req_exc.HTTPError = HTTPError
req_exc.RequestException = RequestException
req_exc.Timeout = Timeout
sys.modules["requests"] = requests_stub
sys.modules["requests.exceptions"] = req_exc

watch_stub = types.ModuleType("watchfiles")
class Change:
    added = 1
    modified = 2
    deleted = 3
watch_stub.Change = Change
watch_stub.watch = lambda *a, **k: iter(())
sys.modules["watchfiles"] = watch_stub

import service_api
from brain import dialogue, ollama_client
from brain.events import Event


def _patch_common(monkeypatch, chunks):
    def fake_search(query, tags=None):
        tag = tags[0] if tags else None
        return [
            {"content": ch["content"]}
            for ch in chunks
            if tag in ch["tags"]
        ]

    monkeypatch.setattr(service_api, "search", fake_search)
    monkeypatch.setattr(dialogue.service_api, "search", fake_search)

    captured = {}

    def fake_generate(prompt: str) -> str:
        captured["prompt"] = prompt
        return (
            '{"who": "npc", "action": "say", "targets": [], '
            '"effects": [], "narration": "hello"}'
        )

    monkeypatch.setattr(ollama_client, "generate", fake_generate)
    monkeypatch.setattr(dialogue.ollama_client, "generate", fake_generate)
    return captured


def test_lore_injection(monkeypatch):
    chunks = [
        {
            "id": "c1",
            "path": "lore/dragons.md",
            "heading": "Dragons",
            "content": "Dragons are ancient creatures.\nThey rule the sky.",
            "vector_id": 0,
            "tags": ["lore"],
        },
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 1,
            "tags": ["npc"],
        },
    ]
    captured = _patch_common(monkeypatch, chunks)

    event = dialogue.respond("Tell me some lore about dragons")
    assert isinstance(event, Event)
    assert "Relevant notes:" in captured["prompt"]
    assert "- Dragons are ancient creatures." in captured["prompt"]


def test_npc_injection(monkeypatch):
    chunks = [
        {
            "id": "c1",
            "path": "lore/dragons.md",
            "heading": "Dragons",
            "content": "Dragons are ancient creatures.\nThey rule the sky.",
            "vector_id": 0,
            "tags": ["lore"],
        },
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 1,
            "tags": ["npc"],
        },
    ]
    captured = _patch_common(monkeypatch, chunks)

    event = dialogue.respond("Hello, what do I know about the king?")
    assert isinstance(event, Event)
    assert "Relevant notes:" in captured["prompt"]
    assert "- King Arthur" in captured["prompt"]


def test_no_notes_fallback(monkeypatch):
    chunks = [
        {
            "id": "c2",
            "path": "npcs/king.md",
            "heading": "King",
            "content": "- King Arthur\n- Ruler of Camelot\n- Brave and wise",
            "vector_id": 0,
            "tags": ["npc"],
        }
    ]
    captured = _patch_common(monkeypatch, chunks)

    msg = "Tell me some lore about dragons"
    event = dialogue.respond(msg)
    assert isinstance(event, Event)
    assert captured["prompt"].startswith(msg)
    assert "Respond with a JSON object" in captured["prompt"]


def test_parses_event(monkeypatch):
    resp = (
        '{"who": "alice", "action": "wave", "targets": ["bob"], '
        '"effects": ["smile"], "narration": "Alice waves."}'
    )
    monkeypatch.setattr(ollama_client, "generate", lambda prompt: resp)
    monkeypatch.setattr(dialogue.ollama_client, "generate", lambda prompt: resp)
    monkeypatch.setattr(dialogue.prompt_router, "classify", lambda _: "other")
    event = dialogue.respond("Wave to Bob")
    assert event == Event(
        who="alice",
        action="wave",
        targets=["bob"],
        effects=["smile"],
        narration="Alice waves.",
    )


def test_malformed_json(monkeypatch):
    resp = '{"who": "alice", "action": "wave"'
    monkeypatch.setattr(ollama_client, "generate", lambda prompt: resp)
    monkeypatch.setattr(dialogue.ollama_client, "generate", lambda prompt: resp)
    monkeypatch.setattr(dialogue.prompt_router, "classify", lambda _: "other")
    with pytest.raises(ValueError):
        dialogue.respond("Wave to Bob")
