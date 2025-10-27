from __future__ import annotations

"""CLI utility to backfill Dreadhaven entity IDs."""

import argparse
import io
import logging
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import frontmatter

from brain.constants import DEFAULT_DREADHAVEN_ROOT
from notes import index_cache
from notes.parser import NoteParseError, ParsedNote, parse_note

NPC_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
NPC_ID_SHORT_LEN = 4
NPC_ID_PREFIX = "npc"
NPC_ID_SLUG_MAX_LEN = 24
NPC_ID_PATTERN = re.compile(r"^npc_[a-z0-9-]{1,24}_[a-z0-9]{4}$")


@dataclass
class BackfillSummary:
    """Result counters for a backfill run."""

    updated: int = 0
    skipped: int = 0
    errors: int = 0


def is_valid_npc_id(value: str | None) -> bool:
    """Return ``True`` when ``value`` already matches the NPC ID format."""

    if not value:
        return False
    return bool(NPC_ID_PATTERN.fullmatch(value))


def _coerce_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    text = str(value).strip()
    return text or None


def npc_slug(name: str) -> str:
    base = name.strip().lower()
    if not base:
        return "entity"

    replaced_chars = []
    for char in base:
        if "a" <= char <= "z" or "0" <= char <= "9":
            replaced_chars.append(char)
        elif char == "-":
            replaced_chars.append("-")
        elif char in {" ", "_"}:
            replaced_chars.append("-")
        else:
            replaced_chars.append("-")

    collapsed_chars = []
    prev_dash = False
    for char in replaced_chars:
        if char == "-":
            if not prev_dash:
                collapsed_chars.append(char)
                prev_dash = True
            continue
        collapsed_chars.append(char)
        prev_dash = False

    slug = "".join(collapsed_chars).strip("-")
    if not slug:
        slug = "entity"

    if len(slug) > NPC_ID_SLUG_MAX_LEN:
        slug = slug[:NPC_ID_SLUG_MAX_LEN]
        while slug.endswith("-"):
            slug = slug[:-1]
        if not slug:
            slug = "entity"

    return slug


def _make_short_id(length: int) -> str:
    if length <= 0:
        return ""

    pool: list[int] = []
    chars: list[str] = []
    alphabet_length = len(NPC_ID_ALPHABET)
    while len(chars) < length:
        if not pool:
            pool.extend(uuid.uuid4().bytes)
        byte = pool.pop()
        chars.append(NPC_ID_ALPHABET[byte % alphabet_length])
    return "".join(chars)


def generate_unique_npc_id(name: str, existing: set[str]) -> str:
    slug = npc_slug(name)
    for _ in range(5):
        candidate = f"{NPC_ID_PREFIX}_{slug}_{_make_short_id(NPC_ID_SHORT_LEN)}"
        if candidate not in existing:
            existing.add(candidate)
            return candidate
    while True:
        candidate = f"{NPC_ID_PREFIX}_{slug}_{_make_short_id(NPC_ID_SHORT_LEN + 4)}"
        if candidate not in existing:
            existing.add(candidate)
            return candidate


def _format_metadata_value(value: Any) -> str:
    if isinstance(value, list):
        items = ", ".join(str(item) for item in value)
        return f"[{items}]"
    return str(value)


def _serialise_post(post: Any) -> str:
    if hasattr(frontmatter, "dumps"):
        return frontmatter.dumps(post)  # type: ignore[attr-defined]
    if hasattr(frontmatter, "dump"):
        buffer = io.StringIO()
        frontmatter.dump(post, buffer)  # type: ignore[attr-defined]
        return buffer.getvalue()
    metadata = post.metadata if isinstance(post.metadata, dict) else {}
    lines = ["---"]
    for key, value in metadata.items():
        lines.append(f"{key}: {_format_metadata_value(value)}")
    lines.append("---")
    content = getattr(post, "content", "") or ""
    if content:
        if content.startswith("\n"):
            body = content
        else:
            body = "\n" + content
    else:
        body = "\n"
    return "\n".join(lines) + body


