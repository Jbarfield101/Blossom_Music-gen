import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from mouth.registry import VoiceRegistry


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
