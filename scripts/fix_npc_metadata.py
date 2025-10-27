from __future__ import annotations

"""Normalise NPC frontmatter metadata within the DreadHaven vault."""

import ast
import sys
from pathlib import Path
from typing import Any, Dict

import frontmatter as fm

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from brain.constants import DEFAULT_DREADHAVEN_ROOT  # noqa: E402
from notes import index_cache  # noqa: E402
from notes.parser import parse_note  # noqa: E402


SCAN_LIMIT = 200  # only inspect the first N lines of the body for stray metadata
SKIP_KEYS = {"id"}  # do not overwrite canonical identifiers


def _should_replace(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _coerce_value(raw: str) -> Any:
    text = raw.strip()
    if not text:
        return ""
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if text[0] in {"[", "{"} and text[-1] in {"]", "}"}:
        try:
            return ast.literal_eval(text)
        except (SyntaxError, ValueError):
            inner = text[1:-1].strip()
            if not inner:
                return []
            items = [part.strip() for part in inner.split(",") if part.strip()]
            return items
    if text[0] in {"'", '"'} and text[-1] == text[0]:
        return text[1:-1]
    return text


def _extract_inline_metadata(content: str) -> Dict[str, Any]:
    inline: Dict[str, Any] = {}
    lines = content.splitlines()
    seen_metadata_line = False
    for idx, line in enumerate(lines[:SCAN_LIMIT]):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("## "):
            if seen_metadata_line:
                break
            continue
        if stripped.startswith("---") or stripped.startswith("#"):
            continue
        if stripped.startswith("-"):
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key or key.lower() in SKIP_KEYS:
            continue
        if not value:
            continue
        inline[key] = _coerce_value(value)
        seen_metadata_line = True
    return inline


def _normalize_npc_note(path: Path, vault: Path) -> bool:
    with path.open("r", encoding="utf-8") as handle:
        post = fm.load(handle)

    metadata = dict(post.metadata or {})
    inline = _extract_inline_metadata(post.content or "")

    updated = False
    changes: list[str] = []

    for key, value in list(metadata.items()):
        if isinstance(value, str) and value.startswith(("[", "{")) and value.endswith(("]", "}")):
            normalized = _coerce_value(value)
            if normalized != value:
                metadata[key] = normalized
                updated = True
                if key not in changes:
                    changes.append(key)
    for key, value in inline.items():
        if key not in metadata or _should_replace(metadata.get(key)):
            if key not in metadata or metadata.get(key) != value:
                metadata[key] = value
                updated = True
                if key not in changes:
                    changes.append(key)

    if metadata.get("type") != "npc":
        metadata["type"] = "npc"
        updated = True
        if "type" not in changes:
            changes.append("type")

    tags_value = metadata.get("tags")
    normalized_tags: list[str]
    if isinstance(tags_value, str):
        normalized = _coerce_value(tags_value)
        if normalized != tags_value:
            metadata["tags"] = normalized
            tags_value = normalized
            updated = True
            if "tags" not in changes:
                changes.append("tags")
    if isinstance(tags_value, list):
        normalized_tags = [str(tag).strip() for tag in tags_value if str(tag).strip()]
        if "npc" not in normalized_tags:
            normalized_tags.append("npc")
            metadata["tags"] = normalized_tags
            updated = True
            if "tags" not in changes:
                changes.append("tags")
    else:
        metadata["tags"] = ["npc"]
        updated = True
        if "tags" not in changes:
            changes.append("tags")

    if not updated:
        return False

    post.metadata = metadata
    serialised = fm.dumps(post)
    path.write_text(serialised, encoding="utf-8")

    rel_path = path.relative_to(vault)
    parsed = parse_note(path)
    index_cache.upsert_from_file(vault, rel_path, parsed=parsed)
    print(f"Normalised {rel_path.as_posix()} ({', '.join(changes)})")
    return True


def main() -> int:
    vault = DEFAULT_DREADHAVEN_ROOT.expanduser().resolve()
    npc_root = vault / "20_DM" / "NPC"
    if not npc_root.exists():
        print(f"NPC directory {npc_root} does not exist", file=sys.stderr)
        return 1

    changed = []
    for path in sorted(npc_root.rglob("*.md")):
        if _normalize_npc_note(path, vault):
            changed.append(path)

    if changed:
        index_cache.save_index(vault, force=True)
    print(f"Updated {len(changed)} NPC notes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
