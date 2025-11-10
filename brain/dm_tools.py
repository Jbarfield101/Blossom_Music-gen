"""Dungeon Master helper utilities surfaced as callable tools."""

from __future__ import annotations

import random
import re
from typing import Dict, Protocol

__all__ = ["roll_dice", "RollDiceTool"]

_TERM_PATTERN = re.compile(r"([+-]?)([^+-]+)")


def _validate_int(value: str, minimum: int = 1, maximum: int | None = None) -> int:
    """Convert ``value`` to ``int`` enforcing basic validation."""

    if not value:
        raise ValueError("Value is required.")
    try:
        number = int(value, 10)
    except ValueError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Invalid integer: {value}") from exc
    if number < minimum:
        raise ValueError(f"Value must be >= {minimum}.")
    if maximum is not None and number > maximum:
        raise ValueError(f"Value must be <= {maximum}.")
    return number


def roll_dice(expression: str, rng: random.Random | None = None) -> int:
    """Evaluate a dice expression such as ``2d6+3`` and return the total."""

    normalized = (expression or "").replace(" ", "").lower()
    if not normalized:
        raise ValueError("Provide a dice expression such as '2d6+3'.")

    if normalized[0] not in "+-":
        normalized = f"+{normalized}"
    active_rng = rng or random
    total = 0
    consumed = []

    for match in _TERM_PATTERN.finditer(normalized):
        sign_token, body = match.groups()
        consumed.append(match.group(0))
        sign = -1 if sign_token == "-" else 1
        if "d" in body:
            count_str, sides_str = body.split("d", 1)
            count = _validate_int(count_str, minimum=1, maximum=200) if count_str else 1
            sides = _validate_int(sides_str, minimum=2, maximum=1000)
            subtotal = sum(active_rng.randint(1, sides) for _ in range(count))
        else:
            subtotal = int(body, 10)
        total += sign * subtotal

    if "".join(consumed) != normalized:
        raise ValueError(f"Invalid dice expression: {expression!r}")

    return total


class Tool(Protocol):
    """Protocol describing callable helper tools."""

    name: str
    description: str
    input_schema: Dict[str, str]
    output_schema: Dict[str, str]

    def run(self, *args, **kwargs) -> Dict[str, int]:  # pragma: no cover - protocol
        ...


class RollDiceTool:
    """Roll dice using D&D notation (``XdY +/- modifier``)."""

    name = "rollDice"
    description = "Roll dice using notation like 2d6+3"
    input_schema = {"dice_expression": "string"}
    output_schema = {"result": "int"}

    def run(self, dice_expression: str) -> Dict[str, int]:
        """Execute the dice roller; suitable for tool calls from agents."""

        return {"result": roll_dice(dice_expression)}

