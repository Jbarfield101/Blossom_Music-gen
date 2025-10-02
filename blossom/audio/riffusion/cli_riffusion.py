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
from .vocoder_hifigan import (
    HiFiGANConfig,
    load_hifigan,
    mel512_power_to_mel80_log,
    hifigan_synthesize,
)
from blossom.audio.vocoders.hifigan import (
    load_hifigan as hub_load_hifigan,
    mel_to_audio_hifigan as hub_mel_to_audio,
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
    # Griffin-Lim quality controls
    p.add_argument("--gl_iters", type=int, default=128, help="Griffin-Lim iterations (higher = cleaner phase)")
    p.add_argument("--gl_restarts", type=int, default=2, help="Griffin-Lim random restarts; best is chosen")
    # HiFi-GAN (neural vocoder)
    p.add_argument("--hifigan_repo", default=None, help="Path to cloned HiFi-GAN repo (adds to sys.path)")
    p.add_argument("--hifigan_ckpt", default=None, help="Path to HiFi-GAN generator checkpoint (.pt/.pth)")
    p.add_argument("--hifigan_config", default=None, help="Optional HiFi-GAN config JSON path")
    # Hub HiFi-GAN (NVIDIA torch.hub)
    p.add_argument("--hub_hifigan", action="store_true", help="Use NVIDIA HiFi-GAN via torch.hub")
    p.add_argument("--hub_denoise", type=float, default=0.0, help="Hub denoiser strength (0 to disable)")
    p.add_argument("--vocoder", default=None, choices=["hifigan","griffinlim", None], help="Select vocoder (overrides other flags)")
    args = p.parse_args()
    # Optional default via environment: RIFFUSION_DEFAULT_VOCODER=hifigan|griffinlim
    out_sr = int(args.sr)
    env_vocoder = os.environ.get("RIFFUSION_DEFAULT_VOCODER", "").strip().lower()
    if env_vocoder == "hifigan":
        args.hub_hifigan = True
    elif env_vocoder == "griffinlim":
        args.hub_hifigan = False

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
    cfg_mel = MelSpecConfig(sample_rate=out_sr)
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
    last_t = time.time()
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
        now_t = time.time()
        emit(f"tile_time: {now_t - last_t:.3f}s")
        last_t = now_t
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
    # Stitch to a single spectrogram image
    from .stitcher import stitch_tiles_horizontally
    emit("stitch: combining tiles")
    stitched = stitch_tiles_horizontally(tiles, overlap_px=overlap_px)
    # If HiFi-GAN is provided, synthesize via neural vocoder; else Griffin-Lim
    audio = None
    if args.hub_hifigan:
        emit("vocoder: loading hub HiFi-GAN")
        try:
            hifi, vsetup, deno = hub_load_hifigan(device="cuda")
            from .mel_codec import image_to_mel
            mel_power512 = image_to_mel(stitched, target_shape=(cfg_mel.n_mels, stitched.width))
            emit("vocoder: synthesizing audio (hub)")
            v0 = time.time()
            audio = hub_mel_to_audio(mel_power512, vsetup, hifi, denoiser=deno if args.hub_denoise > 0 else None, device="cuda")
            emit(f"vocoder_time: {time.time() - v0:.3f}s")
        except Exception as e:
            emit(f"vocoder: hub failed ({e}); falling back")
            audio = None

    if audio is None and args.hifigan_repo and args.hifigan_ckpt:
        emit("vocoder: loading HiFi-GAN")
        try:
            gen, dev = load_hifigan(HiFiGANConfig(
                repo_dir=args.hifigan_repo,
                checkpoint_path=args.hifigan_ckpt,
                config_path=args.hifigan_config,
            ))
            emit("vocoder: preparing 80-mel features")
            mel_power512 = mel512_power = None
            # Convert image->mel power (512) using our codec, then to 80-log-mel
            from .mel_codec import image_to_mel
            mel_power512 = image_to_mel(stitched, target_shape=(cfg_mel.n_mels, stitched.width))
            mel80_log = mel512_power_to_mel80_log(
                mel_power512,
                sr=cfg_mel.sample_rate,
                n_fft=cfg_mel.n_fft,
                hop=cfg_mel.hop_length,
                fmin=cfg_mel.f_min,
                fmax=cfg_mel.f_max,
            )
            emit("vocoder: synthesizing audio")
            v0 = time.time()
            audio = hifigan_synthesize(gen, dev, mel80_log)
            emit(f"vocoder_time: {time.time() - v0:.3f}s")
        except Exception as e:
            emit(f"vocoder: failed ({e}); falling back to Griffin-Lim")

    if audio is None:
        emit("invert: Griffin-Lim")
        from .stitcher import tiles_to_audio as _tiles_to_audio
        inv0 = time.time()
        audio = _tiles_to_audio(
            tiles,
            cfg=cfg_mel,
            overlap_px=overlap_px,
            griffinlim_iters=max(1, int(args.gl_iters)),
            gl_restarts=max(1, int(args.gl_restarts)),
        )
        emit(f"invert_time: {time.time() - inv0:.3f}s")
        emit("vocoder_used: griffinlim")
        emit(f"invert_time: {time.time() - inv0:.3f}s")
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=-1)
    if audio.size == 0 or not np.isfinite(audio).all():
        emit("audio_warn: empty/invalid audio after inversion; generating silence")
        est_len = int(max(1, round((total_tiles * seconds_per_tile) * out_sr)))
        audio = np.zeros(est_len, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=-1)
    if audio.size == 0 or not np.isfinite(audio).all():
        emit("audio_warn: empty/invalid audio after inversion; generating silence")
        est_len = int(max(1, round((total_tiles * seconds_per_tile) * out_sr)))
        audio = np.zeros(est_len, dtype=np.float32)
