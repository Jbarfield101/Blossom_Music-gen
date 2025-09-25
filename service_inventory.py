"""World inventory persistence and schema utilities.

This module manages the campaign "world inventory" state used by the UI.
It stores items, containers, owners and related metadata inside a small
SQLite database that lives beside the selected Obsidian vault.  Records are
identified by deterministic, sequential ULID-like identifiers so tests and
automation can rely on predictable values.  All mutating operations emit
audit entries into a change log as well as provenance ledger rows for item
history tracking.

The module purposely mirrors the structure consumed by
``ui/src/lib/worldInventoryState.js`` – the snapshot payload returned from the
APIs aligns with the data shape expected by the React state container.  The
functions here are written so they can be wired into a REST or command based
surface (Tauri, FastAPI, etc.) without additional translation layers.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable, Mapping, Sequence

from config.obsidian import get_vault


# ---------------------------------------------------------------------------
# Dataclasses modelling the persisted entities.


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    """Entry in an item's provenance ledger."""

    id: str
    actor: str
    action: str
    notes: str
    timestamp: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class Item:
    id: str
    name: str
    rarity: str
    type: str
    tags: tuple[str, ...]
    quests: tuple[str, ...]
    attunement_required: bool
    attunement_restrictions: tuple[str, ...]
    attunement_notes: str
    attuned_to: tuple[str, ...]
    charges_current: int | None
    charges_max: int | None
    charges_recharge: str
    durability_current: int | None
    durability_max: int | None
    durability_state: str
    durability_notes: str
    description: str
    notes: str
    provenance_origin: str
    provenance_ledger: tuple[LedgerEntry, ...]
    owner_id: str | None
    container_id: str | None
    location_id: str | None
    set_id: str | None
    weight: float | None
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        data["quests"] = list(self.quests)
        data["attunement_restrictions"] = list(self.attunement_restrictions)
        data["attuned_to"] = list(self.attuned_to)
        data["provenance"] = {
            "origin": self.provenance_origin,
            "ledger": [entry.to_dict() for entry in self.provenance_ledger],
        }
        data.pop("provenance_origin")
        data.pop("provenance_ledger")
        return data


@dataclass(frozen=True, slots=True)
class Owner:
    id: str
    name: str
    summary: str
    tags: tuple[str, ...]
    quests: tuple[str, ...]
    attunement_slots: int
    location_id: str | None
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        data["quests"] = list(self.quests)
        return data


@dataclass(frozen=True, slots=True)
class Container:
    id: str
    name: str
    summary: str
    tags: tuple[str, ...]
    quests: tuple[str, ...]
    capacity: int | None
    weight_capacity: float | None
    owner_id: str | None
    location_id: str | None
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        data["quests"] = list(self.quests)
        return data


@dataclass(frozen=True, slots=True)
class Location:
    id: str
    name: str
    path: str
    summary: str
    tags: tuple[str, ...]
    quests: tuple[str, ...]
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        data["quests"] = list(self.quests)
        return data


@dataclass(frozen=True, slots=True)
class ItemSet:
    id: str
    name: str
    summary: str
    tags: tuple[str, ...]
    quests: tuple[str, ...]
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["tags"] = list(self.tags)
        data["quests"] = list(self.quests)
        return data


@dataclass(frozen=True, slots=True)
class QuestLink:
    id: str
    quest: str
    entity_type: str
    entity_id: str
    notes: str
    created_at: str
    updated_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Exceptions and constants.


class InventoryError(RuntimeError):
    """Base error for the inventory service."""


class ValidationError(InventoryError):
    """Raised when validation rules are violated."""


class NotFoundError(InventoryError):
    """Raised when a referenced entity cannot be located."""


_CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_DB_FILENAME = "world_inventory.sqlite"
_DEFAULT_ATTUNEMENT_SLOTS = 3


# ---------------------------------------------------------------------------
# Helper utilities.


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _resolve_db_path(db_path: str | Path | None) -> Path:
    if db_path is not None:
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    vault = get_vault()
    if vault is None:
        raise RuntimeError("Obsidian vault has not been selected")

    base = Path(vault).resolve()
    storage_dir = base / ".blossom"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir / _DB_FILENAME


