# Blossom_Music-gen

Simple demos for algorithmic music pattern generation.

**Python 3.10 required.** The `start.py` helper creates a temporary virtual
environment, installs the packages from `requirements.txt`, and aborts if
installation fails. After setup it opens a minimal main menu where clicking the
music icon launches the renderer UI.

## Dependencies

SFZ instruments may reference WAV or FLAC samples. Loading FLAC samples requires the
[soundfile](https://pysoundfile.readthedocs.io/) library, which can be installed with:

```bash
pip install soundfile
```

## Generate N minutes of music

1. Create a song specification JSON (see `core/song_spec.py` for fields).
2. Run the synth and specify the number of minutes you want:

```bash
pip install soundfile  # enables FLAC support
python -m core.main_synth --spec path/to/spec.json --minutes 3 --seed 42 --print-stats > plan.json
```

`main_synth.py` will extend the section list to meet the requested duration and print a JSON plan of events for each instrument.  The example above generates at least three minutes of material and writes it to `plan.json` while printing instrument event counts to the console.

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
the master mix passes through a peak limiter targeting ``-0.1`` dBFS by
default.  All paths are relative so the repository works out of the box after
cloning.

```bash
pip install soundfile  # enables FLAC support
python main_render.py --spec path/to/spec.json --keys-sfz /path/to/custom/keys.sfz --mix out/piano.wav
```

This command renders the keys using the specified SFZ instrument and writes the mix to `out/piano.wav`.

## Basic UI

For quick experiments the project includes a small Tkinter based user interface
(`ui.py`). The UI mirrors the command line options and writes the same output
files.

### Prerequisites

- Python 3.10 with the `tkinter` module available. On many Linux systems this
  can be installed via `sudo apt install python3-tk`.
- Optional: [`soundfile`](https://pysoundfile.readthedocs.io/) for FLAC
  support when rendering.

### Launching

Launch the interface through the bootstrapper:

```bash
python start.py
```

The script sets up a throwaway virtual environment, installs dependencies,
and then presents a window with a music icon. Clicking the icon opens the
rendering interface.

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
2. Start the launcher with `python start.py` (it creates a temporary
   environment and installs dependencies) and click the icon to open the
   renderer UI.
3. Browse to the spec JSON and adjust any desired parameters.
4. Click **Render** to create the mix and stems in the specified locations.
