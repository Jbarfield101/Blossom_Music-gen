# A/B evaluation harness

`scripts/ab_eval.py` renders a song twice: once with deterministic pattern
synthesis (labelled **algorithmic**) and once using the optional neural phrase
models (**learned**). It collects audio, note data, and several metrics for
side-by-side comparison.

## Usage

```bash
python scripts/ab_eval.py --spec path/to/spec.json --seed 42 --out ab_bundle
```

## Metrics

- **note_diversity** - histogram of note pitches per instrument
- **ioi_histogram** - distribution of inter-onset intervals in seconds
- **cadence_density** - average note density before cadence bars versus other bars
- **section_loudness** - RMS dB and LUFS values for each song section

## Output bundle

The output directory contains:

```
ab_bundle/
  algorithmic.wav
  algorithmic_stems.json
  learned.wav
  learned_stems.json
  ab_eval.json
  metrics.csv
```

`ab_eval.json` stores structured data while `metrics.csv` provides a flattened
table for quick inspection.
