from pathlib import Path
import sys
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

fake_service_api = types.SimpleNamespace(search=lambda q, tags=None: [])
sys.modules.setdefault("service_api", fake_service_api)

from brain import dnd_chat


def test_empty_message_returns_refusal():
    assert dnd_chat.chat("   ") == dnd_chat.REFUSAL_MESSAGE


def test_chat_forwards_string_response(monkeypatch):
    monkeypatch.setattr(
        dnd_chat.dialogue,
        "respond",
        lambda message, include_sources=True: "Saved note",
    )

    assert dnd_chat.chat("note tavern: The owner is friendly") == "Saved note"


def test_chat_wraps_event_response(monkeypatch):
    captured = {}

    def fake_respond(message: str, include_sources: bool = False):
        captured["message"] = message
        captured["include_sources"] = include_sources
        return types.SimpleNamespace(narration=f"Lore:{message}")

    monkeypatch.setattr(dnd_chat.dialogue, "respond", fake_respond)
    result = dnd_chat.chat("Tell me about the capital city")
    assert result == "Lore:Tell me about the capital city"
    assert captured["message"] == "Tell me about the capital city"
    assert captured["include_sources"] is True


def test_filesystem_probe_handles_lowercase(monkeypatch, tmp_path):
    import config.obsidian as obsidian

    lore_root = tmp_path / "DreadHaven"
    lore_root.mkdir()
    (lore_root / "goblins.md").write_text("The goblin lairs are dangerous.", encoding="utf-8")

    monkeypatch.setattr(obsidian, "get_vault", lambda: lore_root, raising=False)
    monkeypatch.setattr(dnd_chat, "DEFAULT_FALLBACK_VAULT", lore_root)

    assert dnd_chat._fallback_filesystem_probe("Please describe the goblin lairs.") is True


def test_has_relevant_context_falls_back_to_filesystem(monkeypatch, tmp_path):
    import config.obsidian as obsidian

    lore_root = tmp_path / "DreadHaven"
    lore_root.mkdir()
    (lore_root / "capital.md").write_text("The capital city has sprawling markets.", encoding="utf-8")

    def boom(*_args, **_kwargs):
        raise RuntimeError("no index")

    monkeypatch.setattr(obsidian, "get_vault", lambda: lore_root, raising=False)
    monkeypatch.setattr(dnd_chat, "DEFAULT_FALLBACK_VAULT", lore_root)
    monkeypatch.setattr(dnd_chat.service_api, "search", boom)

    assert dnd_chat._has_relevant_context("Tell me about the capital city", "note") is True
