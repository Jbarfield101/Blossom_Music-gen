from __future__ import annotations

"""MIDI import utilities for loading user melodies."""

from pathlib import Path
from typing import List, Tuple

from .stems import Stem


def load_melody_midi(path: str | Path) -> Tuple[List[Stem], float, str]:
    """Load a melody MIDI file and return note stems with tempo and meter.

    The function accepts a path to a Standard MIDI file containing a single
    melody track alongside a meta track.  It attempts to use :mod:`mido` when
    available but falls back to a small bespoke parser that supports the
    subset of the MIDI format emitted by :func:`core.midi_export.stems_to_midi`.

    Returns a tuple ``(notes, tempo, meter)`` where ``tempo`` is in BPM and
    ``meter`` is a ``"N/D"`` string like ``"4/4"``.  ``notes`` contains start
    times and durations in seconds relative to the beginning of the file.
    """

    try:  # pragma: no cover - optional dependency
        import mido  # type: ignore
    except Exception:  # pragma: no cover - lightweight fallback
        mido = None  # type: ignore

    path = Path(path)
    if mido is not None:
        mid = mido.MidiFile(path)
        tempo = 120.0
        meter = "4/4"
        for msg in mid.tracks[0]:
            if msg.type == "set_tempo":
                tempo = mido.tempo2bpm(msg.tempo)
            elif msg.type == "time_signature":
                meter = f"{msg.numerator}/{msg.denominator}"
        ticks_per_second = mid.ticks_per_beat * tempo / 60.0
        notes: List[Stem] = []
        for track in mid.tracks[1:]:
            time = 0
            active: dict[tuple[int, int], tuple[int, int]] = {}
            for msg in track:
                time += msg.time
                if msg.type == "note_on" and msg.velocity > 0:
                    active[(msg.note, msg.channel)] = (time, msg.velocity)
                elif msg.type in ("note_off", "note_on") and msg.velocity == 0:
                    key = (msg.note, msg.channel)
                    start_vel = active.pop(key, None)
                    if start_vel is None:
                        continue
                    start, vel = start_vel
                    start_s = start / ticks_per_second
                    dur_s = (time - start) / ticks_per_second
                    notes.append(
                        Stem(start=start_s, dur=dur_s, pitch=int(msg.note), vel=int(vel), chan=int(msg.channel))
                    )
        notes.sort(key=lambda n: n.start)
        return notes, float(tempo), meter

    data = path.read_bytes()
    if data[:4] != b"MThd":
        raise ValueError("invalid MIDI file")
    header_len = int.from_bytes(data[4:8], "big")
    n_tracks = int.from_bytes(data[10:12], "big")
    ticks_per_beat = int.from_bytes(data[12:14], "big")
    idx = 8 + header_len

    def _read_varlen(buf: bytes, pos: int) -> tuple[int, int]:
        val = 0
        while True:
            b = buf[pos]
            pos += 1
            val = (val << 7) | (b & 0x7F)
            if not b & 0x80:
                break
        return val, pos

    def _read_chunk(pos: int) -> tuple[int, int, int]:
        if data[pos : pos + 4] != b"MTrk":
            raise ValueError("missing MTrk chunk")
        length = int.from_bytes(data[pos + 4 : pos + 8], "big")
        start = pos + 8
        end = start + length
        return start, end, end

    # meta track
    start, end, idx = _read_chunk(idx)
    tempo = 120.0
    meter = "4/4"
    pos = start
    time = 0
    while pos < end:
        delta, pos = _read_varlen(data, pos)
        time += delta
        status = data[pos]
        pos += 1
        if status != 0xFF:
            raise ValueError("unexpected event in meta track")
        meta = data[pos]
        pos += 1
        length = data[pos]
        pos += 1
        payload = data[pos : pos + length]
        pos += length
        if meta == 0x51 and length == 3:  # set_tempo
            uspb = int.from_bytes(payload, "big")
            tempo = 60_000_000 / uspb
        elif meta == 0x58 and length >= 2:  # time_signature
            num = payload[0]
            den = 1 << payload[1]
            meter = f"{num}/{den}"

    ticks_per_second = ticks_per_beat * tempo / 60.0
    notes: List[Stem] = []
    for _ in range(n_tracks - 1):
        start, end, idx = _read_chunk(idx)
        pos = start
        time = 0
        active: dict[tuple[int, int], tuple[int, int]] = {}
        while pos < end:
            delta, pos = _read_varlen(data, pos)
            time += delta
            status = data[pos]
            pos += 1
            if status == 0xFF:  # meta inside track
                meta = data[pos]
                pos += 1
                length = data[pos]
                pos += 1
                pos += length
                continue
            chan = status & 0x0F
            msg = status & 0xF0
            note = data[pos]
            vel = data[pos + 1]
            pos += 2
            if msg == 0x90 and vel > 0:
                active[(note, chan)] = (time, vel)
            else:
                start_vel = active.pop((note, chan), None)
                if start_vel is None:
                    continue
                start_tick, vel0 = start_vel
                start_s = start_tick / ticks_per_second
                dur_s = (time - start_tick) / ticks_per_second
                notes.append(Stem(start=start_s, dur=dur_s, pitch=note, vel=vel0, chan=chan))
    notes.sort(key=lambda n: n.start)
    return notes, float(tempo), meter
