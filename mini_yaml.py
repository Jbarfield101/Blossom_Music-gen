"""Lightweight YAML subset parser used across the tooling.

The real project depends on ``PyYAML``/``js-yaml`` for production builds, but
the execution environment for these exercises forbids fetching third-party
packages.  To keep the developer experience consistent we ship a pragmatic
parser that understands the YAML constructs exercised by the DreadHaven vault:

* Key/value mappings with indentation-based nesting
* Sequences expressed via ``-`` list items or inline ``[a, b, c]`` syntax
* Scalars covering strings (quoted or plain), integers, floats and booleans
* Folded (``>``) and literal (``|``) block scalars

The implementation is intentionally strict—syntax errors raise
:class:`YAMLError`—but remains small enough to audit.  Only the features we
need are implemented, so this module should not be treated as a drop-in
replacement for a full YAML engine.
"""

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Iterator, List, Tuple


class YAMLError(Exception):
    """Raised when the YAML payload cannot be parsed."""


@dataclass
class _Line:
    text: str
    indent: int

    @property
    def stripped(self) -> str:
        return self.text.strip()


def _prepare_lines(text: str) -> List[_Line]:
    lines: List[_Line] = []
    for raw in text.replace("\t", "  ").splitlines():
        indent = len(raw) - len(raw.lstrip(" "))
        lines.append(_Line(text=raw.rstrip("\r"), indent=indent))
    return lines


def _next_significant(lines: List[_Line], index: int) -> int | None:
    cursor = index
    while cursor < len(lines):
        if lines[cursor].stripped and not lines[cursor].stripped.startswith("#"):
            return cursor
        cursor += 1
    return None


def _parse_scalar(token: str) -> Any:
    token = token.strip()
    if token == "" or token == "~":
        return ""
    if token.startswith('"') and token.endswith('"'):
        return token[1:-1]
    if token.startswith("'") and token.endswith("'"):
        return token[1:-1]
    lowered = token.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "null":
        return ""
    try:
        if any(ch in token for ch in (".", "e", "E")):
            return float(token)
        return int(token)
    except ValueError:
        return token


def _parse_inline_sequence(token: str) -> List[Any]:
    inner = token.strip()[1:-1]
    if not inner:
        return []
    return [_parse_scalar(part.strip()) for part in inner.split(",")]


def _parse_block_scalar(lines: List[_Line], index: int, base_indent: int, *, fold: bool) -> Tuple[str, int]:
    parts: List[str] = []
    cursor = index
    while cursor < len(lines):
        line = lines[cursor]
        stripped = line.stripped
        if not stripped:
            parts.append("")
            cursor += 1
            continue
        if line.indent < base_indent:
            break
        segment = line.text[base_indent:] if len(line.text) >= base_indent else stripped
        parts.append(segment)
        cursor += 1
    if fold:
        flattened = " ".join(segment.strip() for segment in parts).strip()
        return flattened, cursor
    return "\n".join(parts).rstrip("\n"), cursor


def _parse_sequence(lines: List[_Line], index: int, indent: int) -> Tuple[List[Any], int]:
    items: List[Any] = []
    cursor = index
    while cursor < len(lines):
        line = lines[cursor]
        stripped = line.stripped
        if not stripped or stripped.startswith("#"):
            cursor += 1
            continue
        if line.indent < indent or not stripped.startswith("-"):
            break
        remainder = stripped[1:].strip()
        if not remainder:
            cursor += 1
            next_idx = _next_significant(lines, cursor)
            if next_idx is None:
                items.append("")
                cursor = len(lines)
                break
            next_line = lines[next_idx]
            if next_line.indent <= line.indent:
                items.append("")
                cursor = next_idx
                continue
            if next_line.stripped.startswith("-"):
                sequence, cursor = _parse_sequence(lines, next_idx, next_line.indent)
                items.append(sequence)
            else:
                mapping, cursor = _parse_mapping(lines, next_idx, next_line.indent)
                items.append(mapping)
        elif remainder in {"|", ">"}:
            cursor += 1
            value, cursor = _parse_block_scalar(
                lines, cursor, line.indent + 2, fold=remainder == ">"
            )
            items.append(value)
        elif remainder.startswith("[") and remainder.endswith("]"):
            items.append(_parse_inline_sequence(remainder))
            cursor += 1
        elif ":" in remainder:
            # Inline mapping entry ("- key: value")
            key, value_token = remainder.split(":", 1)
            key = key.strip()
            value_token = value_token.strip()
            if value_token == "":
                cursor += 1
                next_idx = _next_significant(lines, cursor)
                if next_idx is None:
                    items.append({key: ""})
                    cursor = len(lines)
                else:
                    next_line = lines[next_idx]
                    if next_line.indent <= line.indent:
                        items.append({key: ""})
                        cursor = next_idx
                    elif next_line.stripped.startswith("-"):
                        sequence, cursor = _parse_sequence(lines, next_idx, next_line.indent)
                        items.append({key: sequence})
                    else:
                        mapping, cursor = _parse_mapping(lines, next_idx, next_line.indent)
                        items.append({key: mapping})
            else:
                items.append({key: _parse_scalar(value_token)})
                cursor += 1
        else:
            items.append(_parse_scalar(remainder))
            cursor += 1
    return items, cursor


