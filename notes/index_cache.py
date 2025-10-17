from __future__ import annotations

"""Utility helpers for maintaining the DreadHaven entity index."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import mini_yaml as yaml

INDEX_FILENAME = ".blossom_index.json"
INDEX_VERSION = 1

MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdx"}
ENTITY_TYPES = {"npc", "quest", "loc", "faction", "monster", "encounter", "session"}


class IndexError(Exception):
    """Raised when the index cannot be loaded or persisted."""


@dataclass
class EntityRecord:
    id: str
    type: str
    name: str
    path: str
    mtime: int
    tags: list[str]
    region: str
    location: str
    links: list[str]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalise_path(path: Path) -> str:
    return str(path)


def _load_markdown(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise IndexError(f"{path} is missing YAML front matter")
    try:
        _, remainder = text.split("---", 1)
        frontmatter, _body = remainder.split("\n---", 1)
        frontmatter = frontmatter.lstrip("\r\n")
    except ValueError as exc:
        raise IndexError(f"{path} contains incomplete front matter") from exc
    try:
        data = yaml.safe_load(frontmatter)
    except yaml.YAMLError as exc:  # type: ignore[attr-defined]
        raise IndexError(f"Failed to parse front matter in {path}") from exc
    return data


def _load_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise IndexError(f"Failed to parse JSON in {path}") from exc


def _ensure_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return str(value)


def _ensure_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if isinstance(item, (str, int, float)) or item]
    if isinstance(value, str):
        return [value]
    return []


def _extract_links(metadata: Dict[str, Any]) -> list[str]:
    ledger = metadata.get("relationship_ledger", {})
    links: set[str] = set()
    if isinstance(ledger, dict):
        for bucket in ledger.values():
            if isinstance(bucket, list):
                for entry in bucket:
                    if isinstance(entry, str):
                        if entry:
                            links.add(entry)
                    elif isinstance(entry, dict):
                        candidate = entry.get("id")
                        if isinstance(candidate, str) and candidate:
                            links.add(candidate)
    return sorted(links)


def _derive_entry(path: Path, metadata: Dict[str, Any]) -> EntityRecord:
    entity_id = _ensure_string(metadata.get("id")).strip()
    if not entity_id:
        raise IndexError(f"{path} is missing an entity id")
    entity_type = _ensure_string(metadata.get("type")).lower().strip()
    if entity_type not in ENTITY_TYPES:
        raise IndexError(f"{path} has unsupported entity type '{entity_type}'")
    name = _ensure_string(metadata.get("name")).strip()
    if not name:
        raise IndexError(f"{path} is missing a name")
    stat = path.stat()
    return EntityRecord(
        id=entity_id,
        type=entity_type,
        name=name,
        path=_normalise_path(path),
        mtime=int(stat.st_mtime),
        tags=_ensure_list(metadata.get("tags")),
        region=_ensure_string(metadata.get("region")).strip(),
        location=_ensure_string(metadata.get("location")).strip(),
        links=_extract_links(metadata),
    )


def _entity_to_dict(entity: EntityRecord) -> Dict[str, Any]:
    return {
        "type": entity.type,
        "name": entity.name,
        "path": entity.path,
        "mtime": entity.mtime,
        "tags": entity.tags,
        "region": entity.region,
        "location": entity.location,
        "links": entity.links,
    }


class BlossomIndex:
    """In-memory representation of the blossom index."""

    def __init__(self, root: Path, index_path: Optional[Path] = None) -> None:
        self.root = Path(root)
        self.path = index_path if index_path is not None else self.root / INDEX_FILENAME
        self.entities: Dict[str, Dict[str, Any]] = {}
        self.generated_at = _now_iso()
        self._dirty = False

    # ------------------------------------------------------------------
    # Loading / saving
    # ------------------------------------------------------------------
    def load(self) -> None:
        if not self.path.exists():
            self.entities = {}
            self.generated_at = _now_iso()
            return
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise IndexError(f"Failed to parse {self.path}") from exc
        version = payload.get("version")
        if version != INDEX_VERSION:
            raise IndexError(
                f"Unsupported index version {version}; expected {INDEX_VERSION}"
            )
        self.generated_at = payload.get("generated_at") or _now_iso()
        self.entities = payload.get("entities", {}) or {}

    def save(self, *, force: bool = False) -> None:
        if not self._dirty and not force:
            return
        payload = {
            "version": INDEX_VERSION,
            "generated_at": _now_iso(),
            "entities": self.entities,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        self._dirty = False
        self.generated_at = payload["generated_at"]

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        return self.entities.get(entity_id)

    def remove_by_path(self, path: str) -> bool:
        target = _normalise_path(Path(path))
        removed = [key for key, value in self.entities.items() if value.get("path") == target]
        if not removed:
            return False
        for key in removed:
            self.entities.pop(key, None)
        self._dirty = True
        return True

    def upsert_from_file(self, file_path: Path) -> bool:
        path = Path(file_path)
        if not path.exists():
            return False
        if path.suffix.lower() in MARKDOWN_EXTENSIONS:
            metadata = _load_markdown(path)
        elif path.suffix.lower() == ".json":
            metadata = _load_json(path)
        else:
            return False
        entry = _derive_entry(path, metadata)
        existing = self.entities.get(entry.id)
        payload = _entity_to_dict(entry)
        if existing == payload:
            return False
        self.entities[entry.id] = payload
        self._dirty = True
        return True

    def rebuild(self) -> None:
        self.entities = {}
        for path in sorted(self.root.rglob("*")):
            if not path.is_file():
                continue
            suffix = path.suffix.lower()
            if suffix in MARKDOWN_EXTENSIONS or suffix == ".json":
                try:
                    self.upsert_from_file(path)
                except IndexError:
                    continue
        self._dirty = True


def load_index(root: Path, index_path: Optional[Path] = None) -> BlossomIndex:
    index = BlossomIndex(root, index_path)
    index.load()
    return index


def save_index(index: BlossomIndex, *, force: bool = False) -> None:
    index.save(force=force)
