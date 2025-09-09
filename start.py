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
import struct
from pathlib import Path
from typing import Optional


def _venv_paths(env_dir: str) -> tuple[Path, Path]:
    """Return (python, pip) executables inside the virtual environment."""
    env_path = Path(env_dir)
    if os.name == "nt":
        bin_dir = env_path / "Scripts"
        return bin_dir / "python.exe", bin_dir / "pip.exe"
    bin_dir = env_path / "bin"
    return bin_dir / "python", bin_dir / "pip"


def _find_python310() -> Optional[str]:
    """Search the ``PATH`` for a Python 3.10 interpreter."""
    for name in ("python3.10", "python310"):
        path = shutil.which(name)
        if path:
            return path

    if os.name == "nt":
        try:
            out = subprocess.run(
                ["py", "-3.10", "-c", "import sys; print(sys.executable)"] ,
                capture_output=True,
                text=True,
                check=True,
            )
            path = out.stdout.strip()
            if path:
                return path
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass

    return None


def main() -> None:
    python310_path = sys.executable
    if sys.version_info[:2] != (3, 10):
        python310_path = _find_python310()
        if python310_path is None:
            sys.exit("Python 3.10 required")
        subprocess.run([python310_path, __file__, *sys.argv[1:]], check=True)
        return

    if struct.calcsize("P") * 8 != 64:
        sys.exit("64-bit Python 3.10 required")

    env_dir = tempfile.mkdtemp(prefix="start-env-")
    atexit.register(shutil.rmtree, env_dir, True)

    subprocess.run([python310_path, "-m", "venv", env_dir], check=True)
    python_path, pip_path = _venv_paths(env_dir)

    try:
        subprocess.check_call([str(pip_path), "install", "-r", "requirements.txt"])
    except subprocess.CalledProcessError:
        print("Failed to install dependencies", file=sys.stderr)
        sys.exit(1)

    subprocess.run([str(python_path), "-m", "menu"], check=True)


if __name__ == "__main__":
    main()
