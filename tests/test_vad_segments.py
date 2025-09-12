import os
import sys

import pytest

pytest.importorskip("webrtcvad")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from ears.vad import VoiceActivityDetector


@pytest.mark.asyncio
async def test_segments_emitted_and_trimmed():
    frame = b"\x01" * 640
    silence = b"\x00" * 640
    seen = []

    async def cb(seg: bytes, spk):
        seen.append(seg)

    vad = VoiceActivityDetector(segment_callback=cb, padding_ms=40)
    decisions = iter([False, True, True, True, False, False, False])
    vad.vad.is_speech = lambda f, sr: next(decisions)

    frames = [silence] + [frame] * 3 + [silence] * 3
    for fr in frames:
        await vad.process(fr)

    assert len(seen) == 1
    segment = seen[0]
    frame_len = len(frame)
    assert len(segment) == 5 * frame_len
    assert segment[-frame_len:] == silence
