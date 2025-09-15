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

# Mapping from shorthand aliases exposed in the UI to the fully qualified
# HuggingFace model identifiers expected by ``transformers``.
MODEL_NAME_ALIASES: Dict[str, str] = {
    "small": "facebook/musicgen-small",
    "medium": "facebook/musicgen-medium",
    "melody": "facebook/musicgen-melody",
}

# Cache for loaded MusicGen pipelines.  Access is guarded by a lock since model
# loading may be expensive and not thread safe.
_PIPELINE_CACHE: Dict[str, object] = {}
_CACHE_LOCK = threading.Lock()


def _get_pipeline(model_name: str):
    """Return a cached ``transformers`` pipeline for ``model_name``.

    Raises a helpful error if the optional ``transformers`` dependency is not
    available, including guidance on how to install the needed packages.
    """
    if pipeline is None:  # pragma: no cover - dependency missing
        raise RuntimeError(
            "Missing dependency: transformers.\n"
            "To enable MusicGen, install:\n"
            "  pip install --upgrade transformers accelerate\n"
            "And install PyTorch (CPU-only example):\n"
            "  pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio\n"
            "Also ensure scipy is installed for writing WAV files."
        )

    normalized_name = MODEL_NAME_ALIASES.get(model_name, model_name)

    if normalized_name not in MODEL_NAME_ALIASES.values():
        valid_options = ", ".join(MODEL_NAME_ALIASES)
        raise ValueError(
            f"Unsupported MusicGen model '{model_name}'. "
            f"Please choose one of: {valid_options}, or provide a valid Hugging Face identifier."
        )

    with _CACHE_LOCK:
        if normalized_name in _PIPELINE_CACHE:
            return _PIPELINE_CACHE[normalized_name]

        logger.info("Loading MusicGen model: %s", normalized_name)
        try:
            pipe = pipeline("text-to-audio", model=normalized_name)
        except Exception as exc:  # pragma: no cover - depends on HF hub
            logger.exception("Failed to load MusicGen model %s: %s", normalized_name, exc)
            raise
        _PIPELINE_CACHE[normalized_name] = pipe
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
        raise RuntimeError(
            "Missing dependency: scipy is required for writing .wav files.\n"
            "Install with: pip install --upgrade scipy"
        )

    # ``max_new_tokens`` is roughly 50 tokens per second for MusicGen models.
    max_new_tokens = max(1, int(duration * 50))

    logger.info(
        "Generating %ss of audio with %s (temperature=%.2f)",
        duration,
        model_name,
        temperature,
    )

    try:
        try:
            logger.debug("Calling MusicGen pipeline with max_new_tokens")
            result = pipe(
                prompt,
                max_new_tokens=max_new_tokens,
                do_sample=True,
                temperature=temperature,
            )
        except TypeError:
            logger.info(
                "MusicGen pipeline rejected max_new_tokens; retrying with max_length"
            )
            result = pipe(
                prompt,
                max_length=max_new_tokens,
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
