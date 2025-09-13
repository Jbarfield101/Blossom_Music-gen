import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from mouth.registry import VoiceProfile, VoiceRegistry


def test_registry_default_narrator(tmp_path):
    path = tmp_path / "voices.json"
    registry = VoiceRegistry(path)
    profile = registry.get_profile("narrator")
    assert profile.voice_id == "narrator"


def test_registry_unknown_voice(tmp_path):
    path = tmp_path / "voices.json"
    registry = VoiceRegistry(path)
    profile = registry.get_profile("custom")
    assert profile.voice_id == "custom"
    registry.save()
    data = json.loads(path.read_text())
    assert "custom" in data


def test_registry_roundtrip(tmp_path):
    path = tmp_path / "voices.json"
    registry = VoiceRegistry(path)
    registry.set_profile("alice", VoiceProfile("alice", speed=1.2, emotion="happy"))
    registry.save()

    loaded = VoiceRegistry(path)
    profile = loaded.get_profile("alice")
    assert profile.speed == 1.2
    assert profile.emotion == "happy"
