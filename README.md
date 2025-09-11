# Blossom_Music-gen

Simple demos for algorithmic music pattern generation.

**64-bit Python 3.10 required.** The `start.py` helper creates a persistent
virtual environment in `.venv` (reusing it on subsequent runs), installs the
packages from `requirements.txt` if needed, and aborts if installation fails.
After setup it opens a minimal main menu where clicking the music icon launches
the renderer UI.

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

The resulting bundle contains WAV files, stem JSON and `metrics.json` /
`metrics.csv` summaries.  These metrics cover note diversity, inter-onset
interval histograms, cadence fill rates and section-wise loudness. See
[`docs/ab_harness.md`](docs/ab_harness.md) for details on the metrics and
output bundle structure.


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

Available song templates: `pop_verse_chorus`, `lofi_loop`.

## Basic UI

For quick experiments the project includes a small Tkinter based user interface
(`ui.py`). The UI mirrors the command line options and writes the same output
files.

### Prerequisites

- 64-bit Python 3.10 with the `tkinter` module available. On many Linux systems this
  can be installed via `sudo apt install python3-tk`.
- Optional: [`soundfile`](https://pysoundfile.readthedocs.io/) for FLAC
  support when rendering.

### Launching

Launch the interface through the bootstrapper:

```bash
python start.py
```

On first run the script sets up a `.venv` virtual environment, installs
dependencies, and then presents a window with a music icon. Clicking the icon
opens the rendering interface. Later invocations reuse the existing
environment.

If you already have the requirements installed, the UI can still be invoked
directly:

```bash
python ui.py
```

### Fields

The window exposes a handful of text fields:

| Field | Purpose |
| ----- | ------- |
| **Spec JSON** | Path to the song specification used for generation. |
| **Seed** | Random seed for reproducible results. |
| **Minutes** | Optional length of music to generate; sections repeat as needed. |
| **Mix Path** | Destination of the rendered master mix WAV file. |
| **Stems Dir** | Directory where individual instrument stems are written. |
| **Keys/Pads/Bass SFZ** | Optional overrides for instrument sample mappings. |

### Example workflow

1. Prepare a song specification such as `song.json`.
2. Start the launcher with `python start.py` (the first run creates `.venv` and
   installs dependencies) and click the icon to open the renderer UI.
3. Browse to the spec JSON and adjust any desired parameters.
4. Click **Render** to create the mix and stems in the specified locations.

## Web UI

A minimal FastAPI web interface lives in `webui/app.py`.  It exposes a simple
form to choose a preset, optional style, seed and target duration.  Submitted
jobs invoke `main_render.py` under the hood and return a zip bundle containing
the mix and stems for download.

Launch the server with:

```bash
uvicorn webui.app:app
```

Visit `http://localhost:8000/` in your browser to render audio directly from
the browser.  A health‑check endpoint is available at `/health`.

## Tauri UI

An experimental desktop interface is provided via [Tauri](https://tauri.app/). It lives in the `src-tauri` folder and renders a small window with a centered music note icon and heading.

### Building

1. Install the development dependencies:

```bash
npm install
```

2. Start the UI in development mode:

```bash
npm run tauri dev
```

Click **Render** to invoke the bundled command that runs `start.py` and triggers rendering through Python.
