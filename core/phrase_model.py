from __future__ import annotations
"""Lightweight wrapper around phrase generation models.

This module attempts to load neural network models stored under the
``models/`` directory.  Models can either be provided as TorchScript
(``.ts.pt``) files or ONNX (``.onnx``) graphs.  The ``generate_phrase``
function exposes a simple token sampling loop with nucleus/top-k sampling,
temperature scaling and a repetition penalty.  Sampling is executed in a
background thread and aborted if it does not finish within a configurable
``timeout``.

The goal of this module is to provide an optional neural alternative to the
algorithmic pattern generators.  If model loading fails or sampling times out
an exception is raised so callers can fall back to the deterministic
algorithms.
"""

from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple
import threading
import time
import random

import numpy as np

# Optional dependencies.  The rest of the code guards against them being
# unavailable so the repository can be used without the heavy ML stacks
# installed.
try:  # pragma: no cover - optional import
    import torch  # type: ignore
except Exception:  # pragma: no cover - handled gracefully
    torch = None

try:  # pragma: no cover - optional import
    import onnxruntime as ort  # type: ignore
except Exception:  # pragma: no cover - handled gracefully
    ort = None


MODEL_DIR = Path(__file__).resolve().parent.parent / "models"

# Cache for loaded models to avoid repeated disk access. Access to the cache
# is guarded by a lock because models may also be loaded from a background
# thread during module import.
MODEL_CACHE: dict[str, Tuple[Optional[str], Optional[object]]] = {}
_cache_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _load_model_from_disk(inst: str) -> Tuple[Optional[str], Optional[object]]:
    """Load a model for ``inst`` from disk."""

    ts_path = MODEL_DIR / f"{inst}_phrase.ts.pt"
    if ts_path.exists() and torch is not None:
        try:  # pragma: no cover - depends on optional torch
            model = torch.jit.load(str(ts_path))
            model.eval()
            return "torchscript", model
        except Exception:
            pass

    onnx_path = MODEL_DIR / f"{inst}_phrase.onnx"
    if onnx_path.exists() and ort is not None:
        try:  # pragma: no cover - depends on optional onnxruntime
            session = ort.InferenceSession(str(onnx_path))
            return "onnx", session
        except Exception:
            pass

    return None, None


def load_model(inst: str) -> Tuple[Optional[str], Optional[object]]:
    """Attempt to load a model for ``inst`` with caching.

    The function first consults an in-memory cache.  If the model has not been
    loaded yet it is read from disk and stored in the cache.  The returned
    tuple follows the same convention as :func:`_load_model_from_disk`.
    """

    with _cache_lock:
        if inst in MODEL_CACHE:
            return MODEL_CACHE[inst]

    fmt, model = _load_model_from_disk(inst)
    with _cache_lock:
        MODEL_CACHE[inst] = (fmt, model)
    return fmt, model


def _preload_models() -> None:
    """Background task that preloads all available models.

    The function scans :data:`MODEL_DIR` for files that look like phrase models
    and loads them into :data:`MODEL_CACHE`.  Errors are ignored so the preload
    does not interfere with application startup.
    """

    insts = set()
    for p in MODEL_DIR.glob("*_phrase.ts.pt"):
        insts.add(p.name.split("_phrase.ts.pt")[0])
    for p in MODEL_DIR.glob("*_phrase.onnx"):
        insts.add(p.name.split("_phrase.onnx")[0])

    for inst in insts:
        try:
            load_model(inst)
        except Exception:
            # Best effort only – failures are logged implicitly when models are
            # requested later.
            pass


# Start background preloading of models as soon as the module is imported.
threading.Thread(target=_preload_models, daemon=True).start()


# ---------------------------------------------------------------------------
# Sampling helpers
# ---------------------------------------------------------------------------

def _apply_sampling(
    logits: np.ndarray,
    *,
    top_p: float,
    top_k: int,
    temperature: float,
    repetition_penalty: float,
    history: Sequence[int],
) -> int:
    """Sample an index from ``logits`` using various strategies."""

    if temperature <= 0:
        raise ValueError("temperature must be > 0")

    logits = logits.astype(np.float64)
    logits = logits / temperature

    if repetition_penalty != 1.0 and history:
        for tok in set(history):
            logits[tok] /= repetition_penalty

    # Top-k filtering
    if top_k > 0 and top_k < len(logits):
        kth_vals = np.partition(logits, -top_k)[-top_k]
        logits[logits < kth_vals] = -np.inf

    # Convert to probabilities for top-p
    probs = np.exp(logits - np.max(logits))
    probs = probs / probs.sum()
    if 0.0 < top_p < 1.0:
        sorted_idx = np.argsort(probs)[::-1]
        cum = np.cumsum(probs[sorted_idx])
        mask = cum <= top_p
        if not np.any(mask):
            mask[0] = True
        probs = np.where(mask[sorted_idx], probs[sorted_idx], 0)
        probs = probs / probs.sum()
        logits = np.log(probs + 1e-9)

    probs = np.exp(logits - np.max(logits))
    probs = probs / probs.sum()
    return int(np.random.choice(len(probs), p=probs))


def _run_with_timeout(func, timeout: float, *args, **kwargs):
    """Execute ``func`` in a thread, aborting after ``timeout`` seconds."""

    result: dict = {}
    exc: dict = {}

    def _target():
        try:
            result["value"] = func(*args, **kwargs)
        except Exception as e:  # pragma: no cover - passthrough errors
            exc["error"] = e

    th = threading.Thread(target=_target, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        raise TimeoutError("sampling timed out")
    if "error" in exc:
        raise exc["error"]
    return result.get("value")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_phrase(
    inst: str,
    *,
    seed: int | None = None,
    prompt: Sequence[int] | None = None,
    max_steps: int = 128,
    top_p: float = 0.9,
    top_k: int = 0,
    temperature: float = 1.0,
    repetition_penalty: float = 1.0,
    timeout: float = 1.0,
    **_: object,
) -> List[int]:
    """Generate a token sequence for ``inst``.

    The returned list contains the newly generated tokens (not including the
    ``prompt``).  Additional keyword arguments are accepted for forward
    compatibility but ignored by the current implementation.  The function
    raises an exception if the model can not be loaded or if sampling exceeds
    ``timeout`` seconds.
    """

    fmt, model = load_model(inst)
    if model is None:
        raise RuntimeError(f"no model available for {inst}")

    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)
        if torch is not None:
            try:  # pragma: no cover - depends on optional torch
                torch.manual_seed(seed)
            except Exception:
                pass

    prompt = list(prompt or [])

    def _sample_loop():  # pragma: no cover - relies on optional deps
        history = list(prompt)
        for _ in range(max_steps):
            if fmt == "torchscript":
                inp = torch.tensor([history], dtype=torch.long)
                logits = model(inp)[0, -1].detach().cpu().numpy()
            else:  # fmt == "onnx"
                inp = np.array([history], dtype=np.int64)
                input_name = model.get_inputs()[0].name
                logits = model.run(None, {input_name: inp})[0][0, -1]
            next_tok = _apply_sampling(
                logits,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                history=history,
            )
            history.append(next_tok)
        return history[len(prompt):]

    return _run_with_timeout(_sample_loop, timeout)
