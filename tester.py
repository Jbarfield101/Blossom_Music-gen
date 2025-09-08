# tester.py
import pathlib
import subprocess
import sys


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
