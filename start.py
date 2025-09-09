"""Bootstraps the demo in a temporary virtual environment.

The launcher creates an isolated environment, installs ``requirements.txt``
dependencies, and refuses to continue if installation fails.  Once setup
completes it opens the small Tkinter menu used to access the renderer UI.
"""

import atexit
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _venv_paths(env_dir: str) -> tuple[Path, Path]:
    """Return (python, pip) executables inside the virtual environment."""
    env_path = Path(env_dir)
    if os.name == "nt":
        bin_dir = env_path / "Scripts"
        return bin_dir / "python.exe", bin_dir / "pip.exe"
    bin_dir = env_path / "bin"
    return bin_dir / "python", bin_dir / "pip"


def main() -> None:
    if sys.version_info[:2] != (3, 10):
        sys.exit("Python 3.10 required")

    env_dir = tempfile.mkdtemp(prefix="start-env-")
    atexit.register(shutil.rmtree, env_dir, True)

    subprocess.run([sys.executable, "-m", "venv", env_dir], check=True)
    python_path, pip_path = _venv_paths(env_dir)

    try:
        subprocess.check_call([str(pip_path), "install", "-r", "requirements.txt"])
    except subprocess.CalledProcessError:
        print("Failed to install dependencies", file=sys.stderr)
        sys.exit(1)

    subprocess.run([str(python_path), "-m", "menu"], check=True)


if __name__ == "__main__":
    main()
