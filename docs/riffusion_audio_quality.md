# Improving Riffusion Audio Quality

Riffusion renders short spectrogram tiles and then turns them back into wave
files.  The defaults favor low dependency installs, so generations can sound
metallic or bandwidth-limited.  Use the following levers to tighten up the
output without changing the core diffusion model.

## 1. Prefer a Neural Vocoder

Griffin–Lim phase reconstruction is a last-resort fallback.  Its iterative
phase guesses create the "phasiness" that most users notice.

* **Enable NVIDIA's HiFi-GAN from Torch Hub**.  Pass `--hub_hifigan` to
  `python -m blossom.audio.riffusion.cli_riffusion ...` or set the
  environment variable `RIFFUSION_DEFAULT_VOCODER=hifigan` so every job uses
  the neural decoder when the download succeeds.  The first run pulls the
  checkpoint from the internet and caches it under your Torch Hub directory.
* **Offline/air‑gapped machines** can load a local HiFi-GAN checkpoint by
  supplying `--hifigan_repo` (path to the cloned repo) together with
  `--hifigan_ckpt` (generator `.pt/.pth`).  The helper automatically projects
  Riffusion's 512-bin mel power spectrogram into the 80-bin log-mel features
  that the published checkpoints expect.
* If the HiFi-GAN load fails for any reason (e.g. no internet), the CLI logs a
  warning and falls back to Griffin–Lim automatically, so you can retry once
  the dependency is available.

## 2. Tune Griffin–Lim When You Cannot Use HiFi-GAN

If you are stuck with Griffin–Lim, increase the quality knobs so the algorithm
has more chances to converge:

* `--gl_iters` controls how many Griffin–Lim iterations are run (default 128).
  Doubling or tripling the iterations noticeably reduces the metallic ring at
  the cost of CPU time.
* `--gl_restarts` (default 2) restarts the algorithm with new random phase
  seeds and keeps the cleanest result.  Raising this to 4 or 8 often helps for
  dense material.

These switches map directly to the call in
`tiles_to_audio(..., griffinlim_iters=?, gl_restarts=?)`, so higher numbers are
purely a quality/time trade-off.

## 3. Crossfade or Overlap Tiles

Each tile covers roughly `width * hop_length / sample_rate` seconds (≈5.9 s
with the defaults).  Hard cuts between tiles amplify the seam.  Let the tiles
blend by either:

* Supplying `--crossfade_secs` (default 0.25 s) so the stitcher overlaps that
  much time with an equal-power crossfade, or
* Passing an explicit pixel overlap via `--overlap`.  Values up to half the
  tile width are accepted; higher overlaps create smoother continuity at the
  cost of reusing more of the previous tile.

## 4. Raise the Sample Rate When Headroom Exists

22.05 kHz is fast and keeps GPU memory pressure low, but it also caps the
spectrum near 10 kHz.  If you have compute headroom, generate at 32 kHz or
44.1 kHz by calling `--sr 32000` (or `44100`).  The mel codec resynthesizes at
that rate and the post chain applies the same equalization/reverb settings.

## 5. Post-Process to Restore Brilliance

The CLI already applies a gentle mastering chain (high-shelf EQ, high-pass,
light reverb, and dithering).  Tweak these if the output still feels veiled:

* `--hs_gain` in dB raises or lowers the built-in high shelf (default +2 dB).
  Push it to +4 dB or +5 dB for brighter output, or set it to zero to disable.
* Disable the whole chain with `--no-post` if you want to run your own effects
  stack in a DAW.

## 6. Prompt and Seed Strategy

Because each tile is generated independently, use consistent wording and small
seed offsets to avoid dramatic jumps.  Passing a fixed seed lets you explore
variations predictably—each tile uses `seed + tile_index`—and prevents sudden
mood swings that exaggerate the stitching artifacts.

---

Combine the neural vocoder with sensible overlaps and a higher sample rate and
you will remove the metallic tone and extend the bandwidth of most Riffusion
renders, even without retraining the diffusion backbone.
