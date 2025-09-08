import argparse
import json
import math

from core.song_spec import SongSpec, Section
from core.pattern_synth import build_patterns_for_song


def _extend_sections_to_minutes(spec: SongSpec, minutes: float) -> None:
    """Extend ``spec.sections`` so total bars cover ``minutes`` of music."""
    num, den = map(int, spec.meter.split("/", 1))
    bars_needed = math.ceil(minutes * spec.tempo * den / (num * 4))
    current = spec.total_bars()
    if bars_needed <= current:
        return
    sections = list(spec.sections)
    cursor = current
    idx = 0
    templates = list(spec.sections)
    while cursor < bars_needed:
        tmpl = templates[idx % len(templates)]
        sections.append(Section(name=tmpl.name, length=tmpl.length))
        cursor += tmpl.length
        idx += 1
    spec.sections = sections


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--minutes", type=float)
    ap.add_argument("--print-stats", action="store_true")
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()

    if args.minutes:
        _extend_sections_to_minutes(spec, args.minutes)

    plan = build_patterns_for_song(spec, seed=args.seed)

    if args.print_stats:
        counts = {}
        for sec in plan["sections"]:
            for inst, events in sec["patterns"].items():
                counts[inst] = counts.get(inst, 0) + len(events)
        print("Event counts:")
        for inst in sorted(counts):
            print(f"  {inst}: {counts[inst]}")

    print(json.dumps(plan, indent=2))
