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
import types
from typing import Dict, Optional

try:  # pragma: no cover - optional dependency
    from scipy.io.wavfile import write as write_wav, read as read_wav
except Exception:  # pragma: no cover - handled gracefully
    write_wav = None  # type: ignore
    read_wav = None  # type: ignore

try:  # pragma: no cover - optional dependency
    from transformers import pipeline, AutoProcessor
except Exception:  # pragma: no cover - handled gracefully
    pipeline = None  # type: ignore
    AutoProcessor = None  # type: ignore

try:  # pragma: no cover - optional dependency
    import torch
except Exception:  # pragma: no cover - handled gracefully
    torch = None  # type: ignore

try:  # pragma: no cover - optional dependency
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover - handled gracefully
    np = None  # type: ignore

logger = logging.getLogger(__name__)

class _MelodyProcessorWrapper:
    """Ensures melody processors receive text/audio via keywords."""
    __slots__ = ("_processor",)

    def __init__(self, processor):
        self._processor = processor

    def __call__(self, text=None, **kwargs):
        if text is not None and "text" not in kwargs:
            kwargs["text"] = text
        return self._processor(**kwargs)

    def decode(self, audio, *args, **kwargs):
        return audio

    def __getattr__(self, name):
        return getattr(self._processor, name)


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
}

# Cache for loaded MusicGen pipelines.  Access is guarded by a lock since model
# loading may be expensive and not thread safe.
_PIPELINE_CACHE: Dict[str, object] = {}
_PROCESSOR_CACHE: Dict[str, object] = {}
_LAST_STATUS: Dict[str, object] = {"device": "cpu", "fallback": False, "reason": None}

def get_last_status() -> Dict[str, object]:
    return dict(_LAST_STATUS)
_CACHE_LOCK = threading.Lock()

_PYTORCH_UPGRADE_GUIDANCE = (
    "To enable MusicGen, install:\n"
    "  pip install --upgrade transformers accelerate\n"
    "And install PyTorch (CPU-only example):\n"
    "  pip install --index-url https://download.pytorch.org/whl/cpu \"torch>=2.5\" \"torchaudio>=2.5\"\n"
    "Also ensure scipy is installed for writing WAV files."
)


def _patch_musicgen_config(cfg) -> None:
    if cfg is None:
        return
    try:
        decoder_cfg = getattr(cfg, "decoder", None)
        text_encoder_cfg = getattr(cfg, "text_encoder", None)
        chosen_cfg = decoder_cfg or text_encoder_cfg or getattr(cfg, "text_config", None)
        if chosen_cfg is None:
            return
        setattr(cfg, "text_config", chosen_cfg)

        original = getattr(cfg, "get_text_config", None)

        def _patched_get_text_config(self, decoder: bool = False, **_):
            if decoder:
                return decoder_cfg or chosen_cfg
            return chosen_cfg

        if callable(original):
            setattr(cfg, "get_text_config", types.MethodType(_patched_get_text_config, cfg))
    except Exception:
        logger.debug("Unable to patch MusicGen config", exc_info=True)


def _attach_melody_processor(pipe, processor) -> None:
    if pipe is None or processor is None:
        return
    existing = getattr(pipe, "processor", None)
    if isinstance(existing, _MelodyProcessorWrapper) and getattr(existing, "_processor", None) is processor:
        pass
    else:
        wrapper = _MelodyProcessorWrapper(processor)
        setattr(pipe, "processor", wrapper)
    setattr(pipe, "no_processor", False)
    if hasattr(processor, "tokenizer") and processor.tokenizer is not None:
        setattr(pipe, "tokenizer", processor.tokenizer)
    if hasattr(processor, "feature_extractor") and processor.feature_extractor is not None:
        setattr(pipe, "feature_extractor", processor.feature_extractor)
    model = getattr(pipe, "model", None)
    cfg = getattr(model, "config", None)
    _patch_musicgen_config(cfg)


