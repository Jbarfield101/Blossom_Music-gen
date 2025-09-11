import argparse
import json

from core.song_spec import SongSpec, extend_sections_to_minutes
from core.pattern_synth import build_patterns_for_song


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "--sampler-seed",
        type=int,
        default=None,
        help="Seed for phrase model sampling (defaults to --seed)",
    )
    ap.add_argument("--minutes", type=float)
    ap.add_argument("--print-stats", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()

    if args.minutes:
        extend_sections_to_minutes(spec, args.minutes)

    plan = build_patterns_for_song(
        spec, seed=args.seed, sampler_seed=args.sampler_seed, verbose=args.verbose
    )

    if args.print_stats:
        counts = {}
        for sec in plan["sections"]:
            for inst, events in sec["patterns"].items():
                counts[inst] = counts.get(inst, 0) + len(events)
        print("Event counts:")
        for inst in sorted(counts):
            print(f"  {inst}: {counts[inst]}")

    print(json.dumps(plan, indent=2))
