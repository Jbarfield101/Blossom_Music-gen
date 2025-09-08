# main_patterns.py
import argparse, json
from core.song_spec import SongSpec
from core.patterns import load_pattern_index, build_section_plan

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--index", default="patterns/_meta/index.json")
    ap.add_argument("--print-plan", action="store_true")
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()
    registry = load_pattern_index(args.index)
    plan = build_section_plan(spec, registry, seed=args.seed)

    if args.print_plan:
        print(json.dumps(plan, indent=2))