def _select_entity_name(metadata: dict[str, Any], path: Path) -> str:
    for key in ("name", "title"):
        value = _coerce_str(metadata.get(key))
        if value:
            return value
    return path.stem


def _iter_note_files(vault: Path) -> Iterable[Path]:
    for path in sorted(vault.rglob("*.md")):
        relative_parts = path.relative_to(vault).parts
        if any(part.startswith(".") for part in relative_parts):
            continue
        yield path


def backfill_dnd_ids(vault: Path, *, dry_run: bool = False, logger: logging.Logger | None = None) -> BackfillSummary:
    active_logger = logger or logging.getLogger("backfill_dnd_ids")
    summary = BackfillSummary()
    resolved_vault = Path(vault).expanduser().resolve()
    if not resolved_vault.exists():
        active_logger.error("Vault %s does not exist", resolved_vault)
        summary.errors += 1
        return summary

    notes_to_process: list[tuple[Path, Path, ParsedNote]] = []
    existing_ids: set[str] = set()

    for note_path in _iter_note_files(resolved_vault):
        relative = note_path.relative_to(resolved_vault)
        try:
            parsed = parse_note(note_path)
        except NoteParseError as exc:
            active_logger.error("Failed to parse %s: %s", note_path, exc)
            summary.errors += 1
            continue

        metadata = parsed.metadata or {}
        current_id = _coerce_str(metadata.get("id"))
        if current_id and is_valid_npc_id(current_id):
            existing_ids.add(current_id)
        notes_to_process.append((note_path, relative, parsed))

    for note_path, relative, parsed in notes_to_process:
        metadata = parsed.metadata or {}
        current_id = _coerce_str(metadata.get("id"))
        rel_display = relative.as_posix()
        if current_id and is_valid_npc_id(current_id):
            summary.skipped += 1
            continue

        entity_name = _select_entity_name(metadata, note_path)
        new_id = generate_unique_npc_id(entity_name, existing_ids)

        if dry_run:
            summary.updated += 1
            active_logger.info("Would assign %s to %s", new_id, rel_display)
            continue

        try:
            with note_path.open("r", encoding="utf-8") as handle:
                post = frontmatter.load(handle)
        except Exception as exc:  # pragma: no cover - defensive guard
            summary.errors += 1
            active_logger.error("Failed to load %s: %s", note_path, exc)
            existing_ids.discard(new_id)
            continue

        metadata_out = dict(post.metadata) if isinstance(post.metadata, dict) else {}
        metadata_out["id"] = new_id
        post.metadata = metadata_out

        try:
            note_path.write_text(_serialise_post(post), encoding="utf-8")
        except Exception as exc:  # pragma: no cover - defensive guard
            summary.errors += 1
            active_logger.error("Failed to write %s: %s", note_path, exc)
            existing_ids.discard(new_id)
            continue

        parsed.metadata["id"] = new_id
        try:
            index_cache.upsert_from_file(resolved_vault, relative, parsed=parsed)
        except Exception as exc:  # pragma: no cover - defensive guard
            summary.errors += 1
            active_logger.error("Failed to update cache for %s: %s", rel_display, exc)
            continue

        summary.updated += 1
        active_logger.info("Assigned %s to %s", new_id, rel_display)

    if summary.updated and not dry_run:
        try:
            index_cache.save_index(resolved_vault, force=True)
        except Exception as exc:
            summary.errors += 1
            active_logger.error("Failed to persist index: %s", exc)

    active_logger.info(
        "Backfill complete: %s updated, %s skipped, %s errors",
        summary.updated,
        summary.skipped,
        summary.errors,
    )
    return summary


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill Dreadhaven entity IDs")
    parser.add_argument(
        "--vault",
        type=Path,
        default=DEFAULT_DREADHAVEN_ROOT,
        help="Path to the Dreadhaven vault (defaults to brain.constants.DEFAULT_DREADHAVEN_ROOT)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report planned changes without writing files",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Logging level (default: INFO)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_arg_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(level=getattr(logging, str(args.log_level).upper(), logging.INFO))
    summary = backfill_dnd_ids(args.vault, dry_run=args.dry_run)
    return 0 if summary.errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
