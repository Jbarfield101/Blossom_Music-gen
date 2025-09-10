# Dataset preparation

`data/build_dataset.py` converts note stems or MIDI files into token
sequences consumable by the model.  It writes two JSONL files containing
lists of token/value pairs.

## Usage

```bash
python data/build_dataset.py --stems-dir out/stems \
    --midi-dir curated_midis \
    --val-ratio 0.1 \
    --seed 42 \
    --out-dir data
```

### Parameters

* `--stems-dir`: Directory containing `.json` stem descriptions.  Defaults to
  `out`.
* `--midi-dir`: Optional directory of `.mid` files that will be converted and
  appended to the dataset.
* `--val-ratio`: Fraction of examples reserved for validation.  The default is
  `0.1` (10%).
* `--seed`: Random seed used for the deterministic train/validation split.
* `--out-dir`: Destination directory for `train.jsonl` and `val.jsonl`.

Each record in the output files contains a `tokens` field with the token
sequence and a `source` field pointing to the originating file.
