from pathlib import Path
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

sys.modules.setdefault("requests", types.SimpleNamespace(get=lambda *a, **k: None))

import service_api
from ears.transcript_logger import TranscriptLogger
import session_export


def test_session_export_creates_note(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    monkeypatch.setattr(service_api, "get_vault", lambda: vault)

    transcripts = tmp_path / "transcripts"
    logger = TranscriptLogger(transcripts)
    logger.append("general", "GM", "Hello there")

    class FakeResp:
        def json(self):
            return [{"ts": 1, "desc": "Goblin attacks"}]

        def raise_for_status(self):
            pass

    monkeypatch.setattr(session_export.requests, "get", lambda url, timeout=10: FakeResp())

    note_path = session_export.export_session(transcript_root=transcripts, combat_url="http://tracker")
    assert note_path.exists()
    content = note_path.read_text(encoding="utf-8")
    assert "Goblin attacks" in content
    assert "GM: Hello there" in content
