"""Bootstraps the demo in a persistent virtual environment.

The launcher reuses a ``.venv`` directory, creating it and installing
``requirements.txt`` dependencies on the first run. After setup completes it
executes the renderer with the provided command line arguments.
"""

import os
import shutil
import subprocess
import sys
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

    env_dir = Path(".venv")
    if not env_dir.exists():
        subprocess.run([python310_path, "-m", "venv", str(env_dir)], check=True)
        python_path, pip_path = _venv_paths(str(env_dir))
        try:
            subprocess.check_call(
                [str(pip_path), "install", "-r", "requirements.txt"]
            )
        except subprocess.CalledProcessError:
            print("Failed to install dependencies", file=sys.stderr)
            sys.exit(1)
    else:
        python_path, _ = _venv_paths(str(env_dir))

    os.environ["PATH"] = f"{python_path.parent}{os.pathsep}{os.environ['PATH']}"

    npm_env = os.environ.get("NPM_PATH")
    default_npm = shutil.which("npm")
    npm_path = shutil.which(npm_env) if npm_env else default_npm
    if npm_path is None:
        print(
            "Could not find 'npm'. Install Node.js and ensure 'npm' is on your PATH "
            "or set the NPM_PATH environment variable to the npm executable.",
            file=sys.stderr,
        )
        sys.exit(1)

    npm_dir = Path.cwd()
    try:
        # Install root-level dependencies first
        subprocess.run([npm_path, "install"], cwd=npm_dir, check=True)
        # Then install UI dependencies (Vite, React, etc.)
        subprocess.run([npm_path, "install"], cwd=npm_dir / "ui", check=True)
    except subprocess.CalledProcessError:
        print("Failed to install NPM dependencies", file=sys.stderr)
        sys.exit(1)

    try:
        subprocess.run([npm_path, "run", "tauri", "dev"], cwd=npm_dir, check=True)
    except subprocess.CalledProcessError:
        print("Failed to launch Tauri UI", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
