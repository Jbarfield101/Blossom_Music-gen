import random

import pytest

import brain.dm_tools as dm_tools
from brain.dm_tools import roll_dice


def test_roll_dice_handles_basic_arithmetic():
    rng = random.Random(42)
    assert roll_dice("2d6+3", rng=rng) == 10


def test_roll_dice_supports_subtraction():
    rng = random.Random(5)
    assert roll_dice("d20-2", rng=rng) == 18


def test_roll_dice_rejects_invalid_input():
    with pytest.raises(ValueError):
        roll_dice("")
    with pytest.raises(ValueError):
        roll_dice("abc")


def test_roll_dice_tool_delegates_run(monkeypatch):
    captured = {}

    def fake_roll(expr, rng=None):
        captured["expr"] = expr
        return 7

    monkeypatch.setattr(dm_tools, "roll_dice", fake_roll)
    tool = dm_tools.RollDiceTool()
    result = tool.run("2d4+1")
    assert result == {"result": 7}
    assert captured["expr"] == "2d4+1"

