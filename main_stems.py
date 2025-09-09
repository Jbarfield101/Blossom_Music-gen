import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import argparse

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, export_midi


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--write-midi")
    ap.add_argument("--print-stats", action="store_true")
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()

    stems = build_stems_for_song(spec, seed=args.seed)

    if args.write_midi:
        export_midi(stems, args.write_midi)

    if args.print_stats:
        counts = {inst: len(notes) for inst, notes in stems.items()}
        print("Note counts:")
        for inst in sorted(counts):
            print(f"  {inst}: {counts[inst]}")
        total_dur = 0.0
        for notes in stems.values():
            for n in notes:
                total_dur = max(total_dur, n.start + n.dur)
        print(f"Total duration: {total_dur:.2f} sec")

        policy = getattr(spec, "register_policy", {}) or {}
        for inst, notes in stems.items():
            rng = policy.get(inst)
            if rng:
                low, high = rng
                clamped = sum(1 for n in notes if n.pitch <= low or n.pitch >= high)
                if clamped:
                    print(f"Warning: {inst} has {clamped} clamped notes")
