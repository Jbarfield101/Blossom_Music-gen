from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

try:
    import torch
    import torchaudio
    _HAS_TORCH = True
except Exception:
    _HAS_TORCH = False
    torch = None  # type: ignore
    torchaudio = None  # type: ignore


@dataclass
class HiFiGANConfig:
    repo_dir: Optional[str] = None     # Path to cloned HiFi-GAN repo (for importing models)
    checkpoint_path: Optional[str] = None  # Path to generator weights (.pt/.pth)
    config_path: Optional[str] = None  # Optional model config JSON (if needed)
    device: Optional[str] = None       # 'cuda' | 'cpu' | 'mps'


def _autodevice() -> str:
    if not _HAS_TORCH:
        return 'cpu'
    if torch.cuda.is_available():
        return 'cuda'
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def load_hifigan(cfg: HiFiGANConfig):
    if not _HAS_TORCH:
        raise RuntimeError('PyTorch/torchaudio not available for HiFi-GAN')
    if not cfg.repo_dir or not os.path.isdir(cfg.repo_dir):
        raise FileNotFoundError('HiFi-GAN repo_dir not found')
    sys.path.append(cfg.repo_dir)
    # Lazy import after path injection
    from models import Generator  # type: ignore

    device = cfg.device or _autodevice()

    # Load config if available to extract channels/mel settings if needed
    hcfg = None
    if cfg.config_path and os.path.isfile(cfg.config_path):
        with open(cfg.config_path, 'r', encoding='utf-8') as f:
            hcfg = json.load(f)

    # Instantiate generator; fall back to common universal settings
    # Many released HiFi-GAN checkpoints are compatible with default Generator();
    # exact channels are loaded from state_dict.
    generator = Generator(hcfg.get('model', {}).get('upsample_rates', None) if hcfg else None)  # type: ignore
    sd = torch.load(cfg.checkpoint_path, map_location='cpu')
    if 'generator' in sd:
        sd = sd['generator']
    generator.load_state_dict(sd, strict=False)
    try:
        generator.remove_weight_norm()
    except Exception:
        pass
    generator.eval().to(device)
    return generator, device


def mel512_power_to_mel80_log(mel_power: np.ndarray, sr: int, n_fft: int, hop: int, fmin: float, fmax: Optional[float]) -> np.ndarray:
    """Project 512-bin mel power to 80-bin log-mel approximation for HiFi-GAN.

    Steps: mel(512,power) -> inverse mel -> linear power -> 80-mel power -> log10 amplitude.
    """
    if not _HAS_TORCH:
        raise RuntimeError('PyTorch/torchaudio not available for conversion')
    n_stft = n_fft // 2 + 1
    mel_t = torch.from_numpy(mel_power.astype(np.float32))  # [512, T]
    inverse_kwargs = dict(
        n_stft=n_stft,
        n_mels=mel_power.shape[0],
        sample_rate=sr,
        f_min=fmin,
        f_max=fmax,
    )
    try:
        inv_transform = torchaudio.transforms.InverseMelScale(max_iter=0, **inverse_kwargs)
    except TypeError:
        inv_transform = torchaudio.transforms.InverseMelScale(**inverse_kwargs)
    inv = inv_transform(mel_t)
    # inv is linear power [freq, time]
    # Build 80-mel filter and apply
    mel80_transform = torchaudio.transforms.MelScale(
        n_mels=80,
        sample_rate=sr,
        f_min=fmin,
        f_max=fmax,
        n_stft=n_stft,
    )
    mel80_power = mel80_transform(inv)  # [80, T]
    mel80_mag = torch.sqrt(torch.clamp(mel80_power, min=1e-10))
    mel80_log = torch.log10(torch.clamp(mel80_mag, min=1e-10))
    return mel80_log.numpy()


def hifigan_synthesize(generator, device: str, mel80_log: np.ndarray) -> np.ndarray:
    if not _HAS_TORCH:
        raise RuntimeError('PyTorch not available')
    with torch.no_grad():
        mel = torch.from_numpy(mel80_log).unsqueeze(0)  # [1, 80, T]
        mel = mel.to(device)
        audio = generator(mel).squeeze().cpu().numpy().astype(np.float32)
        # Normalize softly
        peak = float(np.max(np.abs(audio)) or 0.0)
        if peak > 1.0:
            audio = audio / peak
        audio = np.clip(audio, -1.0, 1.0)
        return audio

