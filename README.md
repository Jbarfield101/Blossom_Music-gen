# Blossom_Music-gen

Simple demos for algorithmic music pattern generation.

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

## Using External Piano Samples

To render the piano part with external SFZ samples, pass the path using the `--piano-sfz` flag. The default configuration points to `assets/sfz/piano.sfz` in `render_config.json`.

```bash
pip install soundfile  # enables FLAC support
python main_render.py --spec path/to/spec.json --piano-sfz /path/to/custom/piano.sfz --mix out/piano.wav
```

This command renders the keys using the specified SFZ instrument and writes the mix to `out/piano.wav`.
