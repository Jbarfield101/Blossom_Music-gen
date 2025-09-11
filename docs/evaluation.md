# Evaluation Metrics

The pipeline records several metrics for each render. Typical thresholds indicate whether a value is within an expected range or may need attention.

## chord_tone_coverage
Fraction of bass, keys and pad notes that match the underlying chord.
- **Typical threshold:** ≥ 0.7
- **Interpretation:** Values above the threshold mean most notes align harmonically. Low values suggest off-chord notes.

## voice_leading_smoothness
Average absolute semitone movement across SATB voices.
- **Typical threshold:** ≤ 4 semitones
- **Interpretation:** Lower numbers reflect smoother progressions. High values indicate large leaps between chords.

## rhythmic_stability
Per-instrument variance of inter-onset intervals.
- **Typical threshold:** ≤ 0.5 beats²
- **Interpretation:** Small variances denote steady rhythms. High variance reveals uneven timing.

## cadence_fill_rate
Fraction of cadence bars preceded by above-average note density.
- **Typical threshold:** ≥ 0.5
- **Interpretation:** Higher rates show clear builds into cadences. Low rates imply little change in activity before cadences.

## density_alignment
Normalized comparison of expected vs. actual note density per section.
- **Typical threshold:** |expected – actual| ≤ 0.15
- **Interpretation:** Differences within this band mean section densities follow the intended curve. Larger gaps indicate mismatched energy.

## audio_stats
Peak and RMS levels in dBFS for the rendered audio.
- **Typical thresholds:** peak ≤ −1 dBFS, RMS between −15 and −12 dBFS
- **Interpretation:** Peaks above 0 dBFS clip. RMS much below −20 dBFS sounds quiet, while higher levels approach loudness targets.

