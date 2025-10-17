"""Compatibility layer for the legacy notes indexer API."""
from __future__ import annotations

from typing import Any, Dict

from .index_cache import (  # re-export for backwards compatibility
    INDEX_FILENAME,
    INDEX_VERSION,
    get_by_id as get_by_id,
    load_index as load_index,
    remove_by_path as remove_by_path,
    reset_index as reset_index,
    save_index as save_index,
    upsert_from_file as upsert_from_file,
)

ParsedIndex = Dict[str, Any]

__all__ = [
    "INDEX_FILENAME",
    "INDEX_VERSION",
    "get_by_id",
    "load_index",
    "remove_by_path",
    "reset_index",
    "save_index",
    "upsert_from_file",
    "ParsedIndex",
]
