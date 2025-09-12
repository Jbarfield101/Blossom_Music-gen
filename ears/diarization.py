"""Optional speaker diarization utilities using pyannote.audio.

This module exposes :func:`pyannote_diarize` which splits a mono PCM
buffer into per-speaker segments using a pre-trained
``pyannote.audio`` pipeline.  The function returns an iterable of
``(speaker_id, segment_bytes)`` tuples where ``segment_bytes`` contains
16-bit PCM data at 16 kHz corresponding to a single speaker turn.

The heavy ``pyannote.audio`` dependency is imported lazily so that the
rest of the package can function without it.  A ``RuntimeError`` is
raised if the library is unavailable when the function is invoked.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Tuple

import numpy as np

try:  # pragma: no cover - optional dependency
    import torch
    from pyannote.audio import Pipeline
except Exception:  # pragma: no cover - handled at runtime
    Pipeline = None  # type: ignore
    torch = None  # type: ignore


@lru_cache()
def _load_pipeline() -> Pipeline:
    """Load the default pyannote speaker diarization pipeline.

    The resulting object is cached to avoid repeated initialization.
    """

    if Pipeline is None:
        raise RuntimeError("pyannote.audio is required for diarization")
    # ``from_pretrained`` will download the model if necessary.  The
    # default model performs speaker diarization on short audio clips.
    return Pipeline.from_pretrained("pyannote/speaker-diarization")


def pyannote_diarize(pcm: bytes, sample_rate: int = 16000) -> Iterable[Tuple[str, bytes]]:
    """Split ``pcm`` into per-speaker segments using ``pyannote.audio``.

    Parameters
    ----------
    pcm:
        Mono 16‑bit PCM audio.
    sample_rate:
        Sampling rate of ``pcm``.  Defaults to 16 kHz which matches the
        expected rate of :class:`~ears.vad.VoiceActivityDetector`.
    """

    pipeline = _load_pipeline()

    # Convert PCM bytes to the ``pyannote.audio`` expected format.
    waveform = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    tensor = torch.from_numpy(waveform).unsqueeze(0)
    audio = {"waveform": tensor, "sample_rate": sample_rate}
    diarization = pipeline(audio)

    for segment, _, speaker in diarization.itertracks(yield_label=True):
        start = int(segment.start * sample_rate)
        end = int(segment.end * sample_rate)
        portion = waveform[start:end]
        yield speaker, (portion * 32768.0).astype(np.int16).tobytes()


__all__ = ["pyannote_diarize"]
