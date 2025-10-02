from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Tuple

import numpy as np
from PIL import Image
import librosa
import importlib
import sys


_torch_module = sys.modules.get("torch")
if _torch_module is not None:
    torch = _torch_module
else:
    _torch_spec = importlib.util.find_spec("torch")
    torch = importlib.import_module("torch") if _torch_spec is not None else None

_torchaudio_module = sys.modules.get("torchaudio")
if _torchaudio_module is not None:
    torchaudio = _torchaudio_module
else:
    _torchaudio_spec = importlib.util.find_spec("torchaudio")
    torchaudio = importlib.import_module("torchaudio") if _torchaudio_spec is not None else None
_HAS_TORCHAUDIO = torch is not None and torchaudio is not None


@dataclass
class MelSpecConfig:
    sample_rate: int = 22050
    n_fft: int = 1024
    hop_length: int = 256  # 512 frames -> ~5.94s at 22.05kHz
    win_length: int = 1024
    n_mels: int = 512
    f_min: float = 20.0
    f_max: float | None = 10000.0

    @classmethod
    def tacotron(cls) -> "MelSpecConfig":
        """Return the canonical Tacotron/HiFi-GAN mel configuration (80 bins)."""
        return cls(
            sample_rate=22050,
            n_fft=1024,
            hop_length=256,
            win_length=1024,
            n_mels=80,
            f_min=30.0,
            f_max=8000.0,
        )

    def copy_with(self, **kwargs) -> "MelSpecConfig":
        """Return a copy of this configuration with selected fields replaced."""
        return replace(self, **kwargs)


DB_MIN = -80.0
DB_MAX = 0.0


def mel_to_image(
    mel_db: np.ndarray,
    size: Tuple[int, int] | None = (512, 512),
) -> Image.Image:
    """Convert mel-spectrogram in dB [-80, 0] to RGB image.

    - Input shape: [n_mels, time]
    - Output image: RGB, height=n_mels, width=time. If size is provided, resize to (W,H).
    """
    if mel_db.ndim != 2:
        raise ValueError("mel_db must be 2D [n_mels, time]")
    mel_norm = (mel_db - DB_MIN) / (DB_MAX - DB_MIN)
    mel_norm = np.clip(mel_norm, 0.0, 1.0).astype(np.float32)
    # Map to [0,255] and replicate across 3 channels
    img = (mel_norm * 255.0).astype(np.uint8)
    # Convert to image with H=n_mels, W=time
    img = np.transpose(img, (1, 0))  # [time, n_mels]
    pil = Image.fromarray(img, mode="L").convert("RGB")
    if size is not None:
        pil = pil.resize(size, resample=Image.BICUBIC)
    return pil


