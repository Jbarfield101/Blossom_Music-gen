import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

MIN_CORES = 2
MIN_MEM_GB = 2.0
DEFAULT_TIME_BUDGET = 10.0

def _low_resources() -> bool:
    cores = os.cpu_count() or 1
    if cores < MIN_CORES:
        return True
    try:
        import psutil  # type: ignore
    except Exception:  # pragma: no cover - psutil optional
        return False
    mem_gb = psutil.virtual_memory().total / (1024 ** 3)
    return mem_gb < MIN_MEM_GB

if _low_resources():
    pytest.skip("insufficient system resources for performance benchmark", allow_module_level=True)

pyenv_root = Path(sys.executable).resolve().parents[2]
py310 = pyenv_root / "3.10.17/bin/python"
if not py310.exists():
    pytest.skip("python3.10 not available", allow_module_level=True)

try:  # pragma: no cover - ensure dependencies are present
    subprocess.run([str(py310), "-c", "import numpy"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except Exception:
    pytest.skip("python3.10 environment missing dependencies", allow_module_level=True)

repo_root = Path(__file__).resolve().parents[1]


def _write_spec(path: Path) -> None:
    spec = {
        "title": "PerfTest",
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


def _time_budget() -> float:
    return float(os.environ.get("BLOSSOM_PERF_BUDGET", DEFAULT_TIME_BUDGET))


def test_render_small_spec_within_budget(tmp_path: Path) -> None:
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)
    mix_path = tmp_path / "mix.wav"
    stems_dir = tmp_path / "stems"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--mix",
        str(mix_path),
        "--stems",
        str(stems_dir),
    ]
    start = time.perf_counter()
    subprocess.run(cmd, cwd=repo_root, check=True)
    elapsed = time.perf_counter() - start
    assert elapsed <= _time_budget(), f"rendering took {elapsed:.2f}s, budget {_time_budget():.2f}s"
