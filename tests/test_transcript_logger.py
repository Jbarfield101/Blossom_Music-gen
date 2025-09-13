import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ears import TranscriptLogger


def read_jsonl(path: Path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as fh:
        return [json.loads(l) for l in fh if l.strip()]


def test_append_and_summary(tmp_path):
    logger = TranscriptLogger(tmp_path)
    logger.append("chan", "alice", "hello", language="en", confidence=0.9)
    logger.append("chan", "bob", "hi", language="en", confidence=0.8)

    path = tmp_path / "chan.jsonl"
    entries = read_jsonl(path)
    assert entries[0]["text"] == "hello"
    assert entries[0]["language"] == "en"
    assert entries[1]["speaker"] == "bob"
    assert entries[1]["confidence"] == 0.8

    summary = logger.summary("chan")
    assert "alice: hello" in summary
    assert "bob: hi" in summary


def test_rotation_and_session_summary(tmp_path):
    logger = TranscriptLogger(tmp_path)
    logger.append("chan", "alice", "one")
    first_session = logger.rotate()

    rotated = tmp_path / f"chan.{first_session}.jsonl"
    assert rotated.exists()
    assert "one" in logger.summary("chan", first_session)

    logger.append("chan", "bob", "two")
    assert "two" in logger.summary("chan")
    assert "one" not in logger.summary("chan")
