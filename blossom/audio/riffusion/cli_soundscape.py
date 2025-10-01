from __future__ import annotations

import argparse
from pathlib import Path
import os
from typing import List, Tuple

import numpy as np
import soundfile as sf
from PIL import Image

from .riffusion_pipeline import RiffusionPipelineWrapper, RiffusionConfig
from .mel_codec import MelSpecConfig
from .stitcher import tiles_to_audio
from .presets import get_preset
from .mix import StemConfig, mix_stems, bus_compressor, width_enhance, limiter_peak


def seconds_per_tile(width: int, mel: MelSpecConfig) -> float:
    return (width * mel.hop_length) / float(mel.sample_rate)


def build_dark_ambience() -> List[StemConfig]:
    return [
        StemConfig(name="piano", prompt=get_preset("piano_warm").prompt, negative=get_preset("piano_warm").negative, gain_db=-2.0, pan=0.0, lowcut_hz=45.0, highcut_hz=8000.0),
        StemConfig(name="rain", prompt=get_preset("rain_window").prompt, negative=get_preset("rain_window").negative, gain_db=-8.0, pan=-0.2, lowcut_hz=120.0, highcut_hz=10000.0, sidechain=True),
        StemConfig(name="wind", prompt=get_preset("forest_wind").prompt, negative=get_preset("forest_wind").negative, gain_db=-10.0, pan=0.2, lowcut_hz=80.0, highcut_hz=9000.0, sidechain=True),
    ]


def main() -> int:
    # Suppress library tqdm bars; we print our own progress
    # Suppress tqdm-based bars from libraries (diffusers/transformers)
    os.environ.setdefault("DISABLE_TQDM", "1")
    os.environ.setdefault("TQDM_DISABLE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    try:
        from diffusers.utils import set_progress_bar_config as _set_pb
        from diffusers.utils import logging as dlogging
        _set_pb(disable=True)
        dlogging.set_verbosity_error()
    except Exception:
        pass
    # Silence benign librosa mel warning
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
    p = argparse.ArgumentParser(description="Riffusion Soundscape generator (layered stems)")
    p.add_argument("--preset", default="dark_ambience", help="Soundscape preset (default: dark_ambience)")
    p.add_argument("--duration", type=float, default=180.0)
    p.add_argument("--seed", type=int, default=12345)
    p.add_argument("--steps", type=int, default=30)
    p.add_argument("--guidance", type=float, default=7.0)
    p.add_argument("--width", type=int, default=512)
    p.add_argument("--height", type=int, default=512)
    p.add_argument("--sr", type=int, default=22050)
    p.add_argument("--crossfade_secs", type=float, default=0.35)
    p.add_argument("--outfile", type=Path, default=Path("soundscape.wav"))
    p.add_argument("--model", default=None)
    args = p.parse_args()

    # Prepare master log path next to outfile
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

    emit("load: initializing pipeline")
    mel = MelSpecConfig(sample_rate=args.sr)
    spt = seconds_per_tile(args.width, mel)
    tiles_count = max(1, int(np.ceil(args.duration / spt)))
    overlap_px = int(max(0, min(args.width // 2, round((args.crossfade_secs / spt) * args.width))))
    emit(f"plan: stems=3 tiles={tiles_count} seconds_per_tile={spt:.2f}s overlap_px={overlap_px}")

    if args.preset == "dark_ambience":
        stems_cfg = build_dark_ambience()
    else:
        stems_cfg = build_dark_ambience()

    pipe = RiffusionPipelineWrapper(RiffusionConfig(model=args.model or RiffusionConfig.model))

    # Generate stems
    mono_stems: List[Tuple[StemConfig, np.ndarray]] = []
    import time
    total_units = len(stems_cfg) * tiles_count
    done_units = 0
    t0 = time.time()
    emit("generate: starting stems")
    for si, scfg in enumerate(stems_cfg):
        tiles = []
        for i in range(tiles_count):
            img = pipe.generate_tile(
                prompt=scfg.prompt,
                negative_prompt=scfg.negative,
                seed=(args.seed + 7919 * si + i),
                steps=args.steps,
                guidance_scale=args.guidance,
                width=args.width,
                height=args.height,
            )
            if si == 0 and i == 0:
                cover_path = args.outfile.with_suffix('.png')
                try:
                    img.save(cover_path.as_posix())
                except Exception:
                    pass
            tiles.append(img)
            done_units += 1
            elapsed = max(0.001, time.time() - t0)
            avg = elapsed / max(1, done_units)
            remaining = max(0.0, (total_units - done_units) * avg)
            percent = int(done_units * 100 // total_units)
            emit(f"riffscape: {percent}% stem {si+1}/{len(stems_cfg)} tile {i+1}/{tiles_count} ETA: {int(remaining)}s")
        audio = tiles_to_audio(tiles, cfg=mel, overlap_px=overlap_px)
        mono_stems.append((scfg, audio.astype(np.float32)))

    # Mixdown
    emit("mix: mixing stems")
    piano_source = None
    for cfg, mono in mono_stems:
        if 'piano' in cfg.name:
            piano_source = mono
            break
    master, stereo_stems = mix_stems(mono_stems, sr=args.sr, sidechain_source=piano_source)
    emit("post: bus comp + width + limiter")
    master = bus_compressor(master, sr=args.sr)
    master = width_enhance(master, amount=0.05)
    master = limiter_peak(master, target_dbfs=-1.0)

    # Export stems + master
    emit("write: saving outputs")
    out_dir = args.outfile.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    # Save stems
    stem_paths = []
    for (cfg, _mono), stereo in zip(mono_stems, stereo_stems):
        p = out_dir / f"{args.outfile.stem}_{cfg.name}.wav"
        sf.write(p.as_posix(), stereo.T, args.sr, subtype='PCM_16')
        stem_paths.append(p.as_posix())
    # Save master
    sf.write(args.outfile.as_posix(), master.T, args.sr, subtype='PCM_16')
    emit(f"Wrote {args.outfile} ({len(master[0])/args.sr:.2f}s)")
    for sp in stem_paths:
        emit(f"Stem: {sp}")
    emit(f"Log: {log_path.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
