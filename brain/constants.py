from __future__ import annotations

from pathlib import Path

# Default root folder for DreadHaven campaign notes when no Obsidian vault
# has been configured. Used by chat fallbacks and service APIs.
DEFAULT_DREADHAVEN_ROOT = Path(r"D:\\Documents\\DreadHaven")

# Terms to exclude when searching to avoid pulling in non-D&D IP like LotR
BANNED_TERMS = [
    "middle-earth",
    "middle earth",
    "tolkien",
    "gondor",
    "gondorian",
    "minas tirith",
    "sauron",
    "mordor",
]

# Directory name hints (case-insensitive) to prioritize when searching for gods
GOD_DIR_HINTS = [
    "god",          # matches God, Gods
    "pantheon",
    "deities",
    "gods of the realm",
]