def _assert_supported_torch_version() -> None:
    if torch is None:  # pragma: no cover - dependency missing
        return

    version = getattr(torch, "__version__", None)
    if not isinstance(version, str):
        return

    base_version = version.split("+", 1)[0]
    parts = base_version.split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return

    if (major, minor) < (2, 5):
        raise RuntimeError(
            "Unsupported PyTorch version detected: "
            f"{version}. MusicGen requires torch>=2.5.\n"
            + _PYTORCH_UPGRADE_GUIDANCE
        )


def _get_pipeline(model_name: str, device_override: Optional[int] = None):
    """Return a cached ``transformers`` pipeline for ``model_name``.

    Raises a helpful error if the optional ``transformers`` dependency is not
    available, including guidance on how to install the needed packages.
    """
    if pipeline is None:  # pragma: no cover - dependency missing
        raise RuntimeError(
            "Missing dependency: transformers.\n" + _PYTORCH_UPGRADE_GUIDANCE
        )

    _assert_supported_torch_version()

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
            cached_pipe = _PIPELINE_CACHE[cache_key]
            if normalized_name == "facebook/musicgen-melody":
                processor = _PROCESSOR_CACHE.get(normalized_name)
                if processor is None and AutoProcessor is not None:
                    processor_kwargs = {"trust_remote_code": True}
                    if os.environ.get("HF_HUB_OFFLINE") == "1" or os.environ.get("TRANSFORMERS_OFFLINE") == "1":
                        processor_kwargs["local_files_only"] = True
                    processor = AutoProcessor.from_pretrained(normalized_name, **processor_kwargs)
                    _PROCESSOR_CACHE[normalized_name] = processor
                if processor is not None:
                    _attach_melody_processor(cached_pipe, processor)
            return cached_pipe

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

            def _build_pipe(
                use_safetensors: bool = True,
                model_id: Optional[str] = None,
                processor_obj=None,
            ):
                model_kwargs = {
                    # The pipeline now expects safetensor preferences within model_kwargs.
                    "use_safetensors": use_safetensors,
                    # Avoid FlashAttention-related CUDA issues on some builds
                    "attn_implementation": "eager",
                }
                if offline:
                    model_kwargs["local_files_only"] = True
                if torch_dtype is not None and device == 0:
                    # transformers >= 4.44 prefers the 'dtype' kwarg
                    model_kwargs["dtype"] = torch_dtype

                pipeline_kwargs = {
                    "model": model_id or normalized_name,
                    "device": device,
                    "trust_remote_code": True,
                    "model_kwargs": model_kwargs,
                }
                if processor_obj is not None:
                    pipeline_kwargs["processor"] = processor_obj
                return pipeline("text-to-audio", **pipeline_kwargs)

            def _should_retry_without_safetensors(exc: Exception) -> bool:
                text = f"{exc.__class__.__name__}: {exc}".lower()
                return "safetensor" in text

            pipe = None
            candidate_ids = [normalized_name]
            if normalized_name == "facebook/musicgen-melody":
                override = os.environ.get("MUSICGEN_MELODY_ID")
                if override and override != normalized_name:
                    logger.info("Using MUSICGEN_MELODY_ID override: %s", override)
                    candidate_ids.insert(0, override)

            last_exc: Optional[Exception] = None
            for candidate in candidate_ids:
                safetensors_allowed = candidate not in BIN_ONLY_MODELS
                try:
                    processor_obj = None
                    if "musicgen-melody" in candidate:
                        if AutoProcessor is None:
                            raise RuntimeError(
                                "MusicGen melody conditioning requires transformers.AutoProcessor. "
                                "Upgrade the transformers package to a version that provides AutoProcessor."
                            )
                        processor_obj = _PROCESSOR_CACHE.get(candidate)
                        if processor_obj is None:
                            processor_kwargs = {"trust_remote_code": True}
                            if offline:
                                processor_kwargs["local_files_only"] = True
                            logger.info("Loading MusicGen melody processor: %s", candidate)
                            processor_obj = AutoProcessor.from_pretrained(candidate, **processor_kwargs)
                            _PROCESSOR_CACHE[candidate] = processor_obj
                            if candidate != normalized_name:
                                _PROCESSOR_CACHE[normalized_name] = processor_obj
                    if safetensors_allowed:
                        try:
                            pipe = _build_pipe(True, model_id=candidate, processor_obj=processor_obj)
                        except Exception as exc:
                            last_exc = exc
                            if _should_retry_without_safetensors(exc):
                                logger.warning(
                                    "Safetensor weights unavailable for %s; retrying with legacy format.",
                                    candidate,
                                )
                            else:
                                raise
                    if pipe is None:
                        pipe = _build_pipe(False, model_id=candidate, processor_obj=processor_obj)
                    if processor_obj is not None and pipe is not None:
                        _attach_melody_processor(pipe, processor_obj)
                    # Success
                    if candidate != normalized_name:
                        logger.info(
                            "Loaded MusicGen pipeline using override identifier %s",
                            candidate,
                        )
                    break
                except Exception as exc:
                    last_exc = exc
                    pipe = None
                    logger.debug("Candidate model %s failed: %s", candidate, exc)
                    continue
            if pipe is None:
                if normalized_name == "facebook/musicgen-melody":
                    guidance = (
                        "Failed to load the MusicGen melody checkpoint 'facebook/musicgen-melody'. "
                        "Ensure the weights are available locally, for example via "
                        "`huggingface-cli download facebook/musicgen-melody --local-dir \"<cache-dir>\"`."
                    )
                    if last_exc is not None:
                        raise RuntimeError(
                            f"{guidance}\nOriginal error: {last_exc}"
                        ) from last_exc
                    raise RuntimeError(guidance)
                if last_exc is not None:
                    raise last_exc
                raise RuntimeError(
                    f"Failed to initialize MusicGen pipeline for {normalized_name}"
                )
            # Patch ambiguous text config in newer Transformers MusicGen variants
            try:
                model = getattr(pipe, "model", None)
                cfg = getattr(model, "config", None)
                _patch_musicgen_config(cfg)
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
    melody_path: Optional[str] = None,
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
    melody_path:
        Optional path to a melody reference clip. Required when using the
        ``facebook/musicgen-melody`` model.

    Returns
    -------
    str
        Absolute path to the written ``.wav`` file.
    """

    normalized_model = MODEL_NAME_ALIASES.get(model_name, model_name)
    melody_reference = melody_path if isinstance(melody_path, str) and melody_path.strip() else None

    if normalized_model == "facebook/musicgen-melody" and melody_reference is None:
        raise ValueError(
            "The MusicGen melody model requires a reference audio clip. "
            "Provide melody_path when using facebook/musicgen-melody."
        )

    if normalized_model != "facebook/musicgen-melody" and melody_reference is not None:
        logger.warning(
            "Melody reference provided but %s does not support conditioning; ignoring clip.",
            normalized_model,
        )
        melody_reference = None

    # Provide user-visible progress cues via stdout for the Tauri log panel.
    try:
        try:
            print(f"loading-model: {normalized_model}")
        except Exception:
            pass
        pipe = _get_pipeline(model_name)
    except Exception:
        raise

    if write_wav is None:  # pragma: no cover - dependency missing
        raise RuntimeError(
            "Missing dependency: scipy is required for writing .wav files.\n"
            "Install with: pip install --upgrade scipy"
        )

    melody_audio = None
    melody_sample_rate: Optional[int] = None
    if melody_reference is not None and normalized_model == "facebook/musicgen-melody":
        if read_wav is None:
            raise RuntimeError(
                "Melody conditioning requires scipy.io.wavfile.read. "
                "Install scipy to enable the melody model."
            )
        if np is None:
            raise RuntimeError(
                "Melody conditioning requires numpy. Install numpy to enable the melody model."
            )

        melody_file = Path(melody_reference).expanduser()
        if not melody_file.exists():
            raise RuntimeError(f"Melody reference not found: {melody_file}")

        try:
            sample_rate, waveform = read_wav(str(melody_file))
        except Exception as exc:  # pragma: no cover - file format dependent
            raise RuntimeError(
                f"Failed to load melody reference '{melody_file}': {exc}"
            ) from exc

        if not isinstance(sample_rate, (int, float)) or sample_rate <= 0:
            raise RuntimeError(
                f"Melody reference '{melody_file}' reported an invalid sampling rate: {sample_rate}"
            )

        if np is None:  # pragma: no cover - defensive guard
            raise RuntimeError(
                "Melody conditioning requires numpy to process the reference clip."
            )

        array = np.asarray(waveform)
        if array.size == 0:
            raise RuntimeError(f"Melody reference '{melody_file}' is empty.")

        if np.issubdtype(array.dtype, np.integer):
            if array.dtype == np.uint8:
                array = array.astype(np.float32)
                array = (array - 128.0) / 128.0
            else:
                info = np.iinfo(array.dtype)
                max_abs = float(max(abs(info.min), info.max))
                if max_abs <= 0:
                    raise RuntimeError(
                        f"Melody reference '{melody_file}' uses unsupported integer dtype {array.dtype}."
                    )
                array = array.astype(np.float32)
                array /= max_abs
        else:
            array = array.astype(np.float32, copy=False)

        if np.max(np.abs(array)) > 1.0:
            array = np.clip(array, -1.0, 1.0)

        max_samples = int(float(sample_rate) * 30.0)
        if max_samples > 0 and array.shape[0] > max_samples:
            array = array[:max_samples]

        array = np.ascontiguousarray(array)
        melody_audio = array
        melody_sample_rate = int(float(sample_rate))

        logger.info(
            "Loaded melody conditioning clip %s (sr=%s, duration=%.2fs)",
            melody_file,
            melody_sample_rate,
            array.shape[0] / melody_sample_rate if melody_sample_rate else 0.0,
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

    preprocess_params = {}
    if melody_audio is not None and melody_sample_rate is not None:
        preprocess_params = {
            "audio": melody_audio,
            "sampling_rate": melody_sample_rate,
        }

    def _gen_once(p, t):
        logger.debug("Calling MusicGen pipeline (tokens=%s) with generate_kwargs", t)
        call_kwargs = {
            "forward_params": {},
            "generate_kwargs": {
                "max_new_tokens": t,
                "do_sample": True,
                "temperature": temperature,
            },
        }
        if preprocess_params:
            call_kwargs["preprocess_params"] = dict(preprocess_params)
        return p(prompt, **call_kwargs)

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

    def _extract_audio_and_rate(obj):
        # Normalize pipeline outputs:
        # - legacy list[dict]
        # - dict
        # - object attributes (e.g., AudioPipelineOutput)
        if isinstance(obj, list):
            item = obj[0]
            return item["audio"], item["sampling_rate"]
        if isinstance(obj, dict):
            return obj["audio"], obj["sampling_rate"]
        if hasattr(obj, "audio") and hasattr(obj, "sampling_rate"):
            return getattr(obj, "audio"), getattr(obj, "sampling_rate")
        raise TypeError(
            "Unexpected result type from MusicGen pipeline: " f"{type(obj).__name__}"
        )

    try:
        try:
            print(f"generating: duration={duration:.0f}s temperature={temperature:.2f}")
        except Exception:
            pass
        result = _generate_with_backoff(pipe, max_new_tokens)
        audio, sample_rate = _extract_audio_and_rate(result)
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
                audio, sample_rate = _extract_audio_and_rate(result)
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
        try:
            print(f"saving: {out_path}")
        except Exception:
            pass
        write_wav(out_path, sample_rate, audio)
    except Exception as exc:  # pragma: no cover - file system issues
        logger.exception("Failed to write %s: %s", out_path, exc)
        raise

    logger.info("Saved generated audio to %s", out_path.resolve())
    try:
        print(f"complete: {out_path}")
    except Exception:
        pass
    return str(out_path.resolve())
