import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import argparse

from core.musicgen_backend import generate_music


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate music from a text prompt using MusicGen")
    ap.add_argument("--prompt", required=True, help="Text prompt for generation")
    ap.add_argument("--duration", type=float, default=10, help="Duration of the clip in seconds")
    ap.add_argument("--model", default="facebook/musicgen-small", help="MusicGen model identifier")
    ap.add_argument("--temperature", type=float, default=1.0, help="Sampling temperature")
    ap.add_argument("--output-dir", default="out", help="Directory to write output audio")
    args = ap.parse_args()

    out_path = generate_music(
        prompt=args.prompt,
        duration=args.duration,
        model_name=args.model,
        temperature=args.temperature,
        output_dir=args.output_dir,
    )
    print(out_path)
