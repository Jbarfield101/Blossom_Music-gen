#!/usr/bin/env python3
"""Export a looped video to a fixed duration using FFmpeg."""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

EPSILON = 0.0005


def build_concat_file(input_path: Path, loops: int) -> Path:
    safe_path = str(input_path).replace("'", "'\\''")
    tmp = tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8")
    try:
        for _ in range(loops):
            tmp.write(f"file '{safe_path}'\n")
    finally:
        tmp.close()
    return Path(tmp.name)


def run_ffmpeg(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:  # pragma: no cover - simple environment guard
        raise RuntimeError(
            "ffmpeg not found. Please install FFmpeg and ensure it is on your PATH."
        ) from exc


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export a looped video using FFmpeg")
    parser.add_argument("--input", required=True, help="Path to the source video")
    parser.add_argument("--target-seconds", type=float, required=True)
    parser.add_argument("--clip-seconds", type=float, required=True)
    parser.add_argument("--output", required=True, help="Destination video path")
    parser.add_argument("--label", default="", help="Human-friendly label for logging")
    parser.add_argument(
        "--remainder",
        type=float,
        default=0.0,
        help="Expected remainder seconds (for logging only)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser()

    if not input_path.exists():
        print(f"Input video does not exist: {input_path}", file=sys.stderr)
        return 1
    if args.target_seconds <= 0:
        print("Target duration must be greater than zero.", file=sys.stderr)
        return 1
    if args.clip_seconds <= 0:
        print("Clip duration must be greater than zero.", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)

    full_loops = max(int(math.floor(args.target_seconds / args.clip_seconds)), 0)
    remainder = max(args.target_seconds - full_loops * args.clip_seconds, 0.0)
    has_remainder = remainder > EPSILON

    print(
        f"Starting loop export for '{args.label or input_path.name}' → {output_path}"
    )

    # Always re-encode for robust MP4 output. Copy-concat can yield broken timestamps
    # in MP4 containers, resulting in players reporting or playing only the first segment.
    # Using -stream_loop with -t and encoding ensures a single continuous timeline.
    loops_nonneg = max(full_loops, 0)
    cmd = ["ffmpeg", "-y"]
    if loops_nonneg > 0:
        cmd.extend(["-stream_loop", str(loops_nonneg)])
    cmd.extend(["-i", str(input_path)])
    cmd.extend(["-t", f"{max(args.target_seconds, 0.0):.3f}"])
    cmd.extend(
        [
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
    )
    try:
        result = run_ffmpeg(cmd)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        message = stderr or stdout or "ffmpeg failed"
        print(message, file=sys.stderr)
        return result.returncode

    summary = {
        "input": str(input_path),
        "output": str(output_path.resolve()),
        "target_seconds": args.target_seconds,
        "clip_seconds": args.clip_seconds,
        "loops": full_loops,
        "remainder": remainder,
        "had_remainder": has_remainder,
        "label": args.label or "",
    }

    if args.remainder:
        summary["requested_remainder"] = args.remainder

    print(f"SUMMARY: {json.dumps(summary)}")
    print(f"Loop export completed: {summary['output']}")
    return 0
 
if __name__ == "__main__":  # pragma: no cover - script entry point
    sys.exit(main())
