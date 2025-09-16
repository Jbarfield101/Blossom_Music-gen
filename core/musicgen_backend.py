"""Wrapper around MusicGen for text-to-music generation.

This module exposes :func:`generate_music` which loads a MusicGen
model via the :mod:`transformers` pipeline.  Loaded models are cached
in memory so subsequent calls reuse the same weights.  The generated
audio is saved as a ``.wav`` file and the absolute path is returned.
"""
from __future__ import annotations

from pathlib import Path
import os
import logging
import threading
import time
from typing import Dict, Optional

try:  # pragma: no cover - optional dependency
    from scipy.io.wavfile import write as write_wav
except Exception:  # pragma: no cover - handled gracefully
    write_wav = None  # type: ignore

try:  # pragma: no cover - optional dependency
    from transformers import pipeline
except Exception:  # pragma: no cover - handled gracefully
    pipeline = None  # type: ignore

try:  # pragma: no cover - optional dependency
    import torch
except Exception:  # pragma: no cover - handled gracefully
    torch = None  # type: ignore

logger = logging.getLogger(__name__)

# Mapping from shorthand aliases exposed in the UI to the fully qualified
# HuggingFace model identifiers expected by ``transformers``.
MODEL_NAME_ALIASES: Dict[str, str] = {
    "small": "facebook/musicgen-small",
    "medium": "facebook/musicgen-medium",
    "melody": "facebook/musicgen-melody",
}

# Models that are only distributed with legacy .bin weights. Attempting to load
# them with safetensors first just produces a noisy OSError, so skip straight to
# the .bin branch for these identifiers.
BIN_ONLY_MODELS = {
    "facebook/musicgen-medium",
    "facebook/musicgen-melody",
}

# Cache for loaded MusicGen pipelines.  Access is guarded by a lock since model
# loading may be expensive and not thread safe.
_PIPELINE_CACHE: Dict[str, object] = {}
_LAST_STATUS: Dict[str, object] = {"device": "cpu", "fallback": False, "reason": None}

def get_last_status() -> Dict[str, object]:
    return dict(_LAST_STATUS)
_CACHE_LOCK = threading.Lock()