def _parse_mapping(lines: List[_Line], index: int, indent: int) -> Tuple[Dict[str, Any], int]:
    result: Dict[str, Any] = {}
    cursor = index
    while cursor < len(lines):
        line = lines[cursor]
        stripped = line.stripped
        if not stripped or stripped.startswith("#"):
            cursor += 1
            continue
        if line.indent < indent:
            break
        if ":" not in stripped:
            raise YAMLError(f"Malformed line: '{line.text}'")
        key, value_token = stripped.split(":", 1)
        key = key.strip()
        value_token = value_token.strip()
        if value_token == "":
            cursor += 1
            next_idx = _next_significant(lines, cursor)
            if next_idx is None:
                result[key] = ""
                cursor = len(lines)
                continue
            next_line = lines[next_idx]
            if next_line.indent <= line.indent:
                result[key] = ""
                cursor = next_idx
                continue
            if next_line.stripped.startswith("-"):
                sequence, cursor = _parse_sequence(lines, next_idx, next_line.indent)
                result[key] = sequence
            else:
                mapping, cursor = _parse_mapping(lines, next_idx, next_line.indent)
                result[key] = mapping
        elif value_token in {"|", ">"}:
            cursor += 1
            value, cursor = _parse_block_scalar(
                lines, cursor, line.indent + 2, fold=value_token == ">"
            )
            result[key] = value
        elif value_token.startswith("[") and value_token.endswith("]"):
            result[key] = _parse_inline_sequence(value_token)
            cursor += 1
        else:
            result[key] = _parse_scalar(value_token)
            cursor += 1
    return result, cursor


def safe_load(text: str) -> Dict[str, Any]:
    """Parse ``text`` into a nested Python structure."""

    lines = _prepare_lines(text)
    mapping, _ = _parse_mapping(lines, 0, 0)
    return mapping


def _format_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return """"""
    text = str(value)
    if "\n" in text:
        return f"|\n{text}"
    if text == "":
        return """"""
    if any(ch in text for ch in [":", "#", "-", "{", "}", "[", "]"]):
        return f'"{text}"'
    return text


def _dump_list(values: Iterable[Any], indent: int) -> Iterator[str]:
    prefix = " " * indent
    for item in values:
        if isinstance(item, dict):
            yield f"{prefix}-"
            yield from _dump_mapping(item, indent + 2)
        elif isinstance(item, list):
            yield f"{prefix}-"
            yield from _dump_list(item, indent + 2)
        else:
            yield f"{prefix}- {_format_scalar(item)}"


def _dump_mapping(mapping: Dict[str, Any], indent: int) -> Iterator[str]:
    prefix = " " * indent
    for key in mapping:
        value = mapping[key]
        if isinstance(value, dict):
            yield f"{prefix}{key}:"
            yield from _dump_mapping(value, indent + 2)
        elif isinstance(value, list):
            if not value:
                yield f"{prefix}{key}: []"
            else:
                yield f"{prefix}{key}:"
                yield from _dump_list(value, indent + 2)
        else:
            yield f"{prefix}{key}: {_format_scalar(value)}"


def safe_dump(mapping: Dict[str, Any]) -> str:
    """Serialise ``mapping`` into a YAML string."""

    lines = list(_dump_mapping(mapping, 0))
    return "\n".join(lines).rstrip() + "\n"

