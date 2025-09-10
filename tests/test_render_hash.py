import json
import subprocess
import sys
import struct
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.song_spec import SongSpec
from core import utils


def _write_spec(path: Path) -> None:
    spec = {
        "title": "HashTest",
        "tempo": 120,
        "meter": "4/4",
        "sections": [{"name": "A", "length": 1}],
        "harmony_grid": [{"section": "A", "chords": ["C"]}],
        "density_curve": {"A": 1.0},
        "register_policy": {
            "drums": [36, 50],
            "bass": [40, 60],
            "keys": [60, 72],
            "pads": [60, 72],
        },
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(spec, fh)


def _read_icmt(path: Path) -> str | None:
    data = path.read_bytes()
    pos = 12  # skip RIFF header
    while pos + 8 <= len(data):
        chunk_id = data[pos : pos + 4]
        chunk_size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        pos += 8
        if chunk_id == b"LIST" and data[pos : pos + 4] == b"INFO":
            sub = data[pos + 4 : pos + chunk_size]
            sub_pos = 0
            while sub_pos + 8 <= len(sub):
                sid = sub[sub_pos : sub_pos + 4]
                ssize = struct.unpack("<I", sub[sub_pos + 4 : sub_pos + 8])[0]
                sub_pos += 8
                val = sub[sub_pos : sub_pos + ssize]
                if sid == b"ICMT":
                    return val.decode("utf-8")
                sub_pos += ssize + (ssize % 2)
            break
        pos += chunk_size + (chunk_size % 2)
    return None


def test_render_hash_in_outputs(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    bundle_dir = tmp_path / "bundle"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--bundle",
        str(bundle_dir),
        "--arrange",
        "off",
    ]
    proc = subprocess.run(
        cmd, cwd=repo_root, check=True, capture_output=True, text=True
    )

    log_line = proc.stdout.strip().splitlines()[-1]
    info = json.loads(log_line)
    rhash = info["render_hash"]

    readme = (bundle_dir / "README.txt").read_text()
    assert rhash in readme
    assert _read_icmt(bundle_dir / "mix.wav") == rhash

    cfg = json.loads((bundle_dir / "config.json").read_text())
    spec_dict = SongSpec.from_json(spec_path).to_dict()
    git_commit = (
        subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root)
        .decode()
        .strip()
    )
    rhash2 = utils.render_hash(spec_dict, 42, cfg.get("style", {}), cfg, git_commit)
    assert rhash == rhash2
