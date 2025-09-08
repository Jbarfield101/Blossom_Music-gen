# Pattern Synthesizer

`core/pattern_synth.py` implements simple deterministic pattern generation for the demo instruments.

## Rhythm generation

Rhythms are built from a meter-aware step grid.  The helper `_steps_per_bar` derives how many 16th‑note subdivisions live in a bar and the `euclid()` function spreads a requested number of pulses evenly across that grid.  Additional events (such as hi‑hat accents) are pulled from `probability_grid`, which samples Boolean hits from supplied probabilities.

## Markov/sequence logic

Each generator receives a dedicated random number generator seeded via `_seeded_rng(seed, section, instrument)`.  The current implementation samples events independently, but the signature makes it easy to swap the inner loop with a Markov chain that conditions the next state on the previous one.  Maintaining the generator between calls allows reproducible stateful behaviour.

## Density mapping

`SongSpec.density_curve` provides values in the range 0–1.  Those values control how many pulses are requested or how likely extra notes become:

* Drums: `pulses = max(1, int(round(1 + density * 3)))`
* Bass: `pulses = max(1, int(round(1 + density * 2)))`
* Keys: `pulses = max(1, int(round(1 + density * 3)))`
* Pads: triggered when `rng.random() < density + 0.1`

Higher density therefore increases the number of rhythmic hits or the probability of ornamental notes.

## Extension hooks

The module is intentionally small so it can be extended:

* Add a new `gen_foo()` function following the existing instrument generators.
* Inside `build_patterns_for_song` register the new part with `_seeded_rng` to obtain a deterministic RNG and append the events to the section plan.
* Replace the probability grids with a Markov transition table or other rhythmic logic as needed.

These hooks keep the core deterministic while allowing more sophisticated algorithms to be plugged in later.
