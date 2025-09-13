from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from brain.prompt_router import classify


def test_classify_npc():
    assert classify("Hello there!") == "npc"


def test_classify_rules():
    msg = "The rules state that all entries must be kept tidy."
    assert classify(msg) == "rules"


def test_classify_lore():
    msg = "Ancient lore tells of the hero's journey."
    assert classify(msg) == "lore"


def test_classify_note():
    assert classify("Note to self: buy milk.") == "note"
