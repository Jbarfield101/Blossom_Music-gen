"""Voice activity detection utilities.

This module wraps :mod:`webrtcvad` to flag speech frames and emit
contiguous speech segments. Silence is trimmed from both ends of a
segment. A callback may be provided to forward detected speech batches to
an upstream transcription pipeline.

The interface is designed with optional speaker diarization in mind.
An optional ``diarizer`` callable can be supplied that splits each
segment into per-speaker portions (e.g., using ``pyannote.audio``).
"""

from __future__ import annotations

from collections import deque
from typing import Awaitable, Callable, Deque, Dict, Iterable, List, Optional, Tuple

import webrtcvad

# Callback invoked when a speech segment is ready. ``speaker`` is an arbitrary
# identifier (e.g., Discord ``Member`` ID) or ``None`` when diarization is not
# used.
SegmentCallback = Callable[[bytes, Optional[str]], Awaitable[None]]
# Callable used for optional diarization. It should take a mono PCM byte string
# and yield ``(speaker, segment_bytes)`` tuples.
DiarizationHook = Callable[[bytes], Iterable[Tuple[str, bytes]]]


class _StreamState:
    """Internal buffer state for a single (potential) speaker."""

    def __init__(self, padding_frames: int) -> None:
        self.triggered = False
        self.frames: List[bytes] = []
        self.silence = 0
        self.pre_speech: Deque[bytes] = deque(maxlen=padding_frames)
        self.padding_frames = padding_frames


class VoiceActivityDetector:
    """Segment incoming PCM frames using WebRTC VAD."""

    def __init__(
        self,
        *,
        sample_rate: int = 16000,
        frame_ms: int = 20,
        vad_mode: int = 3,
        padding_ms: int = 300,
        segment_callback: Optional[SegmentCallback] = None,
        diarizer: Optional[DiarizationHook] = None,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.vad = webrtcvad.Vad(vad_mode)
        self._segment_cb = segment_callback
        self._diarizer = diarizer
        self._padding_frames = padding_ms // frame_ms
        self._states: Dict[Optional[str], _StreamState] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    async def process(self, frame: bytes, speaker: Optional[str] = None) -> None:
        """Process a single PCM frame.

        Parameters
        ----------
        frame:
            Raw 16‑bit mono PCM audio corresponding to ``frame_ms``.
        speaker:
            Optional speaker identifier. When provided, separate buffers are
            kept per speaker to enable diarization hooks later on.
        """

        state = self._states.setdefault(speaker if self._diarizer else None, _StreamState(self._padding_frames))
        is_speech = self.vad.is_speech(frame, self.sample_rate)

        if not state.triggered:
            state.pre_speech.append(frame)
            if is_speech:
                state.triggered = True
                state.frames.extend(state.pre_speech)
                state.pre_speech.clear()
        else:
            state.frames.append(frame)
            if is_speech:
                state.silence = 0
            else:
                state.silence += 1
                if state.silence > state.padding_frames:
                    await self._emit(state, speaker)

    async def flush(self) -> None:
        """Emit any buffered segments."""

        for speaker, state in list(self._states.items()):
            if state.triggered and state.frames:
                await self._emit(state, speaker)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    async def _emit(self, state: _StreamState, speaker: Optional[str]) -> None:
        """Send the buffered segment to the callback, trimming padding."""

        if state.silence >= state.padding_frames:
            usable_frames = state.frames[: -state.padding_frames]
        else:
            usable_frames = state.frames
        segment = b"".join(usable_frames)

        # Reset state before invoking callback to tolerate re‑entrancy
        state.triggered = False
        state.frames.clear()
        state.silence = 0

        if self._segment_cb is None:
            return

        if self._diarizer is not None:
            for spk, seg in self._diarizer(segment):
                await self._segment_cb(seg, spk)
        else:
            await self._segment_cb(segment, speaker)
