"""Service layer for interacting with calendar events."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, Iterable, List, Optional

from sqlalchemy.orm import Session

from .models import CalendarEvent, SessionLocal, DEFAULT_STATUS

DateInput = Optional[Any]

__all__ = [
    "create_event",
    "delete_event",
    "get_events",
    "update_event",
]


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Context manager that yields a SQLAlchemy session."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _parse_datetime(value: DateInput) -> Optional[datetime]:
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    raise TypeError(f"Unsupported datetime value: {value!r}")


def _coerce_offset(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(float(value))
    return None


def _event_to_dict(event: CalendarEvent) -> Dict[str, Any]:
    def _serialize(dt: Optional[datetime]) -> Optional[str]:
        return dt.isoformat() if dt else None

    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "start_time": _serialize(event.start_time),
        "end_time": _serialize(event.end_time),
        "recurrence": event.recurrence,
        "reminder_offset": event.reminder_offset,
        "status": event.status,
    }


def _notify_scheduler(action: str, payload: Any) -> None:
    try:
        from . import reminders
    except Exception:  # pragma: no cover - defensive
        return

    scheduler = reminders.get_scheduler(create=False)
    if not scheduler:
        return

    if action == "schedule":
        scheduler.schedule_event(payload)
    elif action == "remove":
        scheduler.remove_event(payload)


def create_event(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new calendar event and return it as a serializable dict."""
    required_fields = ("title", "start_time")
    missing = [field for field in required_fields if field not in data]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    start = _parse_datetime(data.get("start_time"))
    if start is None:
        raise ValueError("start_time must be a valid datetime value")

    with get_session() as session:
        event = CalendarEvent(
            title=str(data["title"]),
            description=data.get("description"),
            start_time=start,
            end_time=_parse_datetime(data.get("end_time")),
            recurrence=(data.get("recurrence") or None),
            reminder_offset=_coerce_offset(data.get("reminder_offset")),
            status=str(data.get("status") or DEFAULT_STATUS),
        )
        session.add(event)
        session.flush()
        session.refresh(event)
        result = _event_to_dict(event)

    _notify_scheduler("schedule", result)
    return result


def get_events() -> List[Dict[str, Any]]:
    """Return all calendar events as serializable dicts."""
    with get_session() as session:
        events: Iterable[CalendarEvent] = (
            session.query(CalendarEvent).order_by(CalendarEvent.start_time).all()
        )
        return [_event_to_dict(event) for event in events]


def update_event(event_id: int, changes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update an event and return the new representation."""
    with get_session() as session:
        event: Optional[CalendarEvent] = session.get(CalendarEvent, event_id)
        if not event:
            return None

        if "title" in changes and changes["title"] is not None:
            event.title = str(changes["title"])
        if "description" in changes:
            event.description = changes["description"]
        if "start_time" in changes:
            parsed = _parse_datetime(changes["start_time"])
            if parsed is None:
                raise ValueError("start_time must be a valid datetime value")
            event.start_time = parsed
        if "end_time" in changes:
            event.end_time = _parse_datetime(changes["end_time"])
        if "recurrence" in changes:
            event.recurrence = changes.get("recurrence") or None
        if "reminder_offset" in changes:
            event.reminder_offset = _coerce_offset(changes.get("reminder_offset"))
        if "status" in changes and changes["status"]:
            event.status = str(changes["status"])

        session.flush()
        session.refresh(event)
        result = _event_to_dict(event)

    if result["status"] and result["status"].lower() in {"cancelled", "canceled"}:
        _notify_scheduler("remove", event_id)
    else:
        _notify_scheduler("schedule", result)
    return result


def delete_event(event_id: int) -> bool:
    """Delete an event by identifier."""
    with get_session() as session:
        event: Optional[CalendarEvent] = session.get(CalendarEvent, event_id)
        if not event:
            return False
        session.delete(event)

    _notify_scheduler("remove", event_id)
    return True
