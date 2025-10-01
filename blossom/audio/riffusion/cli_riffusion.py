from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
import soundfile as sf

from .riffusion_pipeline import RiffusionPipelineWrapper, RiffusionConfig
from .stitcher import tiles_to_audio
from .presets import render_prompt, get_preset
from .mel_codec import MelSpecConfig
from .post import (
    ChainSettings,
    EqSettings,
    ReverbSettings,
    DitherSettings,
    process_audio_chain,
    write_metadata_json,
)


def main() -> int:
    # Suppress library tqdm bars; we print our own progress
    # Suppress tqdm-based bars from libraries (diffusers/transformers)
    os.environ.setdefault("DISABLE_TQDM", "1")  # some libs honor this
    os.environ.setdefault("TQDM_DISABLE", "1")   # tqdm global toggle
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    try:
        from diffusers.utils import set_progress_bar_config as _set_pb
        from diffusers.utils import logging as dlogging
        _set_pb(disable=True)
        dlogging.set_verbosity_error()
    except Exception:
        pass
    # Silence a benign librosa warning about mel filter edges for our chosen params
    import warnings  # noqa: E402
    warnings.filterwarnings(
        "ignore",
        message=r"Empty filters detected in mel frequency basis",
        module=r"librosa\.feature\.inverse",
        category=UserWarning,
    )
    warnings.filterwarnings(
        "ignore",
        message=r"The configuration file of the unet has set the default `sample_size`",
        module=r"diffusers\.pipelines\.stable_diffusion\.pipeline_stable_diffusion",
        category=FutureWarning,
    )
    p = argparse.ArgumentParser(description="Riffusion dev runner (tiles -> audio)")
    p.add_argument("prompt", nargs="?", default=None)
    p.add_argument("--preset", default="piano", help="Preset key (default: piano)")
    p.add_argument("--negative", default=None, help="Negative prompt override")
    p.add_argument("--seed", type=int, default=12345)
    p.add_argument("--steps", type=int, default=30)
    p.add_argument("--guidance", type=float, default=7.0)
    p.add_argument("--tiles", type=int, default=0, help="Explicit tile count; overrides duration if > 0")
    p.add_argument("--duration", type=float, default=0.0, help="Desired duration in seconds; used if tiles == 0")
    p.add_argument("--width", type=int, default=512)
    p.add_argument("--height", type=int, default=512)
    p.add_argument("--overlap", type=int, default=None, help="Tile overlap in pixels (time frames)")
    p.add_argument("--crossfade_secs", type=float, default=0.25, help="Crossfade time between tiles in seconds (used if --overlap not set)")
    p.add_argument("--sr", type=int, default=22050)
    p.add_argument("--outfile", type=Path, default=Path("riffusion_out.wav"))
    p.add_argument("--model", default=None, help="Hugging Face model id or local path")
    # Post chain options
    p.add_argument("--hs_freq", type=float, default=5000.0, help="High-shelf frequency (Hz)")
    p.add_argument("--hs_gain", type=float, default=2.0, help="High-shelf gain (dB)")
    p.add_argument("--lowcut", type=float, default=35.0, help="High-pass cutoff (Hz)")
    p.add_argument("--wet", type=float, default=0.12, help="Reverb wet mix [0,1]")
    p.add_argument("--no-post", action="store_true", help="Disable post-processing chain")
    args = p.parse_args()

    # Prepare logfile path next to outfile
    log_path = args.outfile.with_suffix('.log')
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    def emit(msg: str):
        print(msg, flush=True)
        try:
            with open(log_path, 'a', encoding='utf-8') as lf:
                lf.write(msg.rstrip('\n') + '\n')
        except Exception:
            pass

    # Build prompt/negative from preset + optional extra text
    preset = get_preset(args.preset) if args.preset else None
    base = preset.prompt if preset else ""
    prompt = render_prompt(args.preset, args.prompt) if args.preset else (args.prompt or base)
    negative = args.negative if args.negative is not None else (preset.negative if preset else None)

    cfg = RiffusionConfig(model=args.model or RiffusionConfig.model)
    pipe = RiffusionPipelineWrapper(cfg)
    emit("load: initializing pipeline")

    # Determine tile count from desired duration if not set explicitly
    cfg_mel = MelSpecConfig(sample_rate=args.sr)
    seconds_per_tile = (args.width * cfg_mel.hop_length) / float(cfg_mel.sample_rate)
    total_tiles = int(args.tiles) if int(args.tiles) > 0 else max(1, int(np.ceil(max(0.01, float(args.duration)) / seconds_per_tile)))
    # Determine overlap in px from crossfade seconds if not set
    if args.overlap is None:
        overlap_px = int(max(0, min(args.width // 2, round((args.crossfade_secs / seconds_per_tile) * args.width))))
    else:
        overlap_px = int(max(0, min(args.width // 2, int(args.overlap))))

    emit(f"plan: tiles={total_tiles} seconds_per_tile={seconds_per_tile:.2f}s overlap_px={overlap_px}")

    tiles = []
    import time
    t0 = time.time()
    emit("generate: starting")
    for i in range(int(total_tiles)):
        tile = pipe.generate_tile(
            prompt=prompt,
            negative_prompt=negative,
            seed=(args.seed + i if args.seed is not None else None),
            steps=args.steps,
            guidance_scale=args.guidance,
            width=args.width,
            height=args.height,
        )
        if i == 0:
            # Save cover image alongside outfile
            cover_path = args.outfile.with_suffix('.png')
            try:
                tile.save(cover_path.as_posix())
            except Exception:
                pass
        tiles.append(tile)
        # Emit progress line
        elapsed = max(0.001, time.time() - t0)
        avg = elapsed / (i + 1)
        remaining = max(0.0, (total_tiles - (i + 1)) * avg)
        percent = int((i + 1) * 100 // total_tiles)
        # Print in a parse-friendly format; Job system looks for "<word>:" prefix and "NN%" and optional ETA
        emit(f"riffusion: {percent}% tile {i+1}/{total_tiles} ETA: {int(remaining)}s")

    emit("stitch: combining tiles")
    audio = tiles_to_audio(tiles, cfg=cfg_mel, overlap_px=overlap_px)
    audio = np.asarray(audio, dtype=np.float32)

    meta = {
        "prompt": prompt,
        "negative": negative,
        "seed": args.seed,
        "steps": args.steps,
        "guidance": args.guidance,
        "sr": args.sr,
        "tiles": int(total_tiles),
        "width": int(args.width),
        "height": int(args.height),
        "overlap_px": int(overlap_px),
        "seconds_per_tile": seconds_per_tile,
        "duration": float(args.duration or (total_tiles * seconds_per_tile)),
    }

    if not args.no_post:
        emit("post: EQ + reverb + dither")
        chain = ChainSettings(
            eq=EqSettings(high_shelf_freq_hz=args.hs_freq, high_shelf_gain_db=args.hs_gain, lowcut_hz=args.lowcut),
            reverb=ReverbSettings(wet=max(0.0, min(1.0, args.wet))),
            dither=DitherSettings(target_peak_dbfs=-1.0, bit_depth=16),
        )
        audio = process_audio_chain(audio, sr=args.sr, chain=chain, seed=args.seed)
        meta["chain"] = {
            "eq": {
                "high_shelf_freq_hz": args.hs_freq,
                "high_shelf_gain_db": args.hs_gain,
                "lowcut_hz": args.lowcut,
            },
            "reverb": {"wet": args.wet},
            "dither": {"target_peak_dbfs": -1.0, "bit_depth": 16},
        }

    # Export WAV with PCM_16 so our dither is appropriate
    emit("write: saving outputs")
    sf.write(args.outfile.as_posix(), audio, args.sr, subtype='PCM_16')
    meta_path = write_metadata_json(args.outfile, meta)
    emit(f"Wrote {args.outfile} ({len(audio)/args.sr:.2f}s)")
    emit(f"Metadata: {meta_path}")
    emit(f"Log: {log_path.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
