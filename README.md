# Blossom Music

Blossom is a toolkit for algorithmic arrangement, MusicGen-powered synthesis, and runtime services that support tabletop campaigns. It ships with a Tauri desktop shell, Python CLIs, and Discord automation.

## Highlights

- Deterministic arrangers, phrase models, and mixers under `core/`
- MusicGen and Riffusion back ends with optional neural vocoders
- Desktop UI (Tauri + React) plus Python CLIs for automation
- Discord ingestion (`ears/`) and narration (`mouth/`) services
- Obsidian-aware LLM orchestrator for lore-grounded NPC dialogue

## Quick Start

1. Create and activate a Python 3.10 virtual environment, then install dependencies:

   ```bash
   python -m venv .venv              # py -3.10 -m venv .venv on Windows
   source .venv/bin/activate         # .\.venv\Scripts\activate on Windows
   pip install -r requirements.txt
   ```

   Optional helpers:

   ```bash
   pip install tqdm          # legacy MusicGen smoke test helper
   pip install scipy         # vectorised EQ filters
   pip install soundfile     # FLAC-aware SFZ instruments
   ```

2. Install Node dependencies (root and `ui/`) and launch the desktop shell in dev mode:

   ```bash
   npm install
   npm install --prefix ui
   npm run tauri dev
   ```

3. Build a distributable desktop bundle when needed:

   ```bash
   npm run tauri build
   ```

If Tauri reports missing `commands::*` bindings, follow [docs/tauri_troubleshooting.md](docs/tauri_troubleshooting.md) to refresh generated code and cached artefacts.

### One-shot bootstrap

`python start.py` reuses an on-disk `.venv`, installs Python and Node dependencies if required, and launches the CLI with any arguments you pass through.

### Canonical tests

```bash
python -m pytest -vv
npm --prefix ui run test
BLOSSOM_PERF_BUDGET=5 pytest tests/test_performance.py    # latency gates
pytest tests/test_exported_models.py                      # ONNX changes
```

## Repository layout

- `core/` - arrangement, stems, mixer, phrase models
- `blossom/audio/` - reusable audio utilities (MusicGen, Riffusion, Piper)
- `brain/` - orchestration logic (LLM, lore lookups, dialogue helpers)
- `ears/` - ingestion pipelines and Discord capture bots
- `mouth/` - TTS and narration services
- `ui/` - React front end, `src-tauri/` - native shell
- `assets/`, `config/`, `data/` - shared templates, presets, and datasets
- `scripts/` - CLI helpers and analysis tools
- `tests/` - regression and integration coverage

## Command-line entry points

### MusicGen smoke test

Generate a short clip with Meta's pretrained MusicGen model. The `--prompt` argument defaults to `60 bpm, chill, lofi vibe` so the script runs without parameters:

```bash
python main_musicgen.py
python main_musicgen.py --prompt "lofi hip hop beat for studying"
```

Outputs land under `out/musicgen/`. The first run downloads `facebook/musicgen-small` (about 3 GB). Expect roughly 3 GB of GPU memory or 6 GB of system RAM; four seconds of audio typically renders in around 10 seconds on a recent GPU and one to two minutes on a modern CPU. `scripts/test_musicgen.py` provides a minimal smoke test for automation (requires `tqdm`).

### Arrangement and rendering

`main_render.py` renders stems and a stereo mix from a song spec or built-in template. SFZ instruments and mix presets are optional overrides:

```bash
pip install soundfile
python main_render.py --spec path/to/spec.json --keys-sfz /path/to/keys.sfz --mix out/piano.wav
python main_render.py --preset pop_verse_chorus --mix out/piano.wav
python main_render.py --bundle path/to/bundle --eval-only          # reuse existing stems
```

Templates live in `assets/presets/`; mix settings default to an automatic gain trim and limiter with a -0.8 dBFS ceiling.

### Riffusion vocoder

Enable NVIDIA's HiFi-GAN through the Riffusion CLI for higher-fidelity spectrogram inversion:

```bash
python -m blossom.audio.riffusion.cli_riffusion --preset piano --duration 12 --hub_hifigan --outfile out.wav
```

On the first run the model downloads from Torch Hub (internet required), then reuses the local cache. Supply `--hifigan_repo` and `--hifigan_ckpt` for offline checkpoints. See [docs/riffusion_audio_quality.md](docs/riffusion_audio_quality.md) for detailed tuning advice.

## Desktop UI (Tauri)

`npm run tauri dev` mirrors the CLI options and writes identical output bundles. Fill in the song spec, optional SFZ paths, seeds, and destinations, then press **Render**. Build releases with `npm run tauri build`; artefacts land under `src-tauri/target/release`.

## Discord services

- **Transcription** (`ears.pipeline`): capture voice channels, transcribe with Whisper, and stream partial updates via callbacks. Configure bot tokens through the desktop settings or `secrets.json`. See [docs/discord.md](docs/discord.md) for permissions and troubleshooting.
- **Narration** (`mouth`): manage Piper or ElevenLabs voices via `data/voices.json`, warm caches on startup, and stream TTS back to Discord. Example snippets live under `docs/examples/`.

Secrets live in a Tauri store file (`secrets.json`) under the app data directory. Use the UI (**Settings > Discord**) or create a file shaped like:

```json
{
  "elevenlabs": { "apiKey": "..." },
  "discord": { "botToken": "..." }
}
```

`secrets.example.json` in the repo root provides a template.

## LLM orchestrator

`brain/dialogue.py` coordinates local LLM responses backed by an Obsidian vault. Install [Ollama](https://ollama.ai) and populate the Dreadhaven lore directory described in [docs/orchestrator.md](docs/orchestrator.md). Helper functions surface NPC dialogue and lore lookups to the desktop UI and Discord bots.

## Additional documentation

- [docs/benchmarking.md](docs/benchmarking.md) - render performance harness
- [docs/phrase_models.md](docs/phrase_models.md) - training and exporting RNN phrase models
- [docs/settings_about.md](docs/settings_about.md) - usage metrics surfaced in the desktop UI
- [docs/style_profiles.md](docs/style_profiles.md) - arrangement defaults per genre
- [docs/tauri_troubleshooting.md](docs/tauri_troubleshooting.md) - common build fixes
- [docs/README_dnd_ids.md](docs/README_dnd_ids.md) - Dreadhaven entity ID guide

Keep these guides updated as new services or workflows ship.
