"""Command-line entry point for queueable MusicGen jobs."""
import sys

if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import argparse
import json
import os
import time
from pathlib import Path
from typing import List

from core.musicgen_backend import generate_music, get_last_status


def _sanitize_base_name(raw: str, fallback: str) -> str:
    allowed = []
    for ch in raw:
        if ch.isalnum() or ch in " -_.":
            allowed.append(ch)
        else:
            allowed.append("_")
    cleaned = "".join(allowed).strip().strip(".")
    if len(cleaned) > 120:
        cleaned = cleaned[:120]
    cleaned = cleaned.strip().strip(".")
    if not cleaned:
        cleaned = fallback
    lower = cleaned.lower()
    if lower.endswith(".wav"):
        cleaned = cleaned[:-4].strip().strip(".")
    return cleaned or fallback


def _ensure_unique_path(base_dir: Path, filename: str) -> Path:
    target = base_dir / filename
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix or ".wav"
    for idx in range(1, 10000):
        candidate = base_dir / f"{stem} ({idx}){suffix}"
        if not candidate.exists():
            return candidate
    return target


def _write_summary(path: Path, payload: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception as exc:  # pragma: no cover - best effort
        print(f"Failed to write summary JSON: {exc}", file=sys.stderr)


def run() -> dict:
    parser = argparse.ArgumentParser(description="Generate audio using MusicGen")
    parser.add_argument("--prompt", required=True, help="Text prompt for generation")
    parser.add_argument("--duration", type=float, default=30.0, help="Duration of each clip in seconds")
    parser.add_argument("--model", default="facebook/musicgen-small", help="MusicGen model identifier")
    parser.add_argument("--temperature", type=float, default=1.0, help="Sampling temperature")
    parser.add_argument("--output-dir", required=True, help="Directory to write generated audio")
    parser.add_argument("--count", type=int, default=1, help="Number of clips to generate (1-10)")
    parser.add_argument("--base-name", dest="base_name", default="", help=argparse.SUPPRESS)
    parser.add_argument("--output-name", default="", help="Preferred base filename (optional)")
    parser.add_argument("--melody-path", default=None, help="Optional melody conditioning clip")
    parser.add_argument("--force-cpu", action="store_true", help="Force CPU execution")
    parser.add_argument("--force-gpu", action="store_true", help="Force attempting GPU execution")
    parser.add_argument("--use-fp16", action="store_true", help="Request fp16 when running on GPU")
    parser.add_argument("--summary-path", default=None, help="Path to write a JSON summary")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = Path(args.summary_path).expanduser() if args.summary_path else None

    if args.force_cpu:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    if args.force_gpu:
        os.environ["MUSICGEN_FORCE_GPU"] = "1"
    if args.use_fp16:
        os.environ["MUSICGEN_FP16"] = "1"

    fallback = f"musicgen_{int(time.time())}"
    base_name = (args.base_name or "").strip()
    if not base_name:
        base_name = _sanitize_base_name(args.output_name or "", fallback)
    if not base_name:
        base_name = fallback

    count = max(1, min(int(args.count or 1), 10))
    width = len(str(count)) if count > 1 else 0

    filenames: List[str] = []
    for idx in range(count):
        if count > 1:
            name = f"{base_name}_{idx + 1:0{width}d}"
        else:
            name = base_name
        if not name.lower().endswith(".wav"):
            name = f"{name}.wav"
        filenames.append(name)

    melody_path = args.melody_path.strip() if isinstance(args.melody_path, str) else None
    generated_paths: List[str] = []
    for name in filenames:
        raw_path = Path(
            generate_music(
                prompt=args.prompt,
                duration=float(args.duration),
                model_name=args.model,
                temperature=float(args.temperature),
                output_dir=str(output_dir),
                melody_path=melody_path,
            )
        )
        target = _ensure_unique_path(output_dir, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            if raw_path.resolve() != target.resolve():
                raw_path.replace(target)
        except FileNotFoundError:
            raw_path.replace(target)
        generated_paths.append(str(target.resolve()))

    status = {}
    try:
        status = get_last_status()
    except Exception:  # pragma: no cover - defensive
        status = {}

    summary = {
        "prompt": args.prompt,
        "duration": float(args.duration),
        "temperature": float(args.temperature),
        "model": args.model,
        "count": count,
        "base_name": base_name,
        "output_dir": str(output_dir.resolve()),
        "paths": generated_paths,
        "device": status.get("device"),
        "fallback": bool(status.get("fallback")),
        "fallback_reason": status.get("reason"),
        "melody_path": melody_path,
        "force_cpu": bool(args.force_cpu),
        "force_gpu": bool(args.force_gpu),
        "use_fp16": bool(args.use_fp16),
        "status_message": "Completed",
        "stage": "completed",
        "success": True,
    }

    if summary_path is not None:
        _write_summary(summary_path, summary)

    return summary


def main() -> None:
    try:
        summary = run()
    except Exception as exc:  # pragma: no cover - runtime dependent
        print(exc, file=sys.stderr)
        sys.exit(1)
    else:
        print("SUMMARY:" + json.dumps(summary))


if __name__ == "__main__":
    main()
