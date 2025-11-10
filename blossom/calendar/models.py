"""Database models and engine configuration for Blossom calendar events."""
from __future__ import annotations

from datetime import datetime
import os
import sys
from pathlib import Path
from typing import Optional

from sqlalchemy import Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

__all__ = [
    "Base",
    "CalendarEvent",
    "SessionLocal",
    "get_database_path",
    "DEFAULT_STATUS",
]

BUNDLE_IDENTIFIER = "com.blossom.musicgen"
DEFAULT_STATUS = "scheduled"

Base = declarative_base()


def _default_app_data_dir() -> Path:
    """Compute the default application data directory used by Tauri."""
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / BUNDLE_IDENTIFIER


def get_app_data_dir() -> Path:
    """Return the directory for storing Blossom data."""
    override = os.environ.get("BLOSSOM_CALENDAR_DATA_DIR") or os.environ.get(
        "BLOSSOM_APP_DATA_DIR"
    )
    if override:
        return Path(override)
    return _default_app_data_dir()


def get_database_path() -> Path:
    """Return the fully-qualified path to the calendar database file."""
    return get_app_data_dir() / "tasks.db"


def _ensure_directory(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


DATABASE_PATH = get_database_path()
_ensure_directory(DATABASE_PATH)

engine = create_engine(
    f"sqlite:///{DATABASE_PATH}", connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class CalendarEvent(Base):
    """SQLAlchemy model representing an event in the Blossom calendar."""

    __tablename__ = "calendar_events"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    title: str = Column(String(255), nullable=False)
    description: Optional[str] = Column(Text, nullable=True)
    start_time: datetime = Column(DateTime, nullable=False)
    end_time: Optional[datetime] = Column(DateTime, nullable=True)
    recurrence: Optional[str] = Column(String(50), nullable=True)
    reminder_offset: Optional[int] = Column(Integer, nullable=True, default=0)
    status: str = Column(String(50), nullable=False, default=DEFAULT_STATUS)

    def __repr__(self) -> str:
        return (
            "CalendarEvent(id={id}, title={title!r}, start_time={start}, "
            "end_time={end}, recurrence={recurrence!r}, reminder_offset={offset}, "
            "status={status!r})"
        ).format(
            id=self.id,
            title=self.title,
            start=self.start_time,
            end=self.end_time,
            recurrence=self.recurrence,
            offset=self.reminder_offset,
            status=self.status,
        )


Base.metadata.create_all(bind=engine)