def image_to_mel(img: Image.Image, target_shape: Tuple[int, int] = (512, 512)) -> np.ndarray:
    """Convert RGB/Grayscale image back to mel power spectrogram.

    - Returns mel_power (not dB), shape [n_mels, time].
    - If image size differs from target_shape (W,H), it is resized.
    """
    if img.mode != "L":
        img = img.convert("L")
    if img.size != (target_shape[1], target_shape[0]):
        # PIL size is (W, H); we pass (W, H) where W=time, H=n_mels
        img = img.resize((target_shape[1], target_shape[0]), resample=Image.BICUBIC)
    arr = np.asarray(img, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError("image_to_mel expects a 2D grayscale image")

    expected_mels = int(target_shape[0]) if target_shape else arr.shape[0]
    expected_time = int(target_shape[1]) if target_shape else arr.shape[1]

    if arr.shape[0] == expected_mels and arr.shape[1] == expected_time:
        mel_axes = arr
    elif arr.shape[1] == expected_mels and arr.shape[0] == expected_time:
        mel_axes = np.transpose(arr, (1, 0))
    elif arr.shape[0] == expected_mels:
        # Allow time dimension to differ when callers intentionally overspecify.
        mel_axes = arr
    elif arr.shape[1] == expected_mels:
        mel_axes = np.transpose(arr, (1, 0))
    else:
        raise ValueError(
            f"image height/width {arr.shape} do not match expected mel bins {expected_mels}"
        )

    arr = mel_axes
    mel_norm = arr / 255.0
    mel_db = mel_norm * (DB_MAX - DB_MIN) + DB_MIN
    mel_power = librosa.db_to_power(mel_db)
    return mel_power.astype(np.float32)


def project_mel_power(
    mel_power: np.ndarray,
    src: MelSpecConfig,
    dst: MelSpecConfig,
) -> np.ndarray:
    """Project a mel power spectrogram onto a new mel configuration."""

    if mel_power.ndim != 2:
        raise ValueError("mel_power must be 2D [n_mels, time]")

    src_bins = mel_power.shape[0]
    if src_bins != src.n_mels:
        src = src.copy_with(n_mels=src_bins)

    if src.sample_rate != dst.sample_rate:
        raise ValueError("Sample rates must match for mel projection")
    if src.n_fft != dst.n_fft:
        raise ValueError("FFT sizes must match for mel projection")

    if not _HAS_TORCHAUDIO:
        raise RuntimeError("torchaudio is required for mel projection")

    n_stft = src.n_fft // 2 + 1
    mel_t = torch.from_numpy(mel_power.astype(np.float32))
    inv_transform = torchaudio.transforms.InverseMelScale(
        n_stft=n_stft,
        n_mels=src.n_mels,
        sample_rate=src.sample_rate,
        f_min=src.f_min,
        f_max=src.f_max,
        max_iter=0,
    )
    linear_power = inv_transform(mel_t)

    mel_transform = torchaudio.transforms.MelScale(
        n_mels=dst.n_mels,
        sample_rate=dst.sample_rate,
        f_min=dst.f_min,
        f_max=dst.f_max,
        n_stft=n_stft,
    )
    projected = mel_transform(linear_power)
    return projected.detach().cpu().numpy().astype(np.float32)


def _mel_loss(target_mel_power: np.ndarray, recon_audio: np.ndarray, cfg: MelSpecConfig) -> float:
    S = librosa.feature.melspectrogram(
        y=recon_audio,
        sr=cfg.sample_rate,
        n_fft=cfg.n_fft,
        hop_length=cfg.hop_length,
        win_length=cfg.win_length,
        n_mels=cfg.n_mels,
        fmin=cfg.f_min,
        fmax=cfg.f_max,
        power=2.0,
        center=True,
    )
    # Compare in dB domain to de-emphasize large low-freq magnitudes
    T = librosa.power_to_db(np.maximum(target_mel_power, 1e-12), ref=1.0)
    R = librosa.power_to_db(np.maximum(S, 1e-12), ref=1.0)
    return float(np.mean((T - R) ** 2))


def mel_to_audio_griffin_lim(
    mel_power: np.ndarray,
    cfg: MelSpecConfig = MelSpecConfig(),
    n_iter: int = 128,
    restarts: int = 1,
) -> np.ndarray:
    """Invert mel power spectrogram to audio using Griffin-Lim with optional restarts.

    Returns mono float32 waveform in [-1, 1]. Chooses the best of N restarts
    by mel-spectrogram MSE in dB against the target mel.
    """
    if mel_power.ndim != 2:
        raise ValueError("mel_power must be 2D [n_mels, time]")

    best_audio = None
    best_loss = float("inf")
    for k in range(max(1, int(restarts))):
        y = librosa.feature.inverse.mel_to_audio(
            M=mel_power,
            sr=cfg.sample_rate,
            n_fft=cfg.n_fft,
            hop_length=cfg.hop_length,
            win_length=cfg.win_length,
            n_iter=n_iter,
            fmin=cfg.f_min,
            fmax=cfg.f_max,
            center=True,
            power=2.0,
            # Random init on k>0 gives diverse phase guesses
            init="random" if k > 0 else None,
        )
        y = np.asarray(y, dtype=np.float32)
        loss = _mel_loss(mel_power, y, cfg)
        if loss < best_loss or best_audio is None:
            best_loss = loss
            best_audio = y

    y = best_audio if best_audio is not None else np.zeros(1, dtype=np.float32)
    # Normalize softly to avoid clipping whilst preserving scale
    max_abs = float(np.max(np.abs(y)) or 1.0)
    if max_abs > 1.0:
        y = y / max_abs
    return y


# Backwards-compat helpers used elsewhere in this repo
def mel_image_to_audio(
    image: Image.Image,
    cfg: MelSpecConfig = MelSpecConfig(),
    griffinlim_iters: int = 64,
) -> np.ndarray:
    mel_power = image_to_mel(image, target_shape=(cfg.n_mels, image.width))
    return mel_to_audio_griffin_lim(mel_power, cfg=cfg, n_iter=griffinlim_iters)


def estimate_duration_seconds(frames: int, cfg: MelSpecConfig = MelSpecConfig()) -> float:
    return float(frames * cfg.hop_length / cfg.sample_rate)
