import asyncio
import array
import math
import pathlib
import sys
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

pytest.importorskip("webrtcvad")

from ears.vad import VoiceActivityDetector, _StreamState


def _synthetic_segment() -> bytes:
    """Return 1 s of two alternating "speakers" as PCM."""
    sr = 16000
    t = range(sr // 2)
    spk_a = array.array("h", (int(0.3 * 32767 * math.sin(2 * math.pi * 440 * i / sr)) for i in t))
    spk_b = array.array("h", (int(0.3 * 32767 * math.sin(2 * math.pi * 880 * i / sr)) for i in t))
    return spk_a.tobytes() + spk_b.tobytes()


def test_diarizer_splits_speakers() -> None:
    segment = _synthetic_segment()
    seen = []

    async def cb(seg: bytes, spk: str | None) -> None:
        seen.append(spk)

    def fake_diarizer(pcm: bytes):
        mid = len(pcm) // 2
        return [("A", pcm[:mid]), ("B", pcm[mid:])]

    vad = VoiceActivityDetector(segment_callback=cb, diarizer=fake_diarizer, padding_ms=0)

    state = _StreamState(0)
    state.triggered = True
    state.frames.append(segment)

    asyncio.run(vad._emit(state, None))

    assert seen == ["A", "B"]
