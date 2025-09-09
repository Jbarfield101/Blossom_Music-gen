"""Project launcher that manages a Python 3.10 virtual environment and deps."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"


def _venv_paths() -> tuple[Path, Path]:
    """Return (python, pip) executables inside the virtual environment."""
    if os.name == "nt":
        bin_dir = VENV_DIR / "Scripts"
        return bin_dir / "python.exe", bin_dir / "pip.exe"
    bin_dir = VENV_DIR / "bin"
    return bin_dir / "python", bin_dir / "pip"


def _ensure_venv() -> Path:
    """Create venv and install dependencies if necessary."""
    py_path, pip_path = _venv_paths()
    if not VENV_DIR.exists():
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
    subprocess.check_call([str(pip_path), "install", "-r", str(ROOT / "requirements.txt")])
    return py_path


def main() -> None:
    if sys.version_info[:2] != (3, 10):
        sys.exit("Blossom requires Python 3.10")
    py_path = _ensure_venv()
    subprocess.check_call([str(py_path), str(ROOT / "menu.py")])


if __name__ == "__main__":
    main()
