# Blossom_Music-gen

Simple demos for algorithmic music pattern generation.

A desktop interface built with [Tauri](https://tauri.app/) and a small
FastAPI server now share a unified front‑end.  Templates and scripts live under
the top‑level `ui/` directory and are served by FastAPI while the Tauri build
points to the same files.  The `ui/app.js` script detects whether it is running
inside the desktop shell or a browser and adjusts its behaviour accordingly.
Command‑line usage via `start.py` remains available for automation.

## Quick Start

1. Create a virtual environment and install the Python dependencies:

   ```bash
   python3.10 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Launch the web server:

   ```bash
   uvicorn webui.app:app --reload
   ```

3. Open `http://localhost:8000/` in your browser to access the UI.

### Troubleshooting

- If `uvicorn` or other modules are missing, rerun `pip install -r requirements.txt` inside the virtual environment.
- If port `8000` is already in use, specify another one with `--port`, e.g. `uvicorn webui.app:app --port 8001`, or stop the conflicting process.

## Prerequisites

- **64-bit Python 3.10**
- [Node.js](https://nodejs.org/en/download/)
- [Rust](https://www.rust-lang.org/tools/install)

The `start.py` helper creates a persistent virtual environment in `.venv`
(reusing it on subsequent runs), installs the packages from `requirements.txt`
if needed, and aborts if installation fails.

## Dependencies

Mixing EQ filters now rely on `scipy`'s `lfilter` for a vectorized
implementation that removes Python loops and speeds up filtering. Install it
alongside the other requirements:

```bash
pip install scipy
```

SFZ instruments may reference WAV or FLAC samples. Loading FLAC samples requires the
[soundfile](https://pysoundfile.readthedocs.io/) library, which can be installed with:

```bash
pip install soundfile
```

For enhanced MIDI import and export support, install the optional
[mido](https://mido.readthedocs.io/) library:

```bash
pip install mido
```

## Generate N minutes of music

1. Create a song specification JSON (see `core/song_spec.py` for fields).
2. Run the synth and specify the number of minutes you want:

```bash
pip install soundfile  # enables FLAC support
python -m core.main_synth --spec path/to/spec.json --minutes 3 --seed 42 --sampler-seed 0 --print-stats > plan.json
```

`main_synth.py` will extend the section list to meet the requested duration and print a JSON plan of events for each instrument.  The example above generates at least three minutes of material and writes it to `plan.json` while printing instrument event counts to the console.

### Reproducibility

Two parameters influence randomness:

* `--seed` controls deterministic pattern and stem generation.
* `--sampler-seed` seeds Python, NumPy and PyTorch RNGs used for phrase model sampling.

Providing both makes runs fully repeatable (the sampler seed defaults to `0`).

## Neural phrase models

Small recurrent networks can replace the deterministic pattern generators.  The
optional models live in the `models/` directory and are loaded automatically by
`main_synth.py` and `main_render.py`.  The `--use-phrase-model` flag controls
their usage: the default `auto` mode tries to load models and falls back to the
algorithmic generators if unavailable.  Passing `--use-phrase-model no`
disables model loading entirely, while `--use-phrase-model yes` requires that
models are present.

### Training prerequisites and dataset

Training requires [PyTorch](https://pytorch.org/) and, for ONNX export,
`onnxruntime`.  Datasets consist of token sequences stored in `train.jsonl` and
`val.jsonl` which can be created with `data/build_dataset.py` (see
[`docs/datasets.md`](docs/datasets.md)).  Running

```bash
python training/phrase_models/train_phrase_models.py
```

trains toy GRU models and writes checkpoints.

### Export and placement

The training script uses `torch.jit.script` and `torch.onnx.export` to emit
`<inst>_phrase.ts.pt` and `<inst>_phrase.onnx` files into `models/`.  Place the
files there so they can be picked up at runtime.

### Sampler seeding

The `--sampler-seed` CLI option seeds Python, NumPy and PyTorch RNGs used during
phrase sampling.  Providing this flag makes neural generation reproducible.

### Missing models

If a model file is absent or fails to load, the code falls back to the
deterministic pattern generators.  See
[`docs/phrase_models.md`](docs/phrase_models.md) for details.

## Style profiles

Built-in arrangement styles adjust swing and mixing defaults. See
[`docs/style_profiles.md`](docs/style_profiles.md) for the current token IDs
and guidance on adding new styles.

## Cadence fill evaluation

The repository includes a small helper to inspect note densities around
cadence markers.  `scripts/eval_cadence_fills.py` accepts JSON or JSONL
files containing token sequences or rendered stems and reports average
note density per bar.  When `CADENCE_SOON` or `FINAL` tokens are present
it compares their bars against ordinary ones and prints whether density
increases:

```bash
python scripts/eval_cadence_fills.py path/to/tokens.jsonl
```

## A/B phrase evaluation

To compare deterministic pattern synthesis against the optional neural phrase
models, use `scripts/ab_eval.py`.  The tool renders both variants for a given
song specification and seed, storing audio, note data and evaluation metrics in
the specified output directory:

```bash
python scripts/ab_eval.py --spec path/to/spec.json --seed 42 --out ab_bundle
```

The resulting bundle contains WAV files, stem JSON and `ab_eval.json` /
`metrics.csv` summaries.  These metrics cover note diversity, inter-onset
interval histograms, cadence fill rates and section-wise loudness. See
[`docs/ab_harness.md`](docs/ab_harness.md) for details on the metrics and
output bundle structure.

For explanations of individual metrics such as chord tone coverage and voice leading smoothness, see [`docs/evaluation.md`](docs/evaluation.md).


## Using External Samples

If drum hits are placed under `assets/samples/drums` and simple SFZ instruments
for bass, keys and pads live in `assets/sf2/`, the renderer will pick these up
automatically. Missing assets trigger tiny built‑in synthesiser fallbacks.

To render instruments with different SFZ files, pass paths using the
`--keys-sfz`, `--pads-sfz`, or `--bass-sfz` flags. The default configuration
points to files defined in `render_config.json`.

The `render_config.json` file also defines default sample locations for all
instruments along with stereo mix parameters.  Each track exposes gain, pan
and reverb send values.  A shared reverb bus processes the keys and pads and
the master mix passes through an automatic gain trim and a true‑peak limiter
with a ``-0.8`` dBFS ceiling by default.  All paths are relative so the
repository works out of the box after cloning.

```bash
pip install soundfile  # enables FLAC support
python main_render.py --spec path/to/spec.json --keys-sfz /path/to/custom/keys.sfz --mix out/piano.wav
```

This command renders the keys using the specified SFZ instrument and writes the mix to `out/piano.wav`.

Alternatively, choose a built‑in song template instead of providing a spec:

```bash
python main_render.py --preset pop_verse_chorus --mix out/piano.wav
```

Mix settings can also be loaded from a preset file in `assets/presets` using
`--mix-preset`:

```bash
python main_render.py --spec path/to/spec.json --mix-preset default
```

To compute metrics from a previously rendered bundle without synthesising
audio again, run:

```bash
python main_render.py --bundle path/to/bundle --eval-only
```

This reads `song.json`, `stems.mid` and `mix.wav` from the bundle and writes
`metrics.json`.

Available song templates: `pop_verse_chorus`, `lofi_loop`.

## Tauri desktop UI

The Tauri application mirrors the command‑line options and writes the same
output files.

### Launching

Install the Node and Rust dependencies and start the UI in development mode:

```bash
npm install
npm run tauri dev
```

### Build

To produce a standalone desktop build:

```bash
npm run tauri build
```

The release bundle will appear under `src-tauri/target/release`.

Fill out the fields for the song spec, optional SFZ paths, seed, and output
locations then click **Render** to run the Python pipeline.

## Web UI

The FastAPI server in `webui/app.py` serves the same `ui/` assets used by the
desktop application.  Start the server with:

```bash
uvicorn webui.app:app
```

Navigate to `http://localhost:8000/` and the unified front‑end will load.
Jobs invoke `main_render.py` under the hood and return a zip bundle containing
the mix and stems for download.  A health‑check endpoint is available at
`/health`.

## Discord transcription pipeline

The `ears.pipeline` module can capture audio from a Discord voice channel and
transcribe speech using Whisper. Transcripts are written to JSONL files under
`transcripts/`.

```python
import asyncio
from ears.pipeline import run_bot

asyncio.run(run_bot("TOKEN", 123456789012345678))
```

Replace `TOKEN` with your bot token and the integer with the target voice
channel ID.
