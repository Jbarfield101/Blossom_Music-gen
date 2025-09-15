import json
import os
import re
import subprocess
import sys

from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from mouth.registry import VoiceProfile, VoiceRegistry


def discover_piper_voices(executable: str = "piper") -> list[str]:
    """Return available Piper voices by invoking ``piper --list``."""
    proc = subprocess.run([executable, "--list"], stdout=subprocess.PIPE, check=True)
    pattern = re.compile(r"^([A-Za-z0-9_-]+)")
    lines = proc.stdout.decode().splitlines()
    return [m.group(1) for line in lines if (m := pattern.match(line))]


def test_discover_piper_voices(monkeypatch):
    output = (
        b"en_US-amy-medium\tDescription\n"
        b"fr_FR-siwis-medium\tAnother\n"
    )
    run = MagicMock(return_value=SimpleNamespace(stdout=output))
    monkeypatch.setattr(subprocess, "run", run)
    voices = discover_piper_voices()
    assert voices == ["en_US-amy-medium", "fr_FR-siwis-medium"]
    run.assert_called_once_with(["piper", "--list"], stdout=subprocess.PIPE, check=True)


def test_voice_profile_crud(tmp_path):
    path = tmp_path / "voices.json"
    registry = VoiceRegistry(path)
    # add
    registry.set_profile("amy", VoiceProfile("en_US-amy-medium", tags=["a"]))
    registry.save()
    data = json.loads(path.read_text())
    assert "amy" in data and data["amy"]["voice_id"] == "en_US-amy-medium"
    # list
    loaded = VoiceRegistry(path)
    assert sorted(loaded._profiles.keys()) == ["amy", "narrator"]
    # edit (rename and update tags)
    profile = loaded._profiles.pop("amy")
    profile.tags = ["b"]
    loaded._profiles["bob"] = profile
    loaded.save()
    data = json.loads(path.read_text())
    assert "amy" not in data and data["bob"]["tags"] == ["b"]
    # remove
    del loaded._profiles["bob"]
    loaded.save()
    data = json.loads(path.read_text())
    assert "bob" not in data
