from __future__ import annotations

from typing import List

import numpy as np
from PIL import Image

from .mel_codec import image_to_mel, mel_to_audio_griffin_lim, MelSpecConfig
from blossom.audio.vocoders.hifigan import load_hifigan as hub_load_hifigan, mel_to_audio_hifigan as hub_mel_to_audio


def stitch_tiles_horizontally(tiles: List[Image.Image], overlap_px: int = 32) -> Image.Image:
    """Stitch spectrogram tiles left-to-right with linear crossfade in overlaps.

    Assumes all tiles have the same height and mode (e.g., "L").
    """
    if not tiles:
        raise ValueError("No tiles provided")
    # Normalize modes and sizes
    base_h = tiles[0].height
    norm = [t.convert("L").resize((t.width, base_h)) for t in tiles]

    total_width = sum(t.width for t in norm)
    if overlap_px > 0:
        total_width -= overlap_px * (len(norm) - 1)

    canvas = Image.new("L", (total_width, base_h))
    x = 0
    for idx, tile in enumerate(norm):
        if idx == 0:
            canvas.paste(tile, (x, 0))
            x += tile.width - overlap_px
            continue

        # Blend overlap region
        if overlap_px > 0:
            left_region = canvas.crop((x, 0, x + overlap_px, base_h))
            right_region = tile.crop((0, 0, overlap_px, base_h))

            # Linear crossfade mask from 0->255 across the overlap
            alpha = np.tile(np.linspace(0, 1, overlap_px, dtype=np.float32), (base_h, 1))
            left_np = np.asarray(left_region, dtype=np.float32)
            right_np = np.asarray(right_region, dtype=np.float32)
            blended = (1 - alpha) * left_np + alpha * right_np
            blended_img = Image.fromarray(blended.astype(np.uint8), mode="L")

            canvas.paste(blended_img, (x, 0))
            # Paste the remainder of the tile after overlap
            canvas.paste(tile.crop((overlap_px, 0, tile.width, base_h)), (x + overlap_px, 0))
            x += tile.width - overlap_px
        else:
            canvas.paste(tile, (x, 0))
            x += tile.width

    return canvas


def tiles_to_audio(
    tiles: List[Image.Image],
    cfg: MelSpecConfig = MelSpecConfig(),
    overlap_px: int = 32,
    griffinlim_iters: int = 128,
    gl_restarts: int = 1,
    vocoder_name: str | None = None,
) -> np.ndarray:
    """Stitch tiles into one spectrogram image and invert to audio.

    Expects each tile to represent 512 mel bins by 512 time frames when resized.
    """
    stitched = stitch_tiles_horizontally(tiles, overlap_px=overlap_px)
    mel_power = image_to_mel(stitched, target_shape=(cfg.n_mels, stitched.width))
    if (vocoder_name or '').lower() == 'hifigan':
        try:
            hifi, vsetup, deno = hub_load_hifigan(device='cuda' if hasattr(__import__('torch'), 'cuda') and __import__('torch').cuda.is_available() else 'cpu')
            return hub_mel_to_audio(mel_power, vsetup, hifi, denoiser=deno, device=('cuda' if __import__('torch').cuda.is_available() else 'cpu'))
        except Exception:
            # Fallback to Griffin-Lim
            pass
    audio = mel_to_audio_griffin_lim(mel_power, cfg=cfg, n_iter=griffinlim_iters, restarts=gl_restarts)
    return audio
