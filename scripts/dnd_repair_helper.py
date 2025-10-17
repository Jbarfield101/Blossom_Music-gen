#!/usr/bin/env python3
"""Worker process that repairs NPC notes based on the canonical template."""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

from brain.constants import DEFAULT_DREADHAVEN_ROOT
from brain.ollama_client import generate as generate_llm_text
from notes import index_cache
from notes.parser import NoteParseError, parse_note
from notes.repair_npc import (
    build_prompt,
    ensure_metadata,
    find_missing_sections,
    load_note,
    load_template,
    merge_sections,
    render_note,
    serialise_post,
)


@dataclass
class RepairOutcome:
    npc_id: str
    status: str
    message: Optional[str] = None
    error: Optional[str] = None
    updated: bool = False
    new_id: Optional[str] = None
    previous_id: Optional[str] = None


def _print_event(payload: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _load_request() -> tuple[int, List[str]]:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive guard
        raise SystemExit(f"Invalid repair request: {exc}")
    run_id = int(payload.get("run_id", 0))
    npc_ids_raw = payload.get("npc_ids") or []
    npc_ids: List[str] = []
    for entry in npc_ids_raw:
        if not entry:
            continue
        text = str(entry).strip()
        if text:
            npc_ids.append(text)
    return run_id, npc_ids


def _resolve_vault() -> Path:
    vault = DEFAULT_DREADHAVEN_ROOT.expanduser().resolve()
    if not vault.exists():
        raise FileNotFoundError(
            f"DreadHaven vault not found at {vault}. Configure DEFAULT_DREADHAVEN_ROOT before running repairs."
        )
    return vault


def _load_index_entities(vault: Path) -> Dict[str, Dict[str, Any]]:
    data = index_cache.load_index(vault)
    entities = data.get("entities") if isinstance(data, dict) else None
    if not isinstance(entities, dict):
        return {}
    return entities


def _collect_existing_ids(entities: Mapping[str, Mapping[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for entity_id in entities:
        if isinstance(entity_id, str) and entity_id.strip():
            ids.add(entity_id.strip())
    return ids


def _call_generate_llm(prompt: str) -> str:
    """Proxy to the same Ollama client used by the generate_llm command."""

    return generate_llm_text(prompt)


def _parse_llm_response(raw: str, expected: Iterable[str]) -> Dict[str, str]:
    text = raw.strip()
    if text.startswith("```"):
        fence_end = text.find("\n")
        if fence_end != -1:
            text = text[fence_end + 1 :]
        if text.endswith("```"):
            text = text[: -3]
    cleaned = text.strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM did not return valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("LLM response must be a JSON object")
    updates: Dict[str, str] = {}
    allowed = {heading for heading in expected}
    for heading, value in data.items():
        if heading not in allowed:
            continue
        if isinstance(value, str):
            updates[heading] = value
    return updates


def _repair_single(
    vault: Path,
    rel_path: Path,
    npc_id: str,
    existing_ids: set[str],
    template,
) -> RepairOutcome:
    abs_path = vault / rel_path
    if not abs_path.exists():
        return RepairOutcome(
            npc_id=npc_id,
            status="failed",
            error=f"NPC note not found at {rel_path.as_posix()}",
            message="Missing file",
        )

    outcome = RepairOutcome(npc_id=npc_id, status="pending", message="Starting repair")
    try:
        note = load_note(abs_path)
    except Exception as exc:
        return RepairOutcome(
            npc_id=npc_id,
            status="failed",
            error=f"Failed to load note: {exc}",
            message="Parse error",
        )

    metadata_changed, new_id, previous_id = ensure_metadata(note, template, existing_ids)
    missing_sections = find_missing_sections(note, template)

    sections_changed = False
    llm_updates: Dict[str, str] = {}
    if missing_sections:
        prompt = build_prompt(note, missing_sections)
        try:
            raw = _call_generate_llm(prompt)
            llm_updates = _parse_llm_response(raw, missing_sections)
            missing_left: List[str] = []
            for heading in missing_sections:
                value = llm_updates.get(heading, "")
                normalized = value.strip()
                if not normalized or normalized in {"...", "…"}:
                    missing_left.append(heading)
            if missing_left:
                return RepairOutcome(
                    npc_id=npc_id,
                    status="failed",
                    error=f"LLM did not return content for: {', '.join(missing_left)}",
                    message="Incomplete generation",
                )
        except Exception as exc:
            return RepairOutcome(
                npc_id=npc_id,
                status="failed",
                error=f"LLM generation failed: {exc}",
                message="Generation error",
            )
        sections_changed = merge_sections(note, llm_updates)

    updated = metadata_changed or sections_changed
    if updated:
        content = render_note(note)
        text = serialise_post(note.metadata, content)
        try:
            abs_path.write_text(text, encoding="utf-8")
        except OSError as exc:
            return RepairOutcome(
                npc_id=npc_id,
                status="failed",
                error=f"Failed to write note: {exc}",
                message="Write error",
            )

        try:
            parsed = parse_note(abs_path)
        except NoteParseError as exc:
            return RepairOutcome(
                npc_id=npc_id,
                status="failed",
                error=f"Updated note is invalid: {exc}",
                message="Validation error",
                updated=True,
            )

        rel_posix = rel_path.as_posix()
        try:
            index_cache.upsert_from_file(vault, rel_posix, parsed=parsed)
        except Exception as exc:
            return RepairOutcome(
                npc_id=npc_id,
                status="failed",
                error=f"Failed to update index: {exc}",
                message="Index update error",
                updated=True,
            )

    status = "verified"
    message_parts: List[str] = []
    if sections_changed:
        message_parts.append("Filled missing sections")
    if metadata_changed:
        message_parts.append("Updated frontmatter")
    if not message_parts:
        message_parts.append("No changes needed")

    return RepairOutcome(
        npc_id=npc_id,
        status=status,
        message=", ".join(message_parts),
        updated=updated,
        new_id=new_id if previous_id else None,
        previous_id=previous_id,
    )


def main() -> int:
    run_id, npc_ids = _load_request()
    start_time = time.time()
    vault = _resolve_vault()
    entities = _load_index_entities(vault)
    existing_ids = _collect_existing_ids(entities)
    template = load_template()

    status_map: Dict[str, str] = {}
    verified: List[str] = []
    failed: List[str] = []
    errors: Dict[str, str] = {}
    any_updates = False

    _print_event({"run_id": run_id, "status": "started", "total": len(npc_ids)})

    for npc_id in npc_ids:
        rel_entry = entities.get(npc_id)
        rel_path_str = rel_entry.get("path") if isinstance(rel_entry, Mapping) else None
        if not rel_path_str:
            outcome = RepairOutcome(
                npc_id=npc_id,
                status="failed",
                error="NPC is missing from the index",
                message="Index lookup failed",
            )
        else:
            rel_path = Path(rel_path_str)
            outcome = _repair_single(vault, rel_path, npc_id, existing_ids, template)

        payload = {
            "run_id": run_id,
            "npc_id": npc_id,
            "status": outcome.status,
            "message": outcome.message,
            "updated": outcome.updated,
        }
        if outcome.error:
            payload["error"] = outcome.error
        if outcome.new_id and outcome.new_id != npc_id:
            payload["new_id"] = outcome.new_id
        if outcome.previous_id and outcome.previous_id != npc_id:
            payload["previous_id"] = outcome.previous_id
        _print_event(payload)

        if outcome.new_id and outcome.new_id != npc_id and rel_path_str:
            entities[outcome.new_id] = dict(rel_entry or {}) if isinstance(rel_entry, Mapping) else {}
            entities[outcome.new_id]["path"] = rel_path_str

        status_map[npc_id] = outcome.status
        if outcome.status == "verified":
            verified.append(npc_id)
        else:
            failed.append(npc_id)
            if outcome.error:
                errors[npc_id] = outcome.error
        if outcome.updated:
            any_updates = True

    if any_updates:
        index_cache.save_index(vault, force=True)

    duration_ms = int((time.time() - start_time) * 1000)
    summary = {
        "run_id": run_id,
        "total": len(npc_ids),
        "requested": npc_ids,
        "status_map": status_map,
        "verified": verified,
        "failed": failed,
        "duration_ms": duration_ms,
        "errors": errors,
    }
    _print_event({"run_id": run_id, "summary": summary, "status": "completed"})
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(main())