def _connect(db_path: str | Path | None) -> sqlite3.Connection:
    path = _resolve_db_path(db_path)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS id_sequences (
            name TEXT PRIMARY KEY,
            last_value INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS locations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            quests TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS owners (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            attunement_slots INTEGER NOT NULL DEFAULT 0,
            tags TEXT NOT NULL DEFAULT '[]',
            quests TEXT NOT NULL DEFAULT '[]',
            location_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS containers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            capacity INTEGER,
            weight_capacity REAL,
            tags TEXT NOT NULL DEFAULT '[]',
            quests TEXT NOT NULL DEFAULT '[]',
            owner_id TEXT,
            location_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(owner_id) REFERENCES owners(id) ON DELETE SET NULL,
            FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS sets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            quests TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            quests TEXT NOT NULL DEFAULT '[]',
            attunement_required INTEGER NOT NULL DEFAULT 0,
            attunement_restrictions TEXT NOT NULL DEFAULT '[]',
            attunement_notes TEXT NOT NULL DEFAULT '',
            attuned_to TEXT NOT NULL DEFAULT '[]',
            charges_current INTEGER,
            charges_max INTEGER,
            charges_recharge TEXT NOT NULL DEFAULT '',
            durability_current INTEGER,
            durability_max INTEGER,
            durability_state TEXT NOT NULL DEFAULT '',
            durability_notes TEXT NOT NULL DEFAULT '',
            owner_id TEXT,
            container_id TEXT,
            location_id TEXT,
            set_id TEXT,
            weight REAL,
            provenance_origin TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(owner_id) REFERENCES owners(id) ON DELETE SET NULL,
            FOREIGN KEY(container_id) REFERENCES containers(id) ON DELETE SET NULL,
            FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL,
            FOREIGN KEY(set_id) REFERENCES sets(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS quest_links (
            id TEXT PRIMARY KEY,
            quest TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_quest_links_entity
            ON quest_links(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS item_ledger (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            timestamp TEXT NOT NULL,
            FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_item_ledger_item
            ON item_ledger(item_id);

        CREATE TABLE IF NOT EXISTS change_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT '',
            details TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_change_log_entity
            ON change_log(entity_type, entity_id);
        """
    )


def _encode_ulid(value: int) -> str:
    if value < 0:
        raise ValueError("value must be non-negative")
    digits: list[str] = []
    base = len(_CROCKFORD_ALPHABET)
    number = value
    while number:
        number, remainder = divmod(number, base)
        digits.append(_CROCKFORD_ALPHABET[remainder])
    if not digits:
        digits.append("0")
    encoded = "".join(reversed(digits))
    return encoded.rjust(26, "0")


def _next_id(conn: sqlite3.Connection, sequence: str, prefix: str) -> str:
    cursor = conn.execute(
        "INSERT INTO id_sequences(name, last_value) VALUES(?, 0)"
        " ON CONFLICT(name) DO NOTHING",
        (sequence,),
    )
    cursor.close()
    current = conn.execute(
        "SELECT last_value FROM id_sequences WHERE name = ?",
        (sequence,),
    ).fetchone()
    next_value = (current["last_value"] if isinstance(current, sqlite3.Row) else current[0]) + 1
    conn.execute(
        "UPDATE id_sequences SET last_value = ? WHERE name = ?",
        (next_value, sequence),
    )
    return f"{prefix}_{_encode_ulid(next_value)}"


def _normalize_strings(values: Iterable[str] | None) -> list[str]:
    if not values:
        return []
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        lower = text.lower()
        if lower in seen:
            continue
        seen.add(lower)
        output.append(text)
    return output


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _row_to_owner(row: sqlite3.Row) -> Owner:
    return Owner(
        id=row["id"],
        name=row["name"],
        summary=row["summary"],
        tags=tuple(json.loads(row["tags"]) or []),
        quests=tuple(json.loads(row["quests"]) or []),
        attunement_slots=int(row["attunement_slots"]),
        location_id=row["location_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_container(row: sqlite3.Row) -> Container:
    return Container(
        id=row["id"],
        name=row["name"],
        summary=row["summary"],
        tags=tuple(json.loads(row["tags"]) or []),
        quests=tuple(json.loads(row["quests"]) or []),
        capacity=_to_int(row["capacity"]),
        weight_capacity=_to_float(row["weight_capacity"]),
        owner_id=row["owner_id"],
        location_id=row["location_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_location(row: sqlite3.Row) -> Location:
    return Location(
        id=row["id"],
        name=row["name"],
        path=row["path"],
        summary=row["summary"],
        tags=tuple(json.loads(row["tags"]) or []),
        quests=tuple(json.loads(row["quests"]) or []),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_set(row: sqlite3.Row) -> ItemSet:
    return ItemSet(
        id=row["id"],
        name=row["name"],
        summary=row["summary"],
        tags=tuple(json.loads(row["tags"]) or []),
        quests=tuple(json.loads(row["quests"]) or []),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_quest_link(row: sqlite3.Row) -> QuestLink:
    return QuestLink(
        id=row["id"],
        quest=row["quest"],
        entity_type=row["entity_type"],
        entity_id=row["entity_id"],
        notes=row["notes"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_item(
    conn: sqlite3.Connection, row: sqlite3.Row
) -> Item:
    ledger_rows = conn.execute(
        "SELECT id, actor, action, notes, timestamp FROM item_ledger"
        " WHERE item_id = ? ORDER BY timestamp DESC, id",
        (row["id"],),
    ).fetchall()
    ledger = tuple(
        LedgerEntry(
            id=ledger_row["id"],
            actor=ledger_row["actor"],
            action=ledger_row["action"],
            notes=ledger_row["notes"],
            timestamp=ledger_row["timestamp"],
        )
        for ledger_row in ledger_rows
    )
    return Item(
        id=row["id"],
        name=row["name"],
        rarity=row["rarity"],
        type=row["type"],
        tags=tuple(json.loads(row["tags"]) or []),
        quests=tuple(json.loads(row["quests"]) or []),
        attunement_required=bool(row["attunement_required"]),
        attunement_restrictions=tuple(json.loads(row["attunement_restrictions"]) or []),
        attunement_notes=row["attunement_notes"],
        attuned_to=tuple(json.loads(row["attuned_to"]) or []),
        charges_current=_to_int(row["charges_current"]),
        charges_max=_to_int(row["charges_max"]),
        charges_recharge=row["charges_recharge"],
        durability_current=_to_int(row["durability_current"]),
        durability_max=_to_int(row["durability_max"]),
        durability_state=row["durability_state"],
        durability_notes=row["durability_notes"],
        description=row["description"],
        notes=row["notes"],
        provenance_origin=row["provenance_origin"],
        provenance_ledger=ledger,
        owner_id=row["owner_id"],
        container_id=row["container_id"],
        location_id=row["location_id"],
        set_id=row["set_id"],
        weight=_to_float(row["weight"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _log_change(
    conn: sqlite3.Connection,
    entity_type: str,
    entity_id: str,
    action: str,
    actor: str,
    details: Mapping[str, Any] | None,
) -> None:
    payload = json.dumps(details or {}, ensure_ascii=False, sort_keys=True)
    conn.execute(
        "INSERT INTO change_log(entity_type, entity_id, action, actor, details, created_at)"
        " VALUES(?, ?, ?, ?, ?, ?)",
        (entity_type, entity_id, action, actor, payload, _now()),
    )


def list_change_log(
    *, limit: int | None = None, db_path: str | Path | None = None
) -> list[dict[str, Any]]:
    """Return change log entries ordered newest first."""

    with _connect(db_path) as conn:
        query = "SELECT entity_type, entity_id, action, actor, details, created_at FROM change_log ORDER BY id DESC"
        if limit is not None:
            query += " LIMIT ?"
            rows = conn.execute(query, (limit,)).fetchall()
        else:
            rows = conn.execute(query).fetchall()
    return [
        {
            "entity_type": row["entity_type"],
            "entity_id": row["entity_id"],
            "action": row["action"],
            "actor": row["actor"],
            "details": json.loads(row["details"]) if row["details"] else {},
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def _fetch_owner(conn: sqlite3.Connection, owner_id: str) -> Owner:
    row = conn.execute(
        "SELECT * FROM owners WHERE id = ?",
        (owner_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"owner not found: {owner_id}")
    return _row_to_owner(row)


def _fetch_container(conn: sqlite3.Connection, container_id: str) -> Container:
    row = conn.execute(
        "SELECT * FROM containers WHERE id = ?",
        (container_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"container not found: {container_id}")
    return _row_to_container(row)


def _fetch_location(conn: sqlite3.Connection, location_id: str) -> Location:
    row = conn.execute(
        "SELECT * FROM locations WHERE id = ?",
        (location_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"location not found: {location_id}")
    return _row_to_location(row)


def _fetch_set(conn: sqlite3.Connection, set_id: str) -> ItemSet:
    row = conn.execute(
        "SELECT * FROM sets WHERE id = ?",
        (set_id,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"set not found: {set_id}")
    return _row_to_set(row)


def _validate_owner_attunement(
    conn: sqlite3.Connection,
    owner_id: str | None,
    requires_attunement: bool,
    *,
    current_item: str | None = None,
) -> None:
    if not requires_attunement or not owner_id:
        return
    owner = _fetch_owner(conn, owner_id)
    slots = owner.attunement_slots
    if slots is None or slots < 0:
        return
    current = conn.execute(
        "SELECT COUNT(*) AS cnt FROM items WHERE owner_id = ?"
        " AND attunement_required = 1"
        + (" AND id != ?" if current_item else ""),
        (owner_id, current_item) if current_item else (owner_id,),
    ).fetchone()
    count = current["cnt"] if isinstance(current, sqlite3.Row) else current[0]
    if count >= slots:
        raise ValidationError(
            f"owner '{owner.name}' has no available attunement slots"
        )


def _validate_container_capacity(
    conn: sqlite3.Connection,
    container_id: str | None,
    item_weight: float | None,
    *,
    current_item: str | None = None,
) -> None:
    if not container_id:
        return
    container = _fetch_container(conn, container_id)
    capacity = container.capacity
    if capacity is not None:
        count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM items WHERE container_id = ?"
            + (" AND id != ?" if current_item else ""),
            (container_id, current_item) if current_item else (container_id,),
        ).fetchone()
        count = count_row["cnt"] if isinstance(count_row, sqlite3.Row) else count_row[0]
        if count >= capacity:
            raise ValidationError(
                f"container '{container.name}' is at capacity"
            )

    weight_cap = container.weight_capacity
    if weight_cap is None:
        return
    rows = conn.execute(
        "SELECT COALESCE(weight, 0.0) AS wt FROM items WHERE container_id = ?"
        + (" AND id != ?" if current_item else ""),
        (container_id, current_item) if current_item else (container_id,),
    ).fetchall()
    total = sum(float(r["wt"]) for r in rows)
    if item_weight is not None:
        total += float(item_weight)
    if total - 1e-9 > weight_cap:
        raise ValidationError(
            f"container '{container.name}' exceeds weight capacity"
        )


def _prepare_item_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or data.get("title") or "").strip()
    if not name:
        raise ValidationError("item name is required")
    rarity = str(data.get("rarity") or "common").strip()
    item_type = str(data.get("type") or "").strip()
    description = str(data.get("description") or "")
    notes = str(data.get("notes") or "")
    tags = _normalize_strings(data.get("tags"))
    quests = _normalize_strings(data.get("quests"))
    attunement_required = bool(
        data.get("attunement_required")
        or data.get("attunementRequired")
        or data.get("attunement")
    )
    attunement_restrictions = _normalize_strings(
        data.get("attunement_restrictions")
        or data.get("attunementRestrictions")
        or data.get("attunement", {}).get("restrictions")
        if isinstance(data.get("attunement"), Mapping)
        else []
    )
    attunement_notes = str(
        data.get("attunement_notes")
        or (data.get("attunement") or {}).get("notes")
        if isinstance(data.get("attunement"), Mapping)
        else data.get("attunementNotes")
        or ""
    )
    attuned_to = _normalize_strings(
        data.get("attuned_to")
        or data.get("attunedTo")
        or (data.get("attunement") or {}).get("attunedTo")
        if isinstance(data.get("attunement"), Mapping)
        else []
    )
    charges_current = _to_int(
        data.get("charges_current")
        or data.get("charges", {}).get("current")
        if isinstance(data.get("charges"), Mapping)
        else data.get("chargesCurrent")
    )
    charges_max = _to_int(
        data.get("charges_max")
        or data.get("charges", {}).get("maximum")
        if isinstance(data.get("charges"), Mapping)
        else data.get("chargesMax")
    )
    charges_recharge = str(
        data.get("charges_recharge")
        or data.get("charges", {}).get("recharge")
        if isinstance(data.get("charges"), Mapping)
        else data.get("chargesRecharge")
        or ""
    )
    durability_current = _to_int(
        data.get("durability_current")
        or data.get("durability", {}).get("current")
        if isinstance(data.get("durability"), Mapping)
        else data.get("durabilityCurrent")
    )
    durability_max = _to_int(
        data.get("durability_max")
        or data.get("durability", {}).get("maximum")
        if isinstance(data.get("durability"), Mapping)
        else data.get("durabilityMax")
    )
    durability_state = str(
        data.get("durability_state")
        or data.get("durability", {}).get("state")
        if isinstance(data.get("durability"), Mapping)
        else data.get("durabilityState")
        or ""
    )
    durability_notes = str(
        data.get("durability_notes")
        or data.get("durability", {}).get("notes")
        if isinstance(data.get("durability"), Mapping)
        else data.get("durabilityNotes")
        or ""
    )
    provenance = data.get("provenance") or {}
    provenance_origin = str(provenance.get("origin") or data.get("provenance_origin") or "")
    owner_id = data.get("owner_id") or data.get("ownerId")
    container_id = data.get("container_id") or data.get("containerId")
    location_id = data.get("location_id") or data.get("locationId")
    set_id = data.get("set_id") or data.get("setId")
    weight = _to_float(data.get("weight"))
    return {
        "name": name,
        "rarity": rarity,
        "type": item_type,
        "description": description,
        "notes": notes,
        "tags": tags,
        "quests": quests,
        "attunement_required": attunement_required,
        "attunement_restrictions": attunement_restrictions,
        "attunement_notes": attunement_notes,
        "attuned_to": attuned_to,
        "charges_current": charges_current,
        "charges_max": charges_max,
        "charges_recharge": charges_recharge,
        "durability_current": durability_current,
        "durability_max": durability_max,
        "durability_state": durability_state,
        "durability_notes": durability_notes,
        "provenance_origin": provenance_origin,
        "owner_id": owner_id,
        "container_id": container_id,
        "location_id": location_id,
        "set_id": set_id,
        "weight": weight,
    }


def _prepare_owner_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or data.get("title") or "").strip()
    if not name:
        raise ValidationError("owner name is required")
    summary = str(data.get("summary") or data.get("description") or "")
    tags = _normalize_strings(data.get("tags"))
    quests = _normalize_strings(data.get("quests"))
    attunement_slots = data.get("attunement_slots")
    if attunement_slots is None:
        attunement_slots = data.get("attunementSlots", _DEFAULT_ATTUNEMENT_SLOTS)
    slots_value = _to_int(attunement_slots)
    if slots_value is None:
        slots_value = _DEFAULT_ATTUNEMENT_SLOTS
    location_id = data.get("location_id") or data.get("locationId")
    return {
        "name": name,
        "summary": summary,
        "tags": tags,
        "quests": quests,
        "attunement_slots": int(slots_value),
        "location_id": location_id,
    }


def _prepare_container_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or data.get("title") or "").strip()
    if not name:
        raise ValidationError("container name is required")
    summary = str(data.get("summary") or data.get("description") or "")
    tags = _normalize_strings(data.get("tags"))
    quests = _normalize_strings(data.get("quests"))
    capacity = _to_int(data.get("capacity") or data.get("itemCapacity"))
    weight_capacity = _to_float(
        data.get("weight_capacity") or data.get("weightCapacity")
    )
    owner_id = data.get("owner_id") or data.get("ownerId")
    location_id = data.get("location_id") or data.get("locationId")
    return {
        "name": name,
        "summary": summary,
        "tags": tags,
        "quests": quests,
        "capacity": capacity,
        "weight_capacity": weight_capacity,
        "owner_id": owner_id,
        "location_id": location_id,
    }


def _prepare_location_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    path = str(data.get("path") or "").strip()
    if not path:
        raise ValidationError("location path is required")
    name = str(data.get("name") or data.get("title") or Path(path).name or path)
    summary = str(data.get("summary") or data.get("description") or "")
    tags = _normalize_strings(data.get("tags"))
    quests = _normalize_strings(data.get("quests"))
    return {
        "name": name,
        "path": path,
        "summary": summary,
        "tags": tags,
        "quests": quests,
    }


def _prepare_set_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or data.get("title") or "").strip()
    if not name:
        raise ValidationError("set name is required")
    summary = str(data.get("summary") or data.get("description") or "")
    tags = _normalize_strings(data.get("tags"))
    quests = _normalize_strings(data.get("quests"))
    return {
        "name": name,
        "summary": summary,
        "tags": tags,
        "quests": quests,
    }


def _prepare_quest_link_payload(data: Mapping[str, Any]) -> dict[str, Any]:
    quest = str(data.get("quest") or data.get("name") or "").strip()
    if not quest:
        raise ValidationError("quest name is required")
    entity_type = str(data.get("entity_type") or data.get("entityType") or "").strip()
    if not entity_type:
        raise ValidationError("entity_type is required")
    entity_id = str(data.get("entity_id") or data.get("entityId") or "").strip()
    if not entity_id:
        raise ValidationError("entity_id is required")
    notes = str(data.get("notes") or "")
    return {
        "quest": quest,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "notes": notes,
    }


def _fetch_item(conn: sqlite3.Connection, item_id: str) -> Item:
    row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"item not found: {item_id}")
    return _row_to_item(conn, row)


def _item_diff(before: Item, after: Item) -> dict[str, Any]:
    diff: dict[str, Any] = {}
    before_dict = before.to_dict()
    after_dict = after.to_dict()
    for key, before_value in before_dict.items():
        after_value = after_dict.get(key)
        if before_value != after_value:
            diff[key] = {"before": before_value, "after": after_value}
    return diff


def _entity_diff(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, Any]:
    diff: dict[str, Any] = {}
    for key, before_value in before.items():
        after_value = after.get(key)
        if before_value != after_value:
            diff[key] = {"before": before_value, "after": after_value}
    for key in after.keys() - before.keys():
        diff[key] = {"before": None, "after": after[key]}
    return diff


def _maybe_fetch(conn: sqlite3.Connection, table: str, identifier: str | None) -> None:
    if identifier is None:
        return
    row = conn.execute(
        f"SELECT id FROM {table} WHERE id = ?",
        (identifier,),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"{table[:-1]} not found: {identifier}")


def create_owner(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> Owner:
    payload = _prepare_owner_payload(data)
    now = _now()
    with _connect(db_path) as conn:
        owner_id = data.get("id") or _next_id(conn, "owner", "own")
        conn.execute(
            "INSERT INTO owners(id, name, summary, attunement_slots, tags, quests, location_id, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                owner_id,
                payload["name"],
                payload["summary"],
                payload["attunement_slots"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                payload["location_id"],
                now,
                now,
            ),
        )
        owner = _fetch_owner(conn, owner_id)
        _log_change(conn, "owner", owner_id, "create", actor, {"after": owner.to_dict()})
        return owner


def update_owner(
    owner_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> Owner:
    if not owner_id:
        raise ValidationError("owner_id is required")

    with _connect(db_path) as conn:
        before = _fetch_owner(conn, owner_id)
        tags_value = changes.get("tags") if "tags" in changes else list(before.tags)
        if tags_value is None:
            tags_value = []
        quests_value = changes.get("quests") if "quests" in changes else list(before.quests)
        if quests_value is None:
            quests_value = []
        slots_value = (
            changes.get("attunement_slots")
            if "attunement_slots" in changes
            else changes.get("attunementSlots")
            if "attunementSlots" in changes
            else before.attunement_slots
        )
        location_value = (
            changes.get("location_id")
            if "location_id" in changes
            else changes.get("locationId")
            if "locationId" in changes
            else before.location_id
        )
        data = {
            "name": changes.get("name") or before.name,
            "summary": changes.get("summary")
            if "summary" in changes
            else before.summary,
            "tags": tags_value,
            "quests": quests_value,
            "attunement_slots": slots_value,
            "location_id": location_value,
        }
        payload = _prepare_owner_payload(data)
        _maybe_fetch(conn, "locations", payload["location_id"])
        now = _now()
        conn.execute(
            "UPDATE owners SET name = ?, summary = ?, attunement_slots = ?, tags = ?,"
            " quests = ?, location_id = ?, updated_at = ? WHERE id = ?",
            (
                payload["name"],
                payload["summary"],
                payload["attunement_slots"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                payload["location_id"],
                now,
                owner_id,
            ),
        )
        after = _fetch_owner(conn, owner_id)
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "owner",
                owner_id,
                "update",
                actor,
                {"before": before.to_dict(), "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_owner(
    owner_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not owner_id:
        raise ValidationError("owner_id is required")
    with _connect(db_path) as conn:
        owner = _fetch_owner(conn, owner_id)
        conn.execute("UPDATE items SET owner_id = NULL WHERE owner_id = ?", (owner_id,))
        conn.execute("UPDATE containers SET owner_id = NULL WHERE owner_id = ?", (owner_id,))
        conn.execute("DELETE FROM owners WHERE id = ?", (owner_id,))
        _log_change(conn, "owner", owner_id, "delete", actor, {"before": owner.to_dict()})


def create_container(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> Container:
    payload = _prepare_container_payload(data)
    now = _now()
    with _connect(db_path) as conn:
        _maybe_fetch(conn, "owners", payload["owner_id"])
        _maybe_fetch(conn, "locations", payload["location_id"])
        container_id = data.get("id") or _next_id(conn, "container", "ctr")
        conn.execute(
            "INSERT INTO containers(id, name, summary, capacity, weight_capacity, tags, quests,"
            " owner_id, location_id, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                container_id,
                payload["name"],
                payload["summary"],
                payload["capacity"],
                payload["weight_capacity"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                payload["owner_id"],
                payload["location_id"],
                now,
                now,
            ),
        )
        container = _fetch_container(conn, container_id)
        _log_change(
            conn, "container", container_id, "create", actor, {"after": container.to_dict()}
        )
        return container


def update_container(
    container_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> Container:
    if not container_id:
        raise ValidationError("container_id is required")
    with _connect(db_path) as conn:
        before = _fetch_container(conn, container_id)
        tags_value = changes.get("tags") if "tags" in changes else list(before.tags)
        if tags_value is None:
            tags_value = []
        quests_value = changes.get("quests") if "quests" in changes else list(before.quests)
        if quests_value is None:
            quests_value = []
        owner_value = (
            changes.get("owner_id")
            if "owner_id" in changes
            else changes.get("ownerId")
            if "ownerId" in changes
            else before.owner_id
        )
        location_value = (
            changes.get("location_id")
            if "location_id" in changes
            else changes.get("locationId")
            if "locationId" in changes
            else before.location_id
        )
        data = {
            "name": changes.get("name") or before.name,
            "summary": changes.get("summary")
            if "summary" in changes
            else before.summary,
            "tags": tags_value,
            "quests": quests_value,
            "capacity": changes.get("capacity")
            if "capacity" in changes
            else before.capacity,
            "weight_capacity": changes.get("weight_capacity")
            if "weight_capacity" in changes
            else changes.get("weightCapacity")
            if "weightCapacity" in changes
            else before.weight_capacity,
            "owner_id": owner_value,
            "location_id": location_value,
        }
        payload = _prepare_container_payload(data)
        _maybe_fetch(conn, "owners", payload["owner_id"])
        _maybe_fetch(conn, "locations", payload["location_id"])
        now = _now()
        conn.execute(
            "UPDATE containers SET name = ?, summary = ?, capacity = ?, weight_capacity = ?,"
            " tags = ?, quests = ?, owner_id = ?, location_id = ?, updated_at = ?"
            " WHERE id = ?",
            (
                payload["name"],
                payload["summary"],
                payload["capacity"],
                payload["weight_capacity"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                payload["owner_id"],
                payload["location_id"],
                now,
                container_id,
            ),
        )
        after = _fetch_container(conn, container_id)
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "container",
                container_id,
                "update",
                actor,
                {"before": before.to_dict(), "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_container(
    container_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not container_id:
        raise ValidationError("container_id is required")
    with _connect(db_path) as conn:
        container = _fetch_container(conn, container_id)
        conn.execute(
            "UPDATE items SET container_id = NULL WHERE container_id = ?",
            (container_id,),
        )
        conn.execute("DELETE FROM containers WHERE id = ?", (container_id,))
        _log_change(
            conn, "container", container_id, "delete", actor, {"before": container.to_dict()}
        )


def create_location(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> Location:
    payload = _prepare_location_payload(data)
    now = _now()
    with _connect(db_path) as conn:
        location_id = data.get("id") or _next_id(conn, "location", "loc")
        conn.execute(
            "INSERT INTO locations(id, name, path, summary, tags, quests, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                location_id,
                payload["name"],
                payload["path"],
                payload["summary"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                now,
                now,
            ),
        )
        location = _fetch_location(conn, location_id)
        _log_change(
            conn, "location", location_id, "create", actor, {"after": location.to_dict()}
        )
        return location


def update_location(
    location_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> Location:
    if not location_id:
        raise ValidationError("location_id is required")
    with _connect(db_path) as conn:
        before = _fetch_location(conn, location_id)
        tags_value = changes.get("tags") if "tags" in changes else list(before.tags)
        if tags_value is None:
            tags_value = []
        quests_value = changes.get("quests") if "quests" in changes else list(before.quests)
        if quests_value is None:
            quests_value = []
        data = {
            "name": changes.get("name") or before.name,
            "path": changes.get("path") or before.path,
            "summary": changes.get("summary")
            if "summary" in changes
            else before.summary,
            "tags": tags_value,
            "quests": quests_value,
        }
        payload = _prepare_location_payload(data)
        now = _now()
        conn.execute(
            "UPDATE locations SET name = ?, path = ?, summary = ?, tags = ?, quests = ?,"
            " updated_at = ? WHERE id = ?",
            (
                payload["name"],
                payload["path"],
                payload["summary"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                now,
                location_id,
            ),
        )
        after = _fetch_location(conn, location_id)
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "location",
                location_id,
                "update",
                actor,
                {"before": before.to_dict(), "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_location(
    location_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not location_id:
        raise ValidationError("location_id is required")
    with _connect(db_path) as conn:
        location = _fetch_location(conn, location_id)
        conn.execute("UPDATE items SET location_id = NULL WHERE location_id = ?", (location_id,))
        conn.execute(
            "UPDATE containers SET location_id = NULL WHERE location_id = ?",
            (location_id,),
        )
        conn.execute("UPDATE owners SET location_id = NULL WHERE location_id = ?", (location_id,))
        conn.execute("DELETE FROM locations WHERE id = ?", (location_id,))
        _log_change(
            conn, "location", location_id, "delete", actor, {"before": location.to_dict()}
        )


def create_set(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> ItemSet:
    payload = _prepare_set_payload(data)
    now = _now()
    with _connect(db_path) as conn:
        set_id = data.get("id") or _next_id(conn, "set", "set")
        conn.execute(
            "INSERT INTO sets(id, name, summary, tags, quests, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                set_id,
                payload["name"],
                payload["summary"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                now,
                now,
            ),
        )
        result = _fetch_set(conn, set_id)
        _log_change(conn, "set", set_id, "create", actor, {"after": result.to_dict()})
        return result


def update_set(
    set_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> ItemSet:
    if not set_id:
        raise ValidationError("set_id is required")
    with _connect(db_path) as conn:
        before = _fetch_set(conn, set_id)
        tags_value = changes.get("tags") if "tags" in changes else list(before.tags)
        if tags_value is None:
            tags_value = []
        quests_value = changes.get("quests") if "quests" in changes else list(before.quests)
        if quests_value is None:
            quests_value = []
        data = {
            "name": changes.get("name") or before.name,
            "summary": changes.get("summary")
            if "summary" in changes
            else before.summary,
            "tags": tags_value,
            "quests": quests_value,
        }
        payload = _prepare_set_payload(data)
        now = _now()
        conn.execute(
            "UPDATE sets SET name = ?, summary = ?, tags = ?, quests = ?, updated_at = ?"
            " WHERE id = ?",
            (
                payload["name"],
                payload["summary"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                now,
                set_id,
            ),
        )
        after = _fetch_set(conn, set_id)
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "set",
                set_id,
                "update",
                actor,
                {"before": before.to_dict(), "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_set(
    set_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not set_id:
        raise ValidationError("set_id is required")
    with _connect(db_path) as conn:
        item_set = _fetch_set(conn, set_id)
        conn.execute("UPDATE items SET set_id = NULL WHERE set_id = ?", (set_id,))
        conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))
        _log_change(conn, "set", set_id, "delete", actor, {"before": item_set.to_dict()})


def _normalize_timestamp(value: Any) -> str:
    if value in (None, ""):
        return _now()
    if isinstance(value, datetime):
        dt = value.astimezone(timezone.utc)
    else:
        text = str(value)
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            dt = datetime.fromisoformat(text)
        except ValueError:
            return text
        dt = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _insert_provenance_entries(
    conn: sqlite3.Connection, item_id: str, entries: Sequence[Mapping[str, Any]]
) -> None:
    for entry in entries:
        actor = str(entry.get("actor") or "")
        action = str(entry.get("action") or "")
        notes = str(entry.get("notes") or "")
        timestamp = _normalize_timestamp(
            entry.get("timestamp")
            or entry.get("date")
            or entry.get("recorded_at")
            or entry.get("recordedAt")
        )
        entry_id = entry.get("id") or _next_id(conn, "ledger", "led")
        conn.execute(
            "INSERT INTO item_ledger(id, item_id, actor, action, notes, timestamp)"
            " VALUES(?, ?, ?, ?, ?, ?)",
            (entry_id, item_id, actor, action, notes, timestamp),
        )


def create_item(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> Item:
    payload = _prepare_item_payload(data)
    provenance_entries = []
    provenance = data.get("provenance")
    if isinstance(provenance, Mapping):
        ledger = provenance.get("ledger")
        if isinstance(ledger, Sequence):
            provenance_entries = list(ledger)
    now = _now()
    with _connect(db_path) as conn:
        _maybe_fetch(conn, "owners", payload["owner_id"])
        _maybe_fetch(conn, "containers", payload["container_id"])
        _maybe_fetch(conn, "locations", payload["location_id"])
        _maybe_fetch(conn, "sets", payload["set_id"])
        _validate_owner_attunement(
            conn, payload["owner_id"], payload["attunement_required"]
        )
        _validate_container_capacity(
            conn, payload["container_id"], payload["weight"]
        )
        item_id = data.get("id") or _next_id(conn, "item", "itm")
        conn.execute(
            "INSERT INTO items("  # columns
            " id, name, rarity, type, description, notes, tags, quests, attunement_required,"
            " attunement_restrictions, attunement_notes, attuned_to, charges_current,"
            " charges_max, charges_recharge, durability_current, durability_max,"
            " durability_state, durability_notes, owner_id, container_id, location_id,"
            " set_id, weight, provenance_origin, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                item_id,
                payload["name"],
                payload["rarity"],
                payload["type"],
                payload["description"],
                payload["notes"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                1 if payload["attunement_required"] else 0,
                json.dumps(payload["attunement_restrictions"], ensure_ascii=False),
                payload["attunement_notes"],
                json.dumps(payload["attuned_to"], ensure_ascii=False),
                payload["charges_current"],
                payload["charges_max"],
                payload["charges_recharge"],
                payload["durability_current"],
                payload["durability_max"],
                payload["durability_state"],
                payload["durability_notes"],
                payload["owner_id"],
                payload["container_id"],
                payload["location_id"],
                payload["set_id"],
                payload["weight"],
                payload["provenance_origin"],
                now,
                now,
            ),
        )
        if provenance_entries:
            _insert_provenance_entries(conn, item_id, provenance_entries)
        item = _fetch_item(conn, item_id)
        _log_change(conn, "item", item_id, "create", actor, {"after": item.to_dict()})
        return item


def update_item(
    item_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> Item:
    if not item_id:
        raise ValidationError("item_id is required")
    with _connect(db_path) as conn:
        before = _fetch_item(conn, item_id)
        before_dict = before.to_dict()
        tags_value = changes.get("tags") if "tags" in changes else list(before.tags)
        if tags_value is None:
            tags_value = []
        quests_value = changes.get("quests") if "quests" in changes else list(before.quests)
        if quests_value is None:
            quests_value = []
        attune_required = (
            changes.get("attunement_required")
            if "attunement_required" in changes
            else changes.get("attunementRequired")
            if "attunementRequired" in changes
            else before.attunement_required
        )
        attune_restrictions = (
            changes.get("attunement_restrictions")
            if "attunement_restrictions" in changes
            else changes.get("attunementRestrictions")
            if "attunementRestrictions" in changes
            else list(before.attunement_restrictions)
        )
        if attune_restrictions is None:
            attune_restrictions = []
        attuned_to = (
            changes.get("attuned_to")
            if "attuned_to" in changes
            else changes.get("attunedTo")
            if "attunedTo" in changes
            else list(before.attuned_to)
        )
        if attuned_to is None:
            attuned_to = []
        owner_value = (
            changes.get("owner_id")
            if "owner_id" in changes
            else changes.get("ownerId")
            if "ownerId" in changes
            else before.owner_id
        )
        container_value = (
            changes.get("container_id")
            if "container_id" in changes
            else changes.get("containerId")
            if "containerId" in changes
            else before.container_id
        )
        location_value = (
            changes.get("location_id")
            if "location_id" in changes
            else changes.get("locationId")
            if "locationId" in changes
            else before.location_id
        )
        set_value = (
            changes.get("set_id")
            if "set_id" in changes
            else changes.get("setId")
            if "setId" in changes
            else before.set_id
        )
        data = {
            "name": changes.get("name") or before.name,
            "rarity": changes.get("rarity") if "rarity" in changes else before.rarity,
            "type": changes.get("type") if "type" in changes else before.type,
            "description": changes.get("description")
            if "description" in changes
            else before.description,
            "notes": changes.get("notes") if "notes" in changes else before.notes,
            "tags": tags_value,
            "quests": quests_value,
            "attunement_required": attune_required,
            "attunement_restrictions": attune_restrictions,
            "attunement_notes": changes.get("attunement_notes")
            if "attunement_notes" in changes
            else changes.get("attunementNotes")
            if "attunementNotes" in changes
            else before.attunement_notes,
            "attuned_to": attuned_to,
            "charges_current": changes.get("charges_current")
            if "charges_current" in changes
            else changes.get("chargesCurrent")
            if "chargesCurrent" in changes
            else before.charges_current,
            "charges_max": changes.get("charges_max")
            if "charges_max" in changes
            else changes.get("chargesMax")
            if "chargesMax" in changes
            else before.charges_max,
            "charges_recharge": changes.get("charges_recharge")
            if "charges_recharge" in changes
            else changes.get("chargesRecharge")
            if "chargesRecharge" in changes
            else before.charges_recharge,
            "durability_current": changes.get("durability_current")
            if "durability_current" in changes
            else changes.get("durabilityCurrent")
            if "durabilityCurrent" in changes
            else before.durability_current,
            "durability_max": changes.get("durability_max")
            if "durability_max" in changes
            else changes.get("durabilityMax")
            if "durabilityMax" in changes
            else before.durability_max,
            "durability_state": changes.get("durability_state")
            if "durability_state" in changes
            else changes.get("durabilityState")
            if "durabilityState" in changes
            else before.durability_state,
            "durability_notes": changes.get("durability_notes")
            if "durability_notes" in changes
            else changes.get("durabilityNotes")
            if "durabilityNotes" in changes
            else before.durability_notes,
            "owner_id": owner_value,
            "container_id": container_value,
            "location_id": location_value,
            "set_id": set_value,
            "weight": changes.get("weight") if "weight" in changes else before.weight,
            "provenance_origin": changes.get("provenance_origin")
            if "provenance_origin" in changes
            else (changes.get("provenance", {}) or {}).get("origin")
            if isinstance(changes.get("provenance"), Mapping)
            else before.provenance_origin,
        }
        payload = _prepare_item_payload(data)
        _maybe_fetch(conn, "owners", payload["owner_id"])
        _maybe_fetch(conn, "containers", payload["container_id"])
        _maybe_fetch(conn, "locations", payload["location_id"])
        _maybe_fetch(conn, "sets", payload["set_id"])
        _validate_owner_attunement(
            conn, payload["owner_id"], payload["attunement_required"], current_item=item_id
        )
        _validate_container_capacity(
            conn, payload["container_id"], payload["weight"], current_item=item_id
        )
        now = _now()
        conn.execute(
            "UPDATE items SET name = ?, rarity = ?, type = ?, description = ?, notes = ?,"
            " tags = ?, quests = ?, attunement_required = ?, attunement_restrictions = ?,"
            " attunement_notes = ?, attuned_to = ?, charges_current = ?, charges_max = ?,"
            " charges_recharge = ?, durability_current = ?, durability_max = ?,"
            " durability_state = ?, durability_notes = ?, owner_id = ?, container_id = ?,"
            " location_id = ?, set_id = ?, weight = ?, provenance_origin = ?, updated_at = ?"
            " WHERE id = ?",
            (
                payload["name"],
                payload["rarity"],
                payload["type"],
                payload["description"],
                payload["notes"],
                json.dumps(payload["tags"], ensure_ascii=False),
                json.dumps(payload["quests"], ensure_ascii=False),
                1 if payload["attunement_required"] else 0,
                json.dumps(payload["attunement_restrictions"], ensure_ascii=False),
                payload["attunement_notes"],
                json.dumps(payload["attuned_to"], ensure_ascii=False),
                payload["charges_current"],
                payload["charges_max"],
                payload["charges_recharge"],
                payload["durability_current"],
                payload["durability_max"],
                payload["durability_state"],
                payload["durability_notes"],
                payload["owner_id"],
                payload["container_id"],
                payload["location_id"],
                payload["set_id"],
                payload["weight"],
                payload["provenance_origin"],
                now,
                item_id,
            ),
        )
        after = _fetch_item(conn, item_id)
        diff = _item_diff(before, after)
        if diff:
            _log_change(
                conn,
                "item",
                item_id,
                "update",
                actor,
                {"before": before_dict, "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_item(
    item_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not item_id:
        raise ValidationError("item_id is required")
    with _connect(db_path) as conn:
        item = _fetch_item(conn, item_id)
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        _log_change(conn, "item", item_id, "delete", actor, {"before": item.to_dict()})


_ENTITY_TABLE = {
    "item": "items",
    "owner": "owners",
    "container": "containers",
    "location": "locations",
    "set": "sets",
}


def _ensure_entity(conn: sqlite3.Connection, entity_type: str, entity_id: str) -> None:
    table = _ENTITY_TABLE.get(entity_type)
    if table:
        _maybe_fetch(conn, table, entity_id)


def create_quest_link(
    data: Mapping[str, Any], *, actor: str = "system", db_path: str | Path | None = None
) -> QuestLink:
    payload = _prepare_quest_link_payload(data)
    now = _now()
    with _connect(db_path) as conn:
        _ensure_entity(conn, payload["entity_type"], payload["entity_id"])
        link_id = data.get("id") or _next_id(conn, "quest_link", "qlk")
        conn.execute(
            "INSERT INTO quest_links(id, quest, entity_type, entity_id, notes, created_at, updated_at)"
            " VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                link_id,
                payload["quest"],
                payload["entity_type"],
                payload["entity_id"],
                payload["notes"],
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM quest_links WHERE id = ?", (link_id,)).fetchone()
        link = _row_to_quest_link(row)
        _log_change(conn, "quest_link", link_id, "create", actor, {"after": link.to_dict()})
        return link


def update_quest_link(
    link_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> QuestLink:
    if not link_id:
        raise ValidationError("link_id is required")
    with _connect(db_path) as conn:
        before_row = conn.execute(
            "SELECT * FROM quest_links WHERE id = ?",
            (link_id,),
        ).fetchone()
        if before_row is None:
            raise NotFoundError(f"quest link not found: {link_id}")
        before = _row_to_quest_link(before_row)
        quest_value = (
            changes.get("quest")
            if "quest" in changes
            else before.quest
        )
        entity_type_value = (
            changes.get("entity_type")
            if "entity_type" in changes
            else changes.get("entityType")
            if "entityType" in changes
            else before.entity_type
        )
        entity_id_value = (
            changes.get("entity_id")
            if "entity_id" in changes
            else changes.get("entityId")
            if "entityId" in changes
            else before.entity_id
        )
        notes_value = changes.get("notes") if "notes" in changes else before.notes
        data = {
            "quest": quest_value,
            "entity_type": entity_type_value,
            "entity_id": entity_id_value,
            "notes": notes_value,
        }
        payload = _prepare_quest_link_payload(data)
        _ensure_entity(conn, payload["entity_type"], payload["entity_id"])
        now = _now()
        conn.execute(
            "UPDATE quest_links SET quest = ?, entity_type = ?, entity_id = ?, notes = ?, updated_at = ?"
            " WHERE id = ?",
            (
                payload["quest"],
                payload["entity_type"],
                payload["entity_id"],
                payload["notes"],
                now,
                link_id,
            ),
        )
        after_row = conn.execute("SELECT * FROM quest_links WHERE id = ?", (link_id,)).fetchone()
        after = _row_to_quest_link(after_row)
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "quest_link",
                link_id,
                "update",
                actor,
                {"before": before.to_dict(), "after": after.to_dict(), "changes": diff},
            )
        return after


def delete_quest_link(
    link_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not link_id:
        raise ValidationError("link_id is required")
    with _connect(db_path) as conn:
        row = conn.execute("SELECT * FROM quest_links WHERE id = ?", (link_id,)).fetchone()
        if row is None:
            raise NotFoundError(f"quest link not found: {link_id}")
        link = _row_to_quest_link(row)
        conn.execute("DELETE FROM quest_links WHERE id = ?", (link_id,))
        _log_change(conn, "quest_link", link_id, "delete", actor, {"before": link.to_dict()})


def create_ledger_entry(
    item_id: str,
    entry: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> LedgerEntry:
    if not item_id:
        raise ValidationError("item_id is required")
    with _connect(db_path) as conn:
        _fetch_item(conn, item_id)
        entry_id = entry.get("id") or _next_id(conn, "ledger", "led")
        payload = {
            "actor": str(entry.get("actor") or ""),
            "action": str(entry.get("action") or ""),
            "notes": str(entry.get("notes") or ""),
            "timestamp": _normalize_timestamp(entry.get("timestamp") or entry.get("date")),
        }
        conn.execute(
            "INSERT INTO item_ledger(id, item_id, actor, action, notes, timestamp)"
            " VALUES(?, ?, ?, ?, ?, ?)",
            (
                entry_id,
                item_id,
                payload["actor"],
                payload["action"],
                payload["notes"],
                payload["timestamp"],
            ),
        )
        ledger_entry = LedgerEntry(
            id=entry_id,
            actor=payload["actor"],
            action=payload["action"],
            notes=payload["notes"],
            timestamp=payload["timestamp"],
        )
        _log_change(
            conn,
            "item",
            item_id,
            "ledger.create",
            actor,
            {"entry": ledger_entry.to_dict()},
        )
        return ledger_entry


def update_ledger_entry(
    item_id: str,
    entry_id: str,
    changes: Mapping[str, Any],
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> LedgerEntry:
    if not item_id or not entry_id:
        raise ValidationError("item_id and entry_id are required")
    with _connect(db_path) as conn:
        _fetch_item(conn, item_id)
        row = conn.execute(
            "SELECT * FROM item_ledger WHERE id = ? AND item_id = ?",
            (entry_id, item_id),
        ).fetchone()
        if row is None:
            raise NotFoundError(f"ledger entry not found: {entry_id}")
        before = LedgerEntry(
            id=row["id"],
            actor=row["actor"],
            action=row["action"],
            notes=row["notes"],
            timestamp=row["timestamp"],
        )
        actor_value = (
            changes.get("actor") if "actor" in changes else before.actor
        )
        action_value = (
            changes.get("action") if "action" in changes else before.action
        )
        notes_value = (
            changes.get("notes") if "notes" in changes else before.notes
        )
        timestamp_value = (
            changes.get("timestamp")
            if "timestamp" in changes
            else changes.get("date")
            if "date" in changes
            else before.timestamp
        )
        payload = {
            "actor": str(actor_value or ""),
            "action": str(action_value or ""),
            "notes": str(notes_value or ""),
            "timestamp": _normalize_timestamp(timestamp_value),
        }
        conn.execute(
            "UPDATE item_ledger SET actor = ?, action = ?, notes = ?, timestamp = ?"
            " WHERE id = ? AND item_id = ?",
            (
                payload["actor"],
                payload["action"],
                payload["notes"],
                payload["timestamp"],
                entry_id,
                item_id,
            ),
        )
        after = LedgerEntry(
            id=entry_id,
            actor=payload["actor"],
            action=payload["action"],
            notes=payload["notes"],
            timestamp=payload["timestamp"],
        )
        diff = _entity_diff(before.to_dict(), after.to_dict())
        if diff:
            _log_change(
                conn,
                "item",
                item_id,
                "ledger.update",
                actor,
                {"entry_id": entry_id, "changes": diff},
            )
        return after


def delete_ledger_entry(
    item_id: str,
    entry_id: str,
    *,
    actor: str = "system",
    db_path: str | Path | None = None,
) -> None:
    if not item_id or not entry_id:
        raise ValidationError("item_id and entry_id are required")
    with _connect(db_path) as conn:
        _fetch_item(conn, item_id)
        row = conn.execute(
            "SELECT * FROM item_ledger WHERE id = ? AND item_id = ?",
            (entry_id, item_id),
        ).fetchone()
        if row is None:
            raise NotFoundError(f"ledger entry not found: {entry_id}")
        entry = LedgerEntry(
            id=row["id"],
            actor=row["actor"],
            action=row["action"],
            notes=row["notes"],
            timestamp=row["timestamp"],
        )
        conn.execute(
            "DELETE FROM item_ledger WHERE id = ? AND item_id = ?",
            (entry_id, item_id),
        )
        _log_change(
            conn,
            "item",
            item_id,
            "ledger.delete",
            actor,
            {"entry": entry.to_dict()},
        )


def get_snapshot(*, db_path: str | Path | None = None) -> dict[str, Any]:
    with _connect(db_path) as conn:
        items = [
            _row_to_item(conn, row).to_dict()
            for row in conn.execute(
                "SELECT * FROM items ORDER BY lower(name), id"
            ).fetchall()
        ]
        containers = [
            _row_to_container(row).to_dict()
            for row in conn.execute(
                "SELECT * FROM containers ORDER BY lower(name), id"
            ).fetchall()
        ]
        owners = [
            _row_to_owner(row).to_dict()
            for row in conn.execute(
                "SELECT * FROM owners ORDER BY lower(name), id"
            ).fetchall()
        ]
        locations = [
            _row_to_location(row).to_dict()
            for row in conn.execute(
                "SELECT * FROM locations ORDER BY lower(name), id"
            ).fetchall()
        ]
        sets_ = [
            _row_to_set(row).to_dict()
            for row in conn.execute(
                "SELECT * FROM sets ORDER BY lower(name), id"
            ).fetchall()
        ]
        quest_links = [
            _row_to_quest_link(row).to_dict()
            for row in conn.execute(
                "SELECT * FROM quest_links ORDER BY lower(quest), id"
            ).fetchall()
        ]
    return {
        "items": items,
        "containers": containers,
        "owners": owners,
        "locations": locations,
        "sets": sets_,
        "quest_links": quest_links,
    }


def search_items(
    query: str = "",
    *,
    tags: Sequence[str] | None = None,
    quests: Sequence[str] | None = None,
    owner_id: str | None = None,
    container_id: str | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    normalized_query = (query or "").strip().lower()
    tag_filters = {str(tag).strip().lower() for tag in tags or [] if str(tag).strip()}
    quest_filters = {str(q).strip().lower() for q in quests or [] if str(q).strip()}
    snapshot = get_snapshot(db_path=db_path)
    results: list[dict[str, Any]] = []
    for item in snapshot["items"]:
        if owner_id and item.get("owner_id") != owner_id:
            continue
        if container_id and item.get("container_id") != container_id:
            continue
        if tag_filters and not tag_filters.issubset(
            {str(tag).lower() for tag in item.get("tags", [])}
        ):
            continue
        if quest_filters and not quest_filters.issubset(
            {str(q).lower() for q in item.get("quests", [])}
        ):
            continue
        if normalized_query:
            haystack_parts = [
                str(item.get("name", "")),
                str(item.get("rarity", "")),
                str(item.get("type", "")),
                str(item.get("description", "")),
                str(item.get("notes", "")),
                str(item.get("provenance", {}).get("origin", "")),
            ]
            haystack_parts.extend(item.get("tags", []))
            haystack_parts.extend(item.get("quests", []))
            haystack_parts.extend(
                entry.get("actor", "")
                for entry in item.get("provenance", {}).get("ledger", [])
            )
            haystack = " ".join(part.lower() for part in haystack_parts if part)
            if normalized_query not in haystack:
                continue
        results.append(item)
    results.sort(key=lambda entry: (entry.get("name", "").lower(), entry.get("id", "")))
    return results


def reset_database(*, db_path: str | Path | None = None) -> None:
    path = _resolve_db_path(db_path)
    if path.exists():
        path.unlink()
