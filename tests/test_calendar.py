"""Tests for the Blossom calendar services and reminders."""
from __future__ import annotations

import importlib
import sys
import threading
from datetime import datetime, timedelta
from typing import List

import pytest


@pytest.fixture()
def calendar_modules(tmp_path, monkeypatch):
    """Provide reloaded calendar modules backed by a temporary database."""
    monkeypatch.setenv("BLOSSOM_CALENDAR_DATA_DIR", str(tmp_path))
    for name in list(sys.modules):
        if name.startswith("blossom.calendar"):
            sys.modules.pop(name)

    models = importlib.import_module("blossom.calendar.models")
    service = importlib.import_module("blossom.calendar.service")
    reminders = importlib.import_module("blossom.calendar.reminders")
    yield models, service, reminders
    reminders.shutdown_scheduler()
    for name in list(sys.modules):
        if name.startswith("blossom.calendar"):
            sys.modules.pop(name, None)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_crud_operations(calendar_modules):
    _models, service, _reminders = calendar_modules

    start = datetime.utcnow() + timedelta(hours=1)
    end = start + timedelta(hours=2)
    created = service.create_event(
        {
            "title": "Mixdown Session",
            "description": "Finalize stems",
            "start_time": _iso(start),
            "end_time": _iso(end),
            "recurrence": "weekly",
            "reminder_offset": 600,
            "status": "scheduled",
        }
    )

    events = service.get_events()
    assert len(events) == 1
    assert events[0]["title"] == "Mixdown Session"
    assert events[0]["recurrence"] == "weekly"

    updated = service.update_event(
        created["id"],
        {"title": "Mastering", "status": "scheduled", "reminder_offset": 300},
    )
    assert updated is not None
    assert updated["title"] == "Mastering"
    assert updated["reminder_offset"] == 300

    deleted = service.delete_event(created["id"])
    assert deleted is True
    assert service.get_events() == []


def test_scheduler_skips_past_reminders(calendar_modules):
    _models, service, reminders = calendar_modules

    triggered: List[dict] = []
    gate = threading.Event()

    reminders.init_scheduler(callback=lambda event: (triggered.append(event), gate.set()))

    past_start = datetime.utcnow() - timedelta(minutes=10)
    service.create_event(
        {
            "title": "Old Event",
            "start_time": _iso(past_start),
            "reminder_offset": 60,
        }
    )

    gate.wait(timeout=1.5)
    assert not triggered


def test_scheduler_recurring_events(calendar_modules):
    _models, service, reminders = calendar_modules

    gate = threading.Event()
    trigger_times: List[str] = []

    def _callback(event: dict) -> None:
        trigger_times.append(event["start_time"])
        if len(trigger_times) >= 2:
            gate.set()

    reminders.init_scheduler(callback=_callback)

    start = datetime.utcnow() + timedelta(seconds=1)
    service.create_event(
        {
            "title": "Practice",
            "start_time": _iso(start),
            "recurrence": "secondly",
            "reminder_offset": 0,
        }
    )

    finished = gate.wait(timeout=5)
    assert finished, "Recurring reminder did not fire twice in time"
    assert len(trigger_times) >= 2
    first, second = trigger_times[:2]
    assert second > first
