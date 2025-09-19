#!/usr/bin/env python3
"""Export a looped video clip to a target duration using ffmpeg."""

import argparse
import math
import subprocess
import sys
import tempfile
from pathlib import Path

EPSILON = 0.0005


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", dest="input_path", required=True, help="Source video path")
    parser.add_argument(
        "--output", dest="output_path", required=True, help="Destination video path"
    )
    parser.add_argument(
        "--target-seconds",
        type=float,
        required=True,
        help="Desired output duration in seconds",
    )
    parser.add_argument(
        "--clip-seconds",
        type=float,
        required=True,
        help="Duration of the input clip in seconds",
    )
    parser.add_argument(
        "--ffmpeg",
        default="ffmpeg",
        help="ffmpeg executable to invoke (defaults to 'ffmpeg')",
    )
    return parser.parse_args()


def resolve_path(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except (FileNotFoundError, OSError):
        # Fallback for paths that do not exist yet
        return path.expanduser().absolute()


def run() -> None:
    args = parse_args()

    input_path = resolve_path(Path(args.input_path))
    output_path = resolve_path(Path(args.output_path))
    ffmpeg = args.ffmpeg

    if not input_path.exists():
        raise SystemExit(f"Input video does not exist: {input_path}")

    target_seconds = max(0.0, float(args.target_seconds))
    clip_seconds = float(args.clip_seconds)
    if clip_seconds <= 0:
        raise SystemExit("clip-seconds must be greater than zero")

    output_dir = output_path.parent
    if output_dir and not output_dir.exists():
        output_dir.mkdir(parents=True, exist_ok=True)

    loops = int(math.floor(target_seconds / clip_seconds)) if target_seconds > 0 else 0
    remainder = target_seconds - loops * clip_seconds

    base_cmd = [ffmpeg, "-y"]

    if loops >= 1 and abs(remainder) <= EPSILON:
        print(f"Concatenating {loops} loop(s) with stream copy…", flush=True)
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", suffix=".txt", delete=False, encoding="utf-8"
            ) as handle:
                tmp_path = Path(handle.name)
                escaped = str(input_path).replace("'", "'\\''")
                for _ in range(loops):
                    handle.write(f"file '{escaped}'\n")
            cmd = base_cmd + [
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(tmp_path),
                "-c",
                "copy",
                str(output_path),
            ]
            subprocess.run(cmd, check=True)
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
    else:
        loops_nonneg = max(0, loops)
        cmd = list(base_cmd)
        if loops_nonneg > 0:
            cmd += ["-stream_loop", str(loops_nonneg)]
        cmd += [
            "-i",
            str(input_path),
            "-t",
            f"{max(0.0, target_seconds):.3f}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(output_path),
        ]
        print(
            f"Re-encoding loop with stream_loop={loops_nonneg} to {target_seconds:.3f}s…",
            flush=True,
        )
        subprocess.run(cmd, check=True)

    print(f"Loop export completed: {output_path}", flush=True)


def main() -> None:
    try:
        run()
    except subprocess.CalledProcessError as exc:
        code = exc.returncode if exc.returncode is not None else 1
        sys.stderr.write(f"ffmpeg exited with code {code}\n")
        raise SystemExit(code)
    except SystemExit:
        raise
    except Exception as exc:  # pylint: disable=broad-except
        sys.stderr.write(f"Loop export failed: {exc}\n")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
