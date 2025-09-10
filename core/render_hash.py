import hashlib
import json
from pathlib import Path
from typing import Optional

from .song_spec import SongSpec


def render_hash(
    spec: SongSpec,
    cfg: dict,
    sfz_paths: dict[str, Path],
    seed: int,
    minutes: Optional[float],
) -> str:
    """Return SHA256 hex digest for render inputs.

    The hash is based on the song specification, render configuration,
    selected SFZ instruments, seed, and optional target minutes.
    """

    def _json(obj) -> str:
        return json.dumps(obj, sort_keys=True, separators=(",", ":"))

    h = hashlib.sha256()
    h.update(_json(spec.to_dict()).encode("utf-8"))
    h.update(b"\0")
    h.update(_json(cfg).encode("utf-8"))
    h.update(b"\0")
    sfz_map = {k: str(v) for k, v in sfz_paths.items()}
    h.update(_json(sfz_map).encode("utf-8"))
    h.update(b"\0")
    h.update(str(seed).encode("utf-8"))
    h.update(b"\0")
    h.update(str(minutes if minutes is not None else "").encode("utf-8"))
    return h.hexdigest()
