from __future__ import annotations

"""Backfill missing entity IDs across the DreadHaven vault."""

import argparse
import json
import re
import secrets
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple

import mini_yaml as yaml
from notes.index_cache import BlossomIndex, load_index, save_index

ID_PATTERN = re.compile(
    r"^(npc|quest|loc|faction|monster|encounter|session)_[a-z0-9-]{1,24}_[a-z0-9]{4,6}$"
)
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def to_slug(name: str) -> str:
    base = (name or "").strip().lower()
    if not base:
        return "entity"
    slug = re.sub(r"[\s_]+", "-", base)
    slug = re.sub(r"[^a-z0-9-]", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        slug = "entity"
    if len(slug) > 24:
        slug = slug[:24].rstrip("-") or "entity"
    return slug


def make_short_id(length: int = 4) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def ensure_unique(candidate: str, existing: set[str]) -> str:
    if candidate not in existing:
        existing.add(candidate)
        return candidate
    for _ in range(5):
        prefix, slug, _ = candidate.split("_", 2)
        attempt = f"{prefix}_{slug}_{make_short_id()}"
        if attempt not in existing:
            existing.add(attempt)
            return attempt
    length = 6
    while True:
        prefix, slug, _ = candidate.split("_", 2)
        attempt = f"{prefix}_{slug}_{make_short_id(length)}"
        if attempt not in existing:
            existing.add(attempt)
            return attempt
        length = min(length + 1, 6)


def make_id(entity_type: str, name: str, existing: set[str]) -> str:
    prefix = entity_type.strip().lower()
    slug = to_slug(name)
    base = f"{prefix}_{slug}_{make_short_id()}"
    return ensure_unique(base, existing)


def split_frontmatter(text: str) -> Tuple[str, str]:
    if not text.startswith("---"):
        raise ValueError("Missing front matter")
    try:
        _, remainder = text.split("---", 1)
        frontmatter, body = remainder.split("\n---", 1)
    except ValueError as exc:
        raise ValueError("Malformed front matter") from exc
    frontmatter = frontmatter.lstrip("\r\n")
    body = body.lstrip("\r\n")
    return frontmatter, body


def rebuild_markdown(frontmatter: Dict[str, object], body: str) -> str:
    yaml_text = yaml.safe_dump(frontmatter)
    return f"---\n{yaml_text}---\n{body}"


def update_markdown(path: Path, existing: set[str], *, dry_run: bool) -> bool:
    text = path.read_text(encoding="utf-8")
    try:
        frontmatter_src, body = split_frontmatter(text)
        metadata = yaml.safe_load(frontmatter_src)
    except Exception as exc:  # noqa: BLE001
        print(f"[skip] {path}: failed to parse front matter ({exc})", file=sys.stderr)
        return False
    entity_id = str(metadata.get("id") or "").strip()
    entity_type = str(metadata.get("type") or "").strip().lower()
    name = str(metadata.get("name") or path.stem)
    if entity_type not in {"npc", "quest", "loc", "faction", "monster", "encounter", "session"}:
        print(f"[skip] {path}: unsupported entity type '{entity_type}'", file=sys.stderr)
        return False
    if ID_PATTERN.match(entity_id):
        existing.add(entity_id)
        return False
    new_id = make_id(entity_type, name, existing)
    metadata["id"] = new_id
    if dry_run:
        print(f"[dry-run] {path}: would assign id {new_id}")
        return True
    path.write_text(rebuild_markdown(metadata, body), encoding="utf-8")
    print(f"[update] {path}: assigned id {new_id}")
    return True


def update_json(path: Path, existing: set[str], *, dry_run: bool) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # type: ignore[attr-defined]
        print(f"[skip] {path}: failed to parse json ({exc})", file=sys.stderr)
        return False
    entity_type = str(data.get("type") or "").strip().lower()
    name = str(data.get("name") or path.stem)
    entity_id = str(data.get("id") or "").strip()
    if entity_type not in {"npc", "quest", "loc", "faction", "monster", "encounter", "session"}:
        print(f"[skip] {path}: unsupported entity type '{entity_type}'", file=sys.stderr)
        return False
    if ID_PATTERN.match(entity_id):
        existing.add(entity_id)
        return False
    new_id = make_id(entity_type, name, existing)
    data["id"] = new_id
    if dry_run:
        print(f"[dry-run] {path}: would assign id {new_id}")
        return True
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[update] {path}: assigned id {new_id}")
    return True


def collect_existing_ids(paths: Iterable[Path]) -> set[str]:
    ids: set[str] = set()
    for path in paths:
        if not path.exists() or not path.is_file():
            continue
        try:
            if path.suffix.lower() in {".md", ".markdown", ".mdx"}:
                frontmatter_src, _ = split_frontmatter(path.read_text(encoding="utf-8"))
                metadata = yaml.safe_load(frontmatter_src)
            elif path.suffix.lower() == ".json":
                metadata = json.loads(path.read_text(encoding="utf-8"))
            else:
                continue
        except Exception:  # noqa: BLE001
            continue
        entity_id = str(metadata.get("id") or "").strip()
        if ID_PATTERN.match(entity_id):
            ids.add(entity_id)
    return ids


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("vault", type=Path, help="Path to the DreadHaven vault")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing files")
    args = parser.parse_args(argv)

    vault = args.vault.expanduser().resolve()
    if not vault.exists() or not vault.is_dir():
        print(f"Vault directory not found: {vault}", file=sys.stderr)
        return 1

    files = [p for p in vault.rglob("*") if p.suffix.lower() in {".md", ".markdown", ".mdx", ".json"}]
    existing_ids = collect_existing_ids(files)
    updated = 0
    errors = 0

    for path in files:
        try:
            if path.suffix.lower() in {".md", ".markdown", ".mdx"}:
                changed = update_markdown(path, existing_ids, dry_run=args.dry_run)
            else:
                changed = update_json(path, existing_ids, dry_run=args.dry_run)
            if changed:
                updated += 1
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print(f"[error] {path}: {exc}", file=sys.stderr)

    if not args.dry_run:
        try:
            index = load_index(vault)
        except Exception:
            index = BlossomIndex(vault, vault / ".blossom_index.json")
        for path in files:
            if path.suffix.lower() in {".md", ".markdown", ".mdx", ".json"}:
                try:
                    index.upsert_from_file(path)
                except Exception:
                    continue
        save_index(index, force=True)

    print(f"Updated {updated} file(s); {errors} errors.")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
