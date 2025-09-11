from __future__ import annotations
"""Common sampling utilities for generation models.

This module centralizes token sampling strategies such as temperature
scaling, top-k/top-p (nucleus) filtering and repetition penalties.  Keeping
these helpers in one place ensures that all sampling code behaves
consistently across the project.
"""

from typing import Sequence

import numpy as np

__all__ = [
    "apply_temperature",
    "apply_repetition_penalty",
    "filter_top_k_top_p",
    "sample",
]


def apply_temperature(logits: np.ndarray, temperature: float) -> np.ndarray:
    """Scale ``logits`` by ``temperature``.

    Parameters
    ----------
    logits:
        Raw model logits.
    temperature:
        Scaling factor; must be > 0.

    Returns
    -------
    np.ndarray
        Scaled logits as ``float64`` for numerical stability.
    """
    if temperature <= 0:
        raise ValueError("temperature must be > 0")
    return logits.astype(np.float64) / temperature


def apply_repetition_penalty(
    logits: np.ndarray, history: Sequence[int], penalty: float
) -> np.ndarray:
    """Penalise tokens present in ``history`` by ``penalty``.

    The function returns a copy of ``logits`` with the penalty applied so the
    caller can safely reuse the original array.
    """
    if penalty != 1.0 and history:
        logits = logits.copy()
        for tok in set(history):
            logits[tok] /= penalty
    return logits


def filter_top_k_top_p(logits: np.ndarray, top_k: int, top_p: float) -> np.ndarray:
    """Convert ``logits`` to probabilities after top-k and top-p filtering."""

    # Top-k filtering in logit space to avoid numerical issues with very small
    # probabilities.
    if top_k > 0 and top_k < len(logits):
        kth_val = np.partition(logits, -top_k)[-top_k]
        logits = np.where(logits < kth_val, -np.inf, logits)

    # Convert to probabilities for nucleus (top-p) filtering.
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
    return probs


def sample(
    logits: np.ndarray,
    *,
    top_p: float = 0.0,
    top_k: int = 0,
    temperature: float = 1.0,
    repetition_penalty: float = 1.0,
    history: Sequence[int] = (),
    rng: np.random.Generator = np.random.default_rng(),
) -> int:
    """Sample an index from ``logits`` using the configured strategies."""

    logits = apply_temperature(logits, temperature)
    logits = apply_repetition_penalty(logits, history, repetition_penalty)
    probs = filter_top_k_top_p(logits, top_k, top_p)
    return int(rng.choice(len(probs), p=probs))
