"""Utilities for repairing NPC notes against the canonical template.

This module exposes helpers used by the NPC repair worker that validate
frontmatter fields, ensure required sections exist and orchestrate language
model prompts to backfill missing content.  The functions intentionally avoid
side effects so they can be exercised from unit tests or alternative entry
points.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping
import copy
import json
import re

import frontmatter

from scripts.backfill_dnd_ids import generate_unique_npc_id, is_valid_npc_id

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "dnd_templates"
    / "NPC_Template.md"
)

_SECTION_HEADING_RE = re.compile(r"^##\s+.+$", re.MULTILINE)


@dataclass(frozen=True)
class TemplateSection:
    """Represents a section defined in the NPC template."""

    heading: str
    placeholder: str


@dataclass
class NpcTemplate:
    """Frontmatter defaults and section definitions for NPC notes."""

    metadata: Dict[str, Any]
    sections: List[TemplateSection]


@dataclass
class NpcNote:
    """In-memory representation of an NPC note being repaired."""

    path: Path
    metadata: MutableMapping[str, Any]
    prefix: str
    sections: MutableMapping[str, str]
    order: List[str]

    def clone(self) -> "NpcNote":
        return NpcNote(
            path=self.path,
            metadata=copy.deepcopy(dict(self.metadata)),
            prefix=self.prefix,
            sections=copy.deepcopy(dict(self.sections)),
            order=list(self.order),
        )


def _split_sections(body: str) -> tuple[str, Dict[str, str], List[str]]:
    """Return the prefix text, section map and heading order for ``body``."""

    matches = list(_SECTION_HEADING_RE.finditer(body))
    if not matches:
        return body.strip(), {}, []

    prefix = body[: matches[0].start()].strip()
    sections: Dict[str, str] = {}
    order: List[str] = []
    for idx, match in enumerate(matches):
        heading = match.group(0).strip()
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        section_body = body[start:end].strip()
        sections[heading] = section_body
        order.append(heading)
    return prefix, sections, order


def _read_template(path: Path) -> tuple[Mapping[str, Any], str]:
    raw = path.read_text(encoding="utf-8")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise ValueError(f"Template at {path} is missing frontmatter")
    _, fm_block, remainder = parts
    metadata = frontmatter.loads(f"---\n{fm_block.strip()}\n---\n").metadata or {}
    return metadata, remainder.strip()


def load_template(path: Path | None = None) -> NpcTemplate:
    """Load and parse the canonical NPC template."""

    template_path = path or TEMPLATE_PATH
    metadata_raw, body = _read_template(template_path)
    prefix, sections_map, order = _split_sections(body)
    _ = prefix  # The template prefix only contains the H1 heading.
    sections: List[TemplateSection] = []
    for heading in order:
        placeholder = sections_map.get(heading, "")
        sections.append(TemplateSection(heading=heading, placeholder=placeholder))
    return NpcTemplate(metadata=dict(metadata_raw), sections=sections)


def load_note(path: Path) -> NpcNote:
    """Load ``path`` into an :class:`NpcNote` instance."""

    post = frontmatter.load(path)
    metadata_raw = post.metadata or {}
    metadata = dict(metadata_raw) if isinstance(metadata_raw, dict) else {}

    aliases = metadata.get("aliases", [])
    if isinstance(aliases, str):
        aliases = [aliases.strip()] if aliases.strip() else []
    elif isinstance(aliases, Iterable):
        normalized_aliases = []
        for alias in aliases:
            if alias is None:
                continue
            text = str(alias).strip()
            if text:
                normalized_aliases.append(text)
        aliases = normalized_aliases
    else:
        aliases = []
    metadata["aliases"] = list(aliases)

    tags = metadata.get("tags", [])
    if isinstance(tags, str):
        tags = [t for t in re.split(r"[ ,]+", tags) if t]
    elif isinstance(tags, Iterable):
        normalized_tags = []
        for tag in tags:
            if tag is None:
                continue
            text = str(tag).strip()
            if text:
                normalized_tags.append(text)
        tags = normalized_tags
    else:
        tags = []
    metadata["tags"] = list(tags)

    content = post.content or ""
    prefix, sections, order = _split_sections(content)
    return NpcNote(
        path=Path(path),
        metadata=metadata,
        prefix=prefix,
        sections=sections,
        order=order,
    )


def _is_placeholder_string(value: str) -> bool:
    stripped = value.strip().lower()
    return stripped in {"", "...", "…"}


def _value_is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return _is_placeholder_string(value)
    if isinstance(value, Mapping):
        return not value
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
        has_content = False
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                if not _is_placeholder_string(item):
                    has_content = True
                    break
            elif isinstance(item, Mapping):
                if item:
                    has_content = True
                    break
            else:
                has_content = True
                break
        return not has_content
    return False


def ensure_metadata(
    note: NpcNote,
    template: NpcTemplate,
    existing_ids: set[str],
) -> tuple[bool, str | None, str | None]:
    """Ensure required metadata exists, returning change flags.

    Returns
    -------
    tuple
        ``(changed, new_id, previous_id)``
    """

    changed = False
    metadata = note.metadata
    name = str(metadata.get("name") or metadata.get("title") or note.path.stem)

    current_id = metadata.get("id")
    normalized_id = str(current_id).strip() if isinstance(current_id, str) else None
    if normalized_id:
        if not is_valid_npc_id(normalized_id):
            if normalized_id in existing_ids:
                existing_ids.remove(normalized_id)
            normalized_id = None
        else:
            existing_ids.add(normalized_id)
    previous_id: str | None = None
    if not normalized_id:
        previous_id = current_id if isinstance(current_id, str) else None
        new_id = generate_unique_npc_id(name, existing_ids)
        metadata["id"] = new_id
        changed = True
        normalized_id = new_id
    else:
        metadata["id"] = normalized_id

    if metadata.get("type") != "npc":
        metadata["type"] = "npc"
        changed = True

    for key, default in template.metadata.items():
        if key == "id":
            continue
        current = metadata.get(key)
        if _value_is_empty(current):
            default_copy = copy.deepcopy(default)
            if current != default_copy:
                metadata[key] = default_copy
                changed = True

    return changed, normalized_id, previous_id


def find_missing_sections(note: NpcNote, template: NpcTemplate) -> List[str]:
    missing: List[str] = []
    for section in template.sections:
        current = note.sections.get(section.heading)
        if current is None:
            missing.append(section.heading)
            continue
        content = current.strip()
        if not content:
            missing.append(section.heading)
            continue
        placeholder = section.placeholder.strip()
        if placeholder and content == placeholder:
            missing.append(section.heading)
            continue
        if all(line.strip() in {"...", "…", "- ..."} for line in content.splitlines() if line.strip()):
            missing.append(section.heading)
    return missing


def build_prompt(note: NpcNote, missing_sections: Iterable[str]) -> str:
    metadata_json = json.dumps(note.metadata, indent=2, ensure_ascii=False)
    existing_sections = []
    for heading in note.order:
        if heading not in missing_sections:
            body = note.sections.get(heading, "").strip()
            if body:
                existing_sections.append(f"{heading}\n{body}")
    existing_text = "\n\n".join(existing_sections) if existing_sections else "(none)"
    missing_list = "\n".join(f"- {heading}" for heading in missing_sections)
    prompt = (
        "You are repairing a Markdown knowledge base entry for a Dungeons & Dragons NPC.\n"
        "Each note follows a strict template and only the listed sections are missing or empty.\n"
        "Use the provided frontmatter metadata and existing sections as canonical truth.\n"
        "Fill in ONLY the missing sections. Respond with a JSON object whose keys are the exact section headings\n"
        "(including emoji) and whose values are Markdown strings for that section. Do not include headings in the values.\n"
        "Do not invent contradictory facts. Prefer grounded, concise bullet points when the template suggests them.\n"
        "Do not modify any section that is already populated.\n"
        "If you lack sufficient information, craft plausible yet restrained lore that fits the metadata.\n"
        "Missing sections:\n"
        f"{missing_list}\n\n"
        "Frontmatter (JSON):\n"
        f"{metadata_json}\n\n"
        "Existing populated sections:\n"
        f"{existing_text}\n\n"
        "Return JSON only."
    )
    return prompt


def merge_sections(note: NpcNote, updates: Mapping[str, str]) -> bool:
    changed = False
    for heading, content in updates.items():
        normalized = content.strip()
        if not normalized:
            continue
        existing = note.sections.get(heading)
        if existing and existing.strip():
            continue
        note.sections[heading] = normalized
        if heading not in note.order:
            note.order.append(heading)
        changed = True
    return changed


def render_note(note: NpcNote) -> str:
    blocks: List[str] = []
    prefix = note.prefix.strip()
    if prefix:
        blocks.append(prefix)
    seen = set()
    for heading in note.order:
        seen.add(heading)
        body = note.sections.get(heading, "").strip()
        if body:
            blocks.append(f"{heading}\n{body}")
        else:
            blocks.append(f"{heading}")
    # Append any sections that were not originally ordered but exist in map
    for heading, body in note.sections.items():
        if heading in seen:
            continue
        normalized = body.strip()
        if normalized:
            blocks.append(f"{heading}\n{normalized}")
        else:
            blocks.append(heading)
    rendered = "\n\n".join(blocks).rstrip() + "\n"
    return rendered


def serialise_post(metadata: Mapping[str, Any], content: str) -> str:
    post = frontmatter.Post(content=content, metadata=dict(metadata))
    return frontmatter.dumps(post)


__all__ = [
    "NpcNote",
    "NpcTemplate",
    "TemplateSection",
    "build_prompt",
    "ensure_metadata",
    "find_missing_sections",
    "load_note",
    "load_template",
    "merge_sections",
    "render_note",
    "serialise_post",
]

