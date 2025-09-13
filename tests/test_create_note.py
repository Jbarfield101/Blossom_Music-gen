from pathlib import Path
import re

import sys
import types

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

import service_api


def test_create_note(tmp_path, monkeypatch):
    monkeypatch.setattr(service_api, "get_vault", lambda: tmp_path)
    note_path = "logs/today.md"
    service_api.create_note(note_path, "Hello world")
    note_file = tmp_path / note_path
    assert note_file.exists()
    content = note_file.read_text(encoding="utf-8")
    assert "Hello world" in content
    assert re.search(r"## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", content)
