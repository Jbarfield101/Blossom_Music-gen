# Style profiles

Built-in arrangement styles adapt swing behaviour and apply mix defaults for different genres. Style data lives in `assets/styles/` and is referenced by name or token when rendering.

## Available styles

| Name | Token ID | Mix defaults |
| --- | --- | --- |
| lofi | 0 | lpf_cutoff 3000 Hz, chorus 0.4, saturation 0.3, drums swing 0.05 |
| rock | 1 | lpf_cutoff 8000 Hz, chorus 0.2, saturation 0.1, drums swing 0.0 |
| cinematic | 2 | lpf_cutoff 12000 Hz, chorus 0.1, saturation 0.05, drums swing 0.0 |

The top-level `swing` field in each JSON sets overall arrangement swing. Nested `drums.swing` applies an additional swing factor to drum patterns.

## Adding a new style

1. Create a JSON file in `assets/styles/<name>.json` following the existing structure:

```json
{
  "swing": 0.0,
  "drums": {"swing": 0.0},
  "synth_defaults": {
    "lpf_cutoff": 8000.0,
    "chorus": 0.2,
    "saturation": 0.1
  },
  "sections": ["intro", "verse", "chorus"]
}
```

2. Register the style in `core/style.py` by adding an entry to the `StyleToken` enum.
3. Update any logic that depends on the number of styles (e.g. training utilities).
4. Refer to the new style by name via command-line `--style` arguments or configuration files.

