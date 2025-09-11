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
import logging

import numpy as np

from .sampling import sample

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
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _load_model_from_disk(inst: str, *, verbose: bool = False) -> Tuple[Optional[str], Optional[object]]:
    """Load a model for ``inst`` from disk."""

    ts_path = MODEL_DIR / f"{inst}_phrase.ts.pt"
    if ts_path.exists() and torch is not None:
        try:  # pragma: no cover - depends on optional torch
            model = torch.jit.load(str(ts_path))
            model.eval()
            return "torchscript", model
        except Exception as exc:
            if verbose:
                logger.warning("Failed to load TorchScript model %s: %s", ts_path, exc)
    elif verbose:
        if not ts_path.exists():
            logger.info("TorchScript model not found: %s", ts_path)
        else:
            logger.info("Torch not available, skipping TorchScript model %s", ts_path)

    onnx_path = MODEL_DIR / f"{inst}_phrase.onnx"
    if onnx_path.exists() and ort is not None:
        try:  # pragma: no cover - depends on optional onnxruntime
            session = ort.InferenceSession(str(onnx_path))
            return "onnx", session
        except Exception as exc:
            if verbose:
                logger.warning("Failed to load ONNX model %s: %s", onnx_path, exc)
    elif verbose:
        if not onnx_path.exists():
            logger.info("ONNX model not found: %s", onnx_path)
        else:
            logger.info("onnxruntime not available, skipping ONNX model %s", onnx_path)

    if verbose:
        logger.warning("No model available for %s – falling back to deterministic patterns", inst)
    return None, None


def load_model(inst: str, *, verbose: bool = False) -> Tuple[Optional[str], Optional[object]]:
    """Attempt to load a model for ``inst`` with caching.

    The function first consults an in-memory cache.  If the model has not been
    loaded yet it is read from disk and stored in the cache.  The returned
    tuple follows the same convention as :func:`_load_model_from_disk`.
    """

    with _cache_lock:
        if inst in MODEL_CACHE:
            return MODEL_CACHE[inst]

    fmt, model = _load_model_from_disk(inst, verbose=verbose)
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
    verbose: bool = False,
    **_: object,
) -> List[int]:
    """Generate a token sequence for ``inst``.

    The returned list contains the newly generated tokens (not including the
    ``prompt``).  Additional keyword arguments are accepted for forward
    compatibility but ignored by the current implementation.  The function
    raises an exception if the model can not be loaded or if sampling exceeds
    ``timeout`` seconds.

    If ``seed`` is provided, the Python, NumPy and (if available) torch random
    number generators are seeded only for the duration of this call.  Their
    previous RNG states are restored afterwards so external randomness is not
    affected.
    """

    fmt, model = load_model(inst, verbose=verbose)
    if model is None:
        raise RuntimeError(f"no model available for {inst}")

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
            next_tok = sample(
                logits,
                top_p=top_p,
                top_k=top_k,
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                history=history,
            )
            history.append(next_tok)
        return history[len(prompt):]

    if seed is None:
        return _run_with_timeout(_sample_loop, timeout)

    # Snapshot Python, NumPy and (if available) torch RNG states so seeding
    # does not leak outside this function.
    py_state = random.getstate()
    np_state = np.random.get_state()
    torch_state = None
    if torch is not None:
        try:  # pragma: no cover - depends on optional torch
            torch_state = torch.random.get_rng_state()
        except Exception:
            torch_state = None

    random.seed(seed)
    np.random.seed(seed)
    if torch is not None:
        try:  # pragma: no cover - depends on optional torch
            torch.manual_seed(seed)
        except Exception:
            pass

    try:
        return _run_with_timeout(_sample_loop, timeout)
    finally:
        random.setstate(py_state)
        np.random.set_state(np_state)
        if torch_state is not None:
            try:  # pragma: no cover - depends on optional torch
                torch.random.set_rng_state(torch_state)
            except Exception:
                pass
