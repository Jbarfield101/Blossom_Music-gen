"""Reminder scheduling for calendar events."""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger

from .models import DEFAULT_STATUS

EventDict = Dict[str, Any]
ReminderCallback = Callable[[EventDict], None]

__all__ = [
    "ReminderScheduler",
    "get_scheduler",
    "init_scheduler",
    "shutdown_scheduler",
]

_RECURRENCE_DELTAS = {
    "secondly": timedelta(seconds=1),
    "minutely": timedelta(minutes=1),
    "hourly": timedelta(hours=1),
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
}


def _normalize_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    raise TypeError(f"Unsupported datetime value: {value!r}")


class ReminderScheduler:
    """Background scheduler for calendar reminders."""

    def __init__(
        self,
        callback: Optional[ReminderCallback] = None,
        loader: Optional[Callable[[], List[EventDict]]] = None,
    ) -> None:
        self._callback = callback or (lambda event: None)
        self._loader = loader or self._default_loader
        self._scheduler = BackgroundScheduler(daemon=True)
        self._lock = threading.RLock()
        self._jobs: Dict[int, str] = {}
        self._scheduler.start()
        self.refresh_all()

    def shutdown(self) -> None:
        with self._lock:
            if self._scheduler.running:
                self._scheduler.shutdown(wait=False)
            self._jobs.clear()

    def refresh_all(self) -> None:
        """Reload events from storage and reschedule reminders."""
        events = self._loader()
        with self._lock:
            for job_id in list(self._jobs.values()):
                if self._scheduler.get_job(job_id):
                    self._scheduler.remove_job(job_id)
            self._jobs.clear()
            for event in events:
                self.schedule_event(event)

    def schedule_event(self, event: EventDict) -> None:
        """Schedule reminders for a single event."""
        event_id = event.get("id")
        if event_id is None:
            return
        with self._lock:
            self.remove_event(event_id)
            schedule = self._next_occurrence(event)
            if not schedule:
                return
            run_at, start_time = schedule
            job_id = self._job_id(event_id)
            trigger = DateTrigger(run_date=run_at)
            self._scheduler.add_job(
                self._fire_and_reschedule,
                trigger=trigger,
                id=job_id,
                args=[event, start_time],
                replace_existing=True,
            )
            self._jobs[event_id] = job_id

    def remove_event(self, event_id: int) -> None:
        with self._lock:
            job_id = self._jobs.pop(event_id, None)
            if job_id and self._scheduler.get_job(job_id):
                self._scheduler.remove_job(job_id)

    def _fire_and_reschedule(self, event: EventDict, start_time: datetime) -> None:
        event_copy = dict(event)
        event_copy.setdefault("status", DEFAULT_STATUS)
        event_copy["start_time"] = start_time.isoformat()
        self._callback(event_copy)
        next_schedule = self._next_occurrence(event, after=start_time)
        if not next_schedule:
            with self._lock:
                self._jobs.pop(event.get("id"), None)
            return
        run_at, next_start = next_schedule
        with self._lock:
            job_id = self._job_id(event.get("id"))
            trigger = DateTrigger(run_date=run_at)
            self._scheduler.add_job(
                self._fire_and_reschedule,
                trigger=trigger,
                id=job_id,
                args=[event, next_start],
                replace_existing=True,
            )
            self._jobs[event.get("id")] = job_id

    def _next_occurrence(
        self, event: EventDict, after: Optional[datetime] = None
    ) -> Optional[Tuple[datetime, datetime]]:
        after = after or datetime.utcnow()
        start_time = _normalize_datetime(event.get("start_time"))
        end_time = _normalize_datetime(event.get("end_time"))
        status = (event.get("status") or DEFAULT_STATUS).lower()
        if status in {"cancelled", "canceled", "completed", "disabled"}:
            return None
        recurrence = (event.get("recurrence") or "none").lower()
        offset_seconds = int(event.get("reminder_offset") or 0)
        reminder_delta = timedelta(seconds=max(offset_seconds, 0))

        if start_time is None:
            return None

        if end_time is not None and start_time > end_time:
            return None

        run_at = start_time - reminder_delta

        if recurrence in {"none", ""}:
            if run_at <= after:
                return None
            return run_at, start_time

        next_start = start_time
        while run_at <= after:
            next_start = self._advance(next_start, recurrence)
            if next_start is None:
                return None
            run_at = next_start - reminder_delta

        return run_at, next_start

    def _advance(self, current: datetime, recurrence: str) -> Optional[datetime]:
        delta = _RECURRENCE_DELTAS.get(recurrence)
        if delta:
            return current + delta
        if recurrence == "monthly":
            year = current.year + (current.month // 12)
            month = current.month % 12 + 1
            day = min(current.day, 28)
            return current.replace(year=year, month=month, day=day)
        return None

    @staticmethod
    def _job_id(event_id: Optional[int]) -> str:
        return f"calendar-event-{event_id}"

    @staticmethod
    def _default_loader() -> List[EventDict]:
        from .service import get_events

        return get_events()


_scheduler: Optional[ReminderScheduler] = None
_scheduler_lock = threading.Lock()


def init_scheduler(
    callback: Optional[ReminderCallback] = None,
    loader: Optional[Callable[[], List[EventDict]]] = None,
) -> ReminderScheduler:
    """Initialise the global reminder scheduler."""
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = ReminderScheduler(callback=callback, loader=loader)
        elif callback or loader:
            raise RuntimeError("Scheduler already initialised")
        return _scheduler


def get_scheduler(create: bool = True) -> Optional[ReminderScheduler]:
    global _scheduler
    if _scheduler is None and create:
        return init_scheduler()
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None:
            _scheduler.shutdown()
            _scheduler = None
