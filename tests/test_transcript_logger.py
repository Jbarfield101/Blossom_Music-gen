import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ears.transcript_logger import TranscriptLogger


def test_transcript_logger_write_and_rotate(tmp_path: Path) -> None:
    logger1 = TranscriptLogger("chan", root=str(tmp_path))
    logger1.log("alice", 0.0, 1.0, "hello", lang="en", confidence=0.9)

    first_file = tmp_path / "chan.jsonl"
    assert first_file.exists()
    with open(first_file, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["text"] == "hello"

    logger2 = TranscriptLogger("chan", root=str(tmp_path))
    rotated = list(tmp_path.glob("chan.*.jsonl"))
    assert rotated and rotated[0].name != "chan.jsonl"
    assert not (tmp_path / "chan.jsonl").exists()

    logger2.log("bob", 1.0, 2.0, "hi", lang="en", confidence=0.8)
    new_lines = (tmp_path / "chan.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(new_lines) == 1
    assert json.loads(new_lines[0])["text"] == "hi"

    summary = logger2.summary()
    texts = {entry["text"] for entry in summary}
    assert texts == {"hello", "hi"}
