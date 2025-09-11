# Benchmarking render performance

This project includes a lightweight benchmark for the audio rendering
pipeline.  It measures the combined time of `render_song` and `mix` on a
small representative [`SongSpec`](../core/song_spec.py).

## Running the benchmark

```bash
python scripts/benchmark_render.py
```

If a baseline exists in `benchmarks/render_baseline.json` the script compares
current timings against it and exits with a non–zero status when the run is
slower than the baseline by more than 10 percent.  You may change the allowed
slowdown via `--threshold`.

## Updating the baseline

To refresh the Phase 4 baseline after performance improvements:

```bash
python scripts/benchmark_render.py --update-baseline
```

The updated timing is written to `benchmarks/render_baseline.json`.  The current
Phase 4 baseline clocks in at approximately **10.43 seconds** on the reference
hardware.