def _get_pipeline(model_name: str, device_override: Optional[int] = None):
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
            "  pip install --index-url https://download.pytorch.org/whl/cpu \"torch>=2.6\" \"torchaudio>=2.6\"\n"
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
        # Build a cache key that includes the target device (-1=CPU, 0=CUDA:0)
        cache_device_key = device_override if device_override is not None else (
            0 if (torch is not None and getattr(torch.cuda, "is_available", lambda: False)()) else -1
        )
        cache_key = f"{normalized_name}|{cache_device_key}"
        if cache_key in _PIPELINE_CACHE:
            return _PIPELINE_CACHE[cache_key]

        logger.info("Loading MusicGen model: %s", normalized_name)
        try:
            # Prefer GPU when available; otherwise fall back to CPU.
            device = -1
            torch_dtype = None
            cuda_ok = (torch is not None) and getattr(torch.cuda, "is_available", lambda: False)()
            # Allow environment override to force trying GPU
            if os.environ.get("MUSICGEN_FORCE_GPU") == "1":
                cuda_ok = True
            if device_override is not None:
                cuda_ok = (device_override == 0)
            if cuda_ok:
                device = 0  # first CUDA device
                # Default to full precision on CUDA to avoid Windows fp16 indexing issues.
                # Opt-in to fp16 with env MUSICGEN_FP16=1
                use_fp16 = os.environ.get("MUSICGEN_FP16") == "1"
                torch_dtype = getattr(torch, "float16", None) if use_fp16 else getattr(torch, "float32", None)
                logger.info(
                    "Using device: cuda:0 for MusicGen (%s)",
                    "fp16" if use_fp16 else "fp32",
                )
            else:
                logger.info("Using device: cpu for MusicGen")

            # Respect offline env if set; avoids network calls when sandboxed.
            offline = (
                os.environ.get("HF_HUB_OFFLINE") == "1"
                or os.environ.get("TRANSFORMERS_OFFLINE") == "1"
            )

            def _build_pipe(use_safetensors: bool):
                base_kwargs = {
                    "model": normalized_name,
                    "device": device,
                    "trust_remote_code": True,
                    "use_safetensors": use_safetensors,
                    "model_kwargs": {
                        "use_safetensors": use_safetensors,
                        # Avoid FlashAttention-related CUDA issues on some builds
                        "attn_implementation": "eager",
                        **({"local_files_only": True} if offline else {}),
                    },
                }
                # Try dtype under different parameter names across versions
                if torch_dtype is not None and device == 0:
                    try:
                        return pipeline(
                            "text-to-audio",
                            dtype=torch_dtype,
                            **base_kwargs,
                        )
                    except TypeError:
                        # Older transformers expect torch_dtype at top-level
                        return pipeline(
                            "text-to-audio",
                            torch_dtype=torch_dtype,
                            **base_kwargs,
                        )
                else:
                    return pipeline("text-to-audio", **base_kwargs)

            if normalized_name in BIN_ONLY_MODELS:
                pipe = _build_pipe(use_safetensors=False)
            else:
                # 1) Try safetensors first; on any failure, attempt a .bin fallback
                try:
                    pipe = _build_pipe(use_safetensors=True)
                except Exception as e1:  # pragma: no cover - hub dependent
                    logger.info(
                        "MusicGen load with safetensors failed (%s); retrying with .bin weights",
                        type(e1).__name__,
                    )
                    try:
                        pipe = _build_pipe(use_safetensors=False)
                    except Exception as e2:
                        # Surface both errors for clearer diagnosis
                        raise RuntimeError(
                            f"MusicGen load failed. Safetensors error: {e1}\nBin weights error: {e2}"
                        )
            # Patch ambiguous text config in newer Transformers MusicGen variants
            try:
                model = getattr(pipe, "model", None)
                cfg = getattr(model, "config", None)
                if cfg is not None and hasattr(cfg, "get_text_config"):
                    # Prefer decoder sub-config for generation; fallback to text_encoder
                    dec = getattr(cfg, "decoder", None)
                    te = getattr(cfg, "text_encoder", None)
                    chosen = dec or te
                    if chosen is not None:
                        setattr(cfg, "text_config", chosen)
                        logger.debug(
                            "Set MusicGen config.text_config = %s",
                            "decoder" if dec is not None else "text_encoder",
                        )
            except Exception:
                # Non-fatal; generation may still succeed
                pass
        except Exception as exc:  # pragma: no cover - depends on HF hub
            logger.exception("Failed to load MusicGen model %s: %s", normalized_name, exc)
            raise
        _PIPELINE_CACHE[cache_key] = pipe
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

    approx_tokens = max(1, int(duration * 50))
    model_limit = approx_tokens
    limit_enforced = False
    try:
        model = getattr(pipe, "model", None)
        config = getattr(model, "config", None)
        if config is not None:
            limit_value = getattr(config, "max_position_embeddings", None)
            if limit_value is None:
                limit_value = getattr(config, "max_length", None)
            if limit_value is not None:
                try:
                    limit_value = int(limit_value)
                except (TypeError, ValueError):
                    limit_value = None
            if limit_value is not None and limit_value > 0:
                model_limit = limit_value
                limit_enforced = True
    except Exception:  # pragma: no cover - defensive; logging for diagnostics
        logger.debug("Unable to determine MusicGen model token limit", exc_info=True)

    # ``max_new_tokens`` is roughly 50 tokens per second for MusicGen models,
    # but the model configuration may cap the allowable sequence length.
    max_new_tokens = min(approx_tokens, model_limit)
    if limit_enforced and max_new_tokens < approx_tokens:
        logger.warning(
            "Requested duration %.2fs requires %s tokens but model limit is %s; truncating.",
            duration,
            approx_tokens,
            model_limit,
        )

    logger.info(
        "Generating %ss of audio with %s (temperature=%.2f)",
        duration,
        model_name,
        temperature,
    )

    # Track device/fallback status for the last call
    initial_device = "gpu" if (torch is not None and getattr(torch.cuda, "is_available", lambda: False)()) else "cpu"
    _LAST_STATUS.update({"device": initial_device, "fallback": False, "reason": None})

    def _gen_once(p, t):
        try:
            logger.debug("Calling MusicGen pipeline (tokens=%s) with generate_kwargs", t)
            return p(
                prompt,
                generate_kwargs={
                    "max_new_tokens": t,
                    "do_sample": True,
                    "temperature": temperature,
                },
            )
        except TypeError:
            try:
                logger.info("Pipeline rejected generate_kwargs; retrying with direct max_new_tokens (tokens=%s)", t)
                return p(
                    prompt,
                    max_new_tokens=t,
                    do_sample=True,
                    temperature=temperature,
                )
            except TypeError:
                logger.info("Pipeline rejected max_new_tokens; retrying with max_length (tokens=%s)", t)
                return p(
                    prompt,
                    max_length=t,
                    do_sample=True,
                    temperature=temperature,
                )

    def _is_memory_error(exc: Exception) -> bool:
        msg = str(exc)
        keywords = (
            "out of memory",
            "CUDA out of memory",
            "DefaultCPUAllocator: not enough memory",
            "CUBLAS",
            "OOM",
            "illegal memory access",
            "no kernel image is available",
            "FlashAttention",
            "Expected all tensors to be on the same device",
        )
        return any(k.lower() in msg.lower() for k in keywords)

    def _generate_with_backoff(p, t0):
        t = max(1, int(t0))
        last_exc = None
        for _ in range(4):
            try:
                return _gen_once(p, t)
            except Exception as exc:  # pragma: no cover - depends on runtime
                if _is_memory_error(exc) and t > 120:
                    logger.warning("Generation failed with memory error at %s tokens; retrying with fewer tokens", t)
                    last_exc = exc
                    t = max(100, int(t * 0.6))
                    continue
                raise
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Generation failed after retries")

    try:
        result = _generate_with_backoff(pipe, max_new_tokens)

        if isinstance(result, list):
            audio = result[0]["audio"]
            sample_rate = result[0]["sampling_rate"]
        elif isinstance(result, dict):
            audio = result["audio"]
            sample_rate = result["sampling_rate"]
        else:
            raise TypeError(
                "Unexpected result type from MusicGen pipeline: " f"{type(result).__name__}"
            )
    except Exception as exc:  # pragma: no cover - depends on HF pipeline
        # GPU-specific failures: retry on CPU once
        msg = str(exc)
        if (
            "Indexing.cu" in msg
            or "CUDA out of memory" in msg
            or "CUBLAS" in msg
            or "device-side assert" in msg
            or "illegal memory access" in msg
            or "no kernel image is available" in msg
            or "FlashAttention" in msg
        ):
            logger.warning("GPU generation failed; retrying on CPU: %s", msg)
            _LAST_STATUS.update({"device": "cpu", "fallback": True, "reason": msg})
            pipe_cpu = _get_pipeline(model_name, device_override=-1)
            try:
                result = _generate_with_backoff(pipe_cpu, max_new_tokens)
                if isinstance(result, list):
                    audio = result[0]["audio"]
                    sample_rate = result[0]["sampling_rate"]
                elif isinstance(result, dict):
                    audio = result["audio"]
                    sample_rate = result["sampling_rate"]
                else:
                    raise TypeError(
                        "Unexpected result type from MusicGen pipeline: " f"{type(result).__name__}"
                    )
            except Exception:
                logger.exception("CPU retry failed as well")
                raise
        else:
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
