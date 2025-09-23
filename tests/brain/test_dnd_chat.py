from pathlib import Path
import sys
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

fake_service_api = types.SimpleNamespace(search=lambda q, tags=None: [])
sys.modules.setdefault("service_api", fake_service_api)

from brain import dnd_chat


def test_refuses_when_no_context(monkeypatch):
    monkeypatch.setattr(dnd_chat.prompt_router, "classify", lambda msg: "note")
    monkeypatch.setattr(dnd_chat.service_api, "search", lambda q, tags=None: [])
    result = dnd_chat.chat("What's your favourite color?")
    assert result == dnd_chat.REFUSAL_MESSAGE


def test_calls_dialogue_for_lore(monkeypatch):
    monkeypatch.setattr(dnd_chat.prompt_router, "classify", lambda msg: "lore")

    captured = {}

    def fake_respond(message: str):
        captured["message"] = message
        return types.SimpleNamespace(narration="Lore:" + message)

    monkeypatch.setattr(dnd_chat.dialogue, "respond", fake_respond)
    output = dnd_chat.chat("Tell me about the capital city")
    assert output == "Lore:Tell me about the capital city"
    assert captured["message"] == "Tell me about the capital city"


def test_search_fallback_allows_dialogue(monkeypatch):
    monkeypatch.setattr(dnd_chat.prompt_router, "classify", lambda msg: "note")
    monkeypatch.setattr(
        dnd_chat.service_api,
        "search",
        lambda q, tags=None: [{"path": "world/towns.md", "content": "Town lore"}],
    )

    monkeypatch.setattr(
        dnd_chat.dialogue,
        "respond",
        lambda msg: types.SimpleNamespace(narration=f"NPC:{msg}"),
    )

    output = dnd_chat.chat("Who runs the Silver Spoon tavern?")
    assert output == "NPC:Who runs the Silver Spoon tavern?"


def test_dialogue_string_is_forwarded(monkeypatch):
    monkeypatch.setattr(dnd_chat.prompt_router, "classify", lambda msg: "npc")
    monkeypatch.setattr(dnd_chat.dialogue, "respond", lambda msg: "Saved note")
    output = dnd_chat.chat("note tavern: The owner is friendly")
    assert output == "Saved note"
