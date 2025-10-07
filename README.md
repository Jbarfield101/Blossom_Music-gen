# Blossom_Music-gen

Simple demos for algorithmic music pattern generation.

A desktop interface built with [Tauri](https://tauri.app/) provides the front‑end.
Templates and scripts live under the top‑level `ui/` directory.  Command‑line
usage via `start.py` remains available for automation.

Theme preference is persisted using Tauri's [store plugin](https://github.com/tauri-apps/plugins-workspace/),
falling back to `localStorage` when the plugin is not available.

## Quick Start

1. Create a virtual environment and install the Python dependencies:

   ```bash
   python3.10 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

   Install [`tqdm`](https://pypi.org/project/tqdm/) as well if you plan to use
   the legacy MusicGen smoke-test helper:

   ```bash
   pip install tqdm
   ```

2. Install Node dependencies (including the `ui/` front-end) and launch the desktop app in development mode:

   ```bash
   npm install
   npm install --prefix ui
   npm run tauri dev
   ```

3. Build a release bundle with:

   ```bash
    npm run tauri build
    ```

## MusicGen smoke test

Generate a short clip with Meta's pretrained MusicGen model. The `--prompt`
argument defaults to "60 bpm, chill, lofi vibe", so the script runs without
any parameters. Override it by passing your own prompt:

```bash
# uses the default prompt
python main_musicgen.py

# override the prompt
python main_musicgen.py --prompt "lofi hip hop beat for studying"
```

This writes the output WAV file under `out/musicgen/`. The first run downloads
the `facebook/musicgen-small` weights (about 3 GB).

The legacy `scripts/test_musicgen.py` helper remains available for a minimal
smoke test. It depends on `tqdm`, which is not bundled with the default
requirements; install it manually with `pip install tqdm` before running the
helper. Expect roughly 3 GB of GPU memory or 6 GB of system RAM for inference.
Producing a four‑second clip typically finishes in under 10 seconds on a recent
GPU and in roughly one to two minutes on a modern CPU.

## Prerequisites

- **64-bit Python 3.10**
- [Node.js](https://nodejs.org/en/download/)
- [Rust](https://www.rust-lang.org/tools/install)

The `start.py` helper creates a persistent virtual environment in `.venv`
(reusing it on subsequent runs), installs the packages from `requirements.txt`
if needed, installs Node dependencies in both the repository root and `ui/`,
and aborts if installation fails.

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

The default requirements also bundle [mido](https://mido.readthedocs.io/) for enhanced MIDI import and export, along with `torch` and `onnxruntime` to support phrase model training and ONNX inference.

To enable optional speaker diarization via
[pyannote.audio](https://github.com/pyannote/pyannote-audio), install the
``diarization`` extra:

```bash
pip install .[diarization]
```

The first invocation downloads the pretrained ``pyannote/speaker-diarization``
model. A CUDA-enabled GPU is strongly recommended for real-time use; CPU
inference is possible but significantly slower.

Example usage with the Discord transcription bot:

```python
import asyncio
from ears import run_bot, pyannote_diarize

asyncio.run(run_bot("TOKEN", 123456789012345678, diarizer=pyannote_diarize))
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

Training requires [PyTorch](https://pytorch.org/) and, for ONNX export, `onnxruntime`, both of which are included in `requirements.txt`.  Datasets consist of token sequences stored in `train.jsonl` and
`val.jsonl` which can be created with `data/build_dataset.py` (see
[`docs/datasets.md`](docs/datasets.md)).  Run the training script and point it at
these files:

```bash
python training/phrase_models/train_phrase_models.py --train data/train.jsonl --val data/val.jsonl
```

This trains tiny demonstration models and writes checkpoints.

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

## Discord transcription pipeline

The `ears.pipeline` module can capture audio from a Discord voice channel and
transcribe speech using Whisper. Transcripts are written to JSONL files under
`transcripts/`.

```python
import asyncio
from ears.pipeline import run_bot


async def on_part(part, speaker):
    print(f"{speaker}: {part.text}")


asyncio.run(
    run_bot(
        "TOKEN",
        123456789012345678,
        part_callback=on_part,
        rate_limit=0.3,
    )
)
```

Replace `TOKEN` with your bot token and the integer with the target voice
channel ID. ``part_callback`` receives both partial and final transcript
segments; ``rate_limit`` throttles how often partial updates are emitted.

## Mouth

The `mouth` package adds text-to-speech capabilities powered by
[Piper](https://github.com/rhasspy/piper). It can stream synthesized
speech to Discord voice channels or generate narration for other
systems.

### Secrets (API Keys)

Blossom stores sensitive keys (like ElevenLabs and Discord) in a Tauri Store file named `secrets.json` under your app data directory. You don’t need to commit this file.

Quick start:
- Visit **Settings → Discord** in the desktop app for a walkthrough on supplying your Discord bot token via
  `secrets.json` or the `DISCORD_TOKEN` environment variable.
- Use the AI Voice Labs screen to paste your ElevenLabs key. It will be saved to `secrets.json` automatically.
- Or create a `secrets.json` file manually in the app’s data directory with this shape:

```
{
  "elevenlabs": { "apiKey": "..." },
  "discord": { "botToken": "..." }
}
```

There’s also a `secrets.example.json` at the project root to copy from. The actual location of the app data directory depends on your OS (e.g., `%APPDATA%` on Windows). If you prefer, share the values via the UI instead of editing files.

### Piper installation

Install the `piper-tts` command-line tool and download at least one
voice model:

```bash
pip install piper-tts soundfile
piper --download en_US-amy-medium
```

Pass the model path to :class:`~mouth.tts.TTSEngine` or to the helper
functions shown below.

### Narrator and NPC voices

Voice profiles are stored in ``data/voices.json`` and loaded via
``VoiceRegistry``.  A ``narrator`` profile is always present and is
used when no ``voice`` name is supplied.  Assign Piper models to the
default narrator and to non-player characters (NPCs) by updating the
registry:

```python
from mouth import VoiceRegistry, VoiceProfile

registry = VoiceRegistry()
registry.set_profile("narrator", VoiceProfile("/path/to/narrator.onnx"))
registry.set_profile("goblin", VoiceProfile("/path/to/goblin.onnx"))
registry.save()
```

Later, pass ``voice="goblin"`` to select the NPC voice.

### Cache and warm start

Voice profiles are cached on disk; subsequent runs reuse the registry
and avoid reconfiguration.  Piper loads the voice model on first use, so
keeping a ``TTSEngine`` instance alive or calling ``engine.synthesize("")``
during startup warms the cache and eliminates initial latency.

### Discord example

See ``docs/examples/discord_piper_tts.py`` for an end-to-end snippet that
joins a voice channel and speaks a line of dialog.

### Running the Discord bot

Set the bot token in the ``DISCORD_TOKEN`` environment variable before
starting the bot:

```bash
export DISCORD_TOKEN="your_bot_token"
python discord_bot.py
```


## LLM Orchestrator

Orchestrate local LLM responses with context pulled from an Obsidian vault. See [docs/orchestrator.md](docs/orchestrator.md) for setup and usage details.
## Riffusion Vocoder (HiFi-GAN) – Setup

By default Riffusion uses Griffin–Lim to invert spectrograms to audio. For much higher fidelity you can enable a neural vocoder:

- Default vocoder: configurable via `default_vocoder` (hifigan|griffinlim).
- HiFi‑GAN (hub): the app can load NVIDIA’s HiFi‑GAN from PyTorch Hub on first run, then reuse it from cache.
- See [docs/riffusion_audio_quality.md](docs/riffusion_audio_quality.md) for a deeper
  guide to improving audio quality when you cannot use the neural vocoder or
  want to further reduce metallic artifacts.

Requirements
- Internet access on first use (Hub download). Subsequent runs use the local cache (Torch Hub under your user cache directory) and do not re‑download.
- CUDA recommended for real‑time or faster‑than‑real‑time synthesis on supported GPUs.

How it works
- The pipeline remaps Riffusion’s 512‑mel power spectrograms to ~80‑mel log features expected by many HiFi‑GAN checkpoints, then synthesizes audio.
- If the hub model is unavailable (offline) the job logs a clear fallback and uses Griffin–Lim automatically.

CLI examples
```
python -m blossom.audio.riffusion.cli_riffusion --preset piano --duration 12 --hub_hifigan --outfile out.wav
```
