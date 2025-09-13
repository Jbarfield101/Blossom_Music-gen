from __future__ import annotations

"""Event dataclasses used for structured dialogue responses."""

from dataclasses import dataclass, field, asdict
from typing import List
import json


@dataclass
class Event:
    """Structured description of a dialogue event."""

    who: str
    action: str
    targets: List[str] = field(default_factory=list)
    effects: List[str] = field(default_factory=list)
    narration: str = ""

    @classmethod
    def from_json(cls, data: str) -> "Event":
        """Parse *data* and return an :class:`Event` instance.

        Raises :class:`ValueError` if ``data`` is not valid JSON or missing
        required fields.
        """

        try:
            payload = json.loads(data)
        except json.JSONDecodeError as exc:
            raise ValueError("Malformed JSON") from exc

        try:
            return cls(
                who=payload["who"],
                action=payload["action"],
                targets=list(payload.get("targets", [])),
                effects=list(payload.get("effects", [])),
                narration=payload.get("narration", ""),
            )
        except KeyError as exc:
            raise ValueError(f"Missing field: {exc.args[0]}") from exc

    def to_json(self) -> str:
        """Serialize the event to a JSON string."""

        return json.dumps(asdict(self))
