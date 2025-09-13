from __future__ import annotations

"""Data models for narrative events used by :mod:`brain.dialogue`."""

from dataclasses import dataclass, field, asdict
from typing import List
import json


@dataclass
class Event:
    """Structured representation of a narrative event.

    Attributes
    ----------
    who:
        The actor performing the action.
    action:
        Description of the action being taken.
    targets:
        Entities that are the targets of the action.
    effects:
        Consequences that result from the action.
    narration:
        Natural language description of the event.
    """

    who: str
    action: str
    targets: List[str] = field(default_factory=list)
    effects: List[str] = field(default_factory=list)
    narration: str = ""

    @classmethod
    def from_json(cls, data: str | dict) -> "Event":
        """Create an :class:`Event` from a JSON string or dictionary.

        Raises
        ------
        ValueError
            If the JSON is malformed or missing required fields.
        """

        if isinstance(data, str):
            try:
                payload = json.loads(data)
            except json.JSONDecodeError as exc:  # pragma: no cover - error path
                raise ValueError("Invalid JSON") from exc
        else:
            payload = data
        try:
            return cls(
                who=payload["who"],
                action=payload["action"],
                targets=list(payload.get("targets", [])),
                effects=list(payload.get("effects", [])),
                narration=payload.get("narration", ""),
            )
        except KeyError as exc:  # pragma: no cover - error path
            raise ValueError(f"Missing field: {exc.args[0]}") from exc
        except TypeError as exc:  # pragma: no cover - error path
            raise ValueError("Invalid event fields") from exc

    def to_json(self) -> str:
        """Return a JSON representation of the event."""

        return json.dumps(asdict(self))
