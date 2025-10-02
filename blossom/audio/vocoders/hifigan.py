from __future__ import annotations

from typing import Optional, Tuple

import numpy as np
import torch
import librosa

_HIFI = None
_SETUP = None
_DENOISER = None


def load_hifigan(device: str = "cuda"):
    """Load NVIDIA HiFi-GAN via PyTorch Hub and cache singletons.

    Returns a tuple (hifigan, setup, denoiser) already moved to the
    requested device and set to eval() mode. The `setup` is a dictionary
    that includes fields such as `n_mel_channels` expected by the model.
    """
    global _HIFI, _SETUP, _DENOISER
    if _HIFI is None:
        _HIFI, _SETUP, _DENOISER = torch.hub.load(
            'NVIDIA/DeepLearningExamples:torchhub', 'nvidia_hifigan'
        )
        _HIFI = _HIFI.to(device).eval()
        _DENOISER = _DENOISER.to(device).eval()
        # Ensure setup dict has n_mel_channels populated (commonly 80)
        try:
            if _SETUP.get('n_mel_channels') in (None, 0):
                guess = getattr(_HIFI, 'n_mel_channels', None)
                if guess is None:
                    # Fallback default for many public checkpoints
                    guess = 80
                _SETUP['n_mel_channels'] = int(guess)
        except Exception:
            pass
    return _HIFI, _SETUP, _DENOISER


def synth_hifigan(
    mel: np.ndarray,
    device: Optional[str] = None,
    denoise: float = 0.0,
) -> np.ndarray:
    """Synthesize waveform from a log-mel spectrogram using NVIDIA HiFi-GAN.

    - `mel`: numpy array shaped [n_mels, T] or [1, n_mels, T] with values
      in log-amplitude (matching the hub model's expectations). The number
      of mel channels must match `setup['n_mel_channels']` returned by
      `load_hifigan` (typically 80).
    - `denoise`: optional strength passed to the hub denoiser (0.0 disables).

    Returns mono float32 waveform in [-1, 1].
    """
    hifi, setup, denoiser = load_hifigan(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    nmel = int(setup.get('n_mel_channels', getattr(hifi, 'n_mel_channels', 80)))

    if mel.ndim == 2:
        mel_t = torch.from_numpy(mel.astype(np.float32)).unsqueeze(0)  # [1, n_mels, T]
    elif mel.ndim == 3:
        mel_t = torch.from_numpy(mel.astype(np.float32))
    else:
        raise ValueError('mel must have shape [n_mels, T] or [1, n_mels, T]')
    if mel_t.shape[1] != nmel:
        raise ValueError(f'Expected {nmel} mel channels, got {mel_t.shape[1]}')

    mel_t = mel_t.to(next(hifi.parameters()).device)
    with torch.no_grad():
        audio = hifi(mel_t).squeeze().cpu().numpy().astype(np.float32)
    if denoise and hasattr(denoiser, '__call__'):
        try:
            with torch.no_grad():
                a_t = torch.from_numpy(audio).unsqueeze(0).to(next(hifi.parameters()).device)
                a_t = denoiser(a_t, denoise).cpu().squeeze().numpy().astype(np.float32)
                audio = a_t
        except Exception:
            pass
    # Soft peak normalize
    peak = float(np.max(np.abs(audio)) or 0.0)
    if peak > 1.0:
        audio = (audio / peak).astype(np.float32)
    return np.clip(audio, -1.0, 1.0)


def _prepare_mel_for_hifigan(
    mel_power_512: np.ndarray,
    sr_src: int = 22050,
    fmin_src: float = 0.0,
    fmax_src: float = 10000.0,
    n_mels_src: int = 512,
    n_mels_tgt: int = 80,
    fmin_tgt: float = 0.0,
    fmax_tgt: float = 8000.0,
) -> np.ndarray:
    """Remap 512-bin mel power to target 80-bin log-mel via mel-axis interpolation.

    - Input shape: [512, T] power mel
    - Output shape: [n_mels_tgt, T] log mel (float32), NaN-free
    """
    if mel_power_512.ndim != 2:
        raise ValueError("mel_power_512 must be 2D [n_mels, T]")
    if mel_power_512.shape[0] != n_mels_src:
        raise ValueError(f"expected {n_mels_src} mel bins, got {mel_power_512.shape[0]}")

    eps = 1e-8
    logmel_src = np.log(np.maximum(mel_power_512, eps)).astype(np.float32)  # [512, T]

    # Build corresponding mel-frequency grids
    f_src = librosa.mel_frequencies(n_mels=n_mels_src, fmin=fmin_src, fmax=fmax_src)
    f_tgt = librosa.mel_frequencies(n_mels=n_mels_tgt, fmin=fmin_tgt, fmax=fmax_tgt)

    T = logmel_src.shape[1]
    logmel_tgt = np.empty((n_mels_tgt, T), dtype=np.float32)
    for t in range(T):
        # 1D interpolate along the mel axis for each time frame
        logmel_tgt[:, t] = np.interp(f_tgt, f_src, logmel_src[:, t])

    # Ensure no NaNs
    logmel_tgt = np.nan_to_num(logmel_tgt, nan=0.0, neginf=-20.0, posinf=20.0).astype(np.float32)
    return logmel_tgt


def mel_to_audio_hifigan(
    mel_power_512: np.ndarray,
    vsetup: dict,
    hifigan,
    denoiser=None,
    device: str = "cuda",
) -> np.ndarray:
    """Convert 512-bin power mel to waveform using NVIDIA HiFi-GAN.

    - mel_power_512: numpy array [512, T] power mel
    - vsetup: dict from hub (expects keys like 'n_mel_channels', 'mel_fmin', 'mel_fmax')
    - hifigan: generator module returned by load_hifigan
    - denoiser: optional denoiser module (set to None to skip)
    - device: 'cuda'|'cpu'|'mps'
    """
    nmel = int(vsetup.get('n_mel_channels', 80))
    fmin_tgt = float(vsetup.get('mel_fmin', 0.0))
    fmax_tgt = float(vsetup.get('mel_fmax', 8000.0))

    mel_log80 = _prepare_mel_for_hifigan(
        mel_power_512,
        n_mels_tgt=nmel,
        fmin_tgt=fmin_tgt,
        fmax_tgt=fmax_tgt,
    )

    mel = torch.from_numpy(mel_log80).unsqueeze(0).to(torch.float32)
    mel = mel.to(device)
    with torch.no_grad():
        wav_t = hifigan(mel)
        # Expect shape [B, 1, T] or [B, T]
        if wav_t.dim() == 3:
            wav_b = wav_t[:, 0, :]
        elif wav_t.dim() == 2:
            wav_b = wav_t
        else:
            wav_b = wav_t.view(1, -1)

        if denoiser is not None:
            try:
                wav_b = denoiser(wav_b, 0.005)
            except Exception:
                pass

        wav = wav_b.squeeze(0).detach().cpu().numpy().astype(np.float32)

    # Final sanity: finite + soft clip
    if not np.isfinite(wav).all():
        wav = np.nan_to_num(wav, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)
    peak = float(np.max(np.abs(wav)) or 0.0)
    if peak > 1.0:
        wav = (wav / peak).astype(np.float32)
    return np.clip(wav, -1.0, 1.0)
