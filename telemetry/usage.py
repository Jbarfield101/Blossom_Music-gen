"""Accumulate and expose token/character usage metrics."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, MutableMapping

__all__ = [
    "get_usage_snapshot",
    "record_elevenlabs_usage",
    "record_openai_usage",
]

_METRICS_PATH = Path("cache/usage_metrics.json")
_LOCK = Lock()


@dataclass
class _SectionKeys:
    daily_keys: tuple[str, ...]
    total_keys: tuple[str, ...]


_OPENAI_KEYS = _SectionKeys(
    daily_keys=("tokens", "prompt_tokens", "completion_tokens"),
    total_keys=("tokens", "prompt_tokens", "completion_tokens"),
)
_ELEVEN_KEYS = _SectionKeys(
    daily_keys=("characters",),
    total_keys=("characters",),
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _load() -> Dict[str, Any]:
    if not _METRICS_PATH.exists():
        return {}
    try:
        with _METRICS_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        # Corrupt or unreadable metrics are treated as reset.
        return {}


def _save(data: MutableMapping[str, Any]) -> None:
    _METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _METRICS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)


def _ensure_section(
    data: MutableMapping[str, Any],
    name: str,
    keys: _SectionKeys,
    today: str,
) -> MutableMapping[str, Any]:
    section: MutableMapping[str, Any] = data.setdefault(name, {})
    daily: MutableMapping[str, Any] = section.setdefault(
        "daily",
        {"date": today, **{key: 0 for key in keys.daily_keys}},
    )
    if daily.get("date") != today:
        daily.clear()
        daily.update({"date": today, **{key: 0 for key in keys.daily_keys}})
    section.setdefault(
        "total",
        {"since": today, **{key: 0 for key in keys.total_keys}},
    )
    section.setdefault("updated_at", None)
    return section


def _increment(
    section: MutableMapping[str, Any],
    *,
    daily_updates: Dict[str, int],
    total_updates: Dict[str, int],
    timestamp: datetime,
) -> None:
    daily = section.setdefault("daily", {})
    total = section.setdefault("total", {})
    for key, value in daily_updates.items():
        daily[key] = int(daily.get(key, 0)) + int(value)
    for key, value in total_updates.items():
        total[key] = int(total.get(key, 0)) + int(value)
    if "since" not in total:
        total["since"] = timestamp.date().isoformat()
    section["updated_at"] = timestamp.isoformat().replace("+00:00", "Z")


def record_openai_usage(prompt_tokens: int | None, completion_tokens: int | None) -> None:
    """Record OpenAI prompt/completion token usage."""

    prompt = max(int(prompt_tokens or 0), 0)
    completion = max(int(completion_tokens or 0), 0)
    tokens = prompt + completion
    if tokens <= 0:
        return
    now = _utc_now()
    today = now.date().isoformat()
    with _LOCK:
        data = _load()
        section = _ensure_section(data, "openai", _OPENAI_KEYS, today)
        _increment(
            section,
            daily_updates={
                "tokens": tokens,
                "prompt_tokens": prompt,
                "completion_tokens": completion,
            },
            total_updates={
                "tokens": tokens,
                "prompt_tokens": prompt,
                "completion_tokens": completion,
            },
            timestamp=now,
        )
        _save(data)


def record_elevenlabs_usage(characters: int | None) -> None:
    """Record ElevenLabs character consumption."""

    count = max(int(characters or 0), 0)
    if count <= 0:
        return
    now = _utc_now()
    today = now.date().isoformat()
    with _LOCK:
        data = _load()
        section = _ensure_section(data, "elevenlabs", _ELEVEN_KEYS, today)
        _increment(
            section,
            daily_updates={"characters": count},
            total_updates={"characters": count},
            timestamp=now,
        )
        _save(data)


def _snapshot_section(
    section: MutableMapping[str, Any],
    *,
    keys: _SectionKeys,
    today: str,
) -> Dict[str, Any]:
    daily_raw = section.get("daily", {})
    total_raw = section.get("total", {})
    if daily_raw.get("date") != today:
        daily = {
            "reset_at": today,
            **{key: 0 for key in keys.daily_keys},
        }
    else:
        daily = {
            "reset_at": daily_raw.get("date"),
            **{key: int(daily_raw.get(key, 0)) for key in keys.daily_keys},
        }
    total = {
        "since": total_raw.get("since"),
        **{key: int(total_raw.get(key, 0)) for key in keys.total_keys},
    }
    return {
        "daily": daily,
        "total": total,
        "updated_at": section.get("updated_at"),
    }


def get_usage_snapshot() -> Dict[str, Any]:
    """Return a snapshot of the usage metrics, resetting stale daily buckets."""

    now = _utc_now()
    today = now.date().isoformat()
    with _LOCK:
        data = _load()
        openai_section = _ensure_section(data, "openai", _OPENAI_KEYS, today)
        eleven_section = _ensure_section(data, "elevenlabs", _ELEVEN_KEYS, today)
        _save(data)
    snapshot = {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "openai": _snapshot_section(openai_section, keys=_OPENAI_KEYS, today=today),
        "elevenlabs": _snapshot_section(eleven_section, keys=_ELEVEN_KEYS, today=today),
    }
    return deepcopy(snapshot)
