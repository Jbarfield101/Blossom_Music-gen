"""Wrapper around MusicGen for text-to-music generation.

This module exposes :func:`generate_music` which loads a MusicGen
model via the :mod:`transformers` pipeline.  Loaded models are cached
in memory so subsequent calls reuse the same weights.  The generated
audio is saved as a ``.wav`` file and the absolute path is returned.
"""
from __future__ import annotations

from pathlib import Path
import logging
import threading
import time
from typing import Dict

try:  # pragma: no cover - optional dependency
    from scipy.io.wavfile import write as write_wav
except Exception:  # pragma: no cover - handled gracefully
    write_wav = None  # type: ignore

try:  # pragma: no cover - optional dependency
    from transformers import pipeline
except Exception:  # pragma: no cover - handled gracefully
    pipeline = None  # type: ignore

logger = logging.getLogger(__name__)

# Cache for loaded MusicGen pipelines.  Access is guarded by a lock since model
# loading may be expensive and not thread safe.
_PIPELINE_CACHE: Dict[str, object] = {}
_CACHE_LOCK = threading.Lock()


def _get_pipeline(model_name: str):
    """Return a cached ``transformers`` pipeline for ``model_name``."""
    if pipeline is None:  # pragma: no cover - dependency missing
        raise RuntimeError("transformers is not installed")

    with _CACHE_LOCK:
        if model_name in _PIPELINE_CACHE:
            return _PIPELINE_CACHE[model_name]

        logger.info("Loading MusicGen model: %s", model_name)
        try:
            pipe = pipeline("text-to-audio", model=model_name)
        except Exception as exc:  # pragma: no cover - depends on HF hub
            logger.exception("Failed to load MusicGen model %s: %s", model_name, exc)
            raise
        _PIPELINE_CACHE[model_name] = pipe
        return pipe


def generate_music(
    prompt: str,
    duration: float,
    model_name: str,
    temperature: float,
    output_dir: str,
) -> str:
    """Generate audio from ``prompt`` using a MusicGen model.

    Parameters
    ----------
    prompt:
        Text description to condition the generation on.
    duration:
        Approximate length of the generated clip in seconds.
    model_name:
        HuggingFace model identifier, e.g. ``"facebook/musicgen-small"``.
    temperature:
        Sampling temperature passed to the model.
    output_dir:
        Base directory where the resulting ``.wav`` file will be written.  The
        audio is saved under ``<output_dir>/musicgen/``.

    Returns
    -------
    str
        Absolute path to the written ``.wav`` file.
    """

    try:
        pipe = _get_pipeline(model_name)
    except Exception:
        raise

    if write_wav is None:  # pragma: no cover - dependency missing
        raise RuntimeError("scipy is required for writing wav files")

    # ``max_new_tokens`` is roughly 50 tokens per second for MusicGen models.
    max_new_tokens = max(1, int(duration * 50))

    logger.info(
        "Generating %ss of audio with %s (temperature=%.2f)",
        duration,
        model_name,
        temperature,
    )

    try:
        result = pipe(
            prompt,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=temperature,
        )
        audio = result[0]["audio"]
        sample_rate = result[0]["sampling_rate"]
    except Exception as exc:  # pragma: no cover - depends on HF pipeline
        logger.exception("Music generation failed: %s", exc)
        raise

    out_dir = Path(output_dir) / "musicgen"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"musicgen_{int(time.time())}.wav"

    try:
        write_wav(out_path, sample_rate, audio)
    except Exception as exc:  # pragma: no cover - file system issues
        logger.exception("Failed to write %s: %s", out_path, exc)
        raise

    logger.info("Saved generated audio to %s", out_path.resolve())
    return str(out_path.resolve())
