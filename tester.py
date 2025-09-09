# tester.py
import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import pathlib
import subprocess


def main() -> None:
    repo_root = pathlib.Path(__file__).resolve().parent
    print(f"Running tests from {repo_root}")

    # Execute the test suite with pytest
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-vv"],
        cwd=repo_root,
    )
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
