from __future__ import annotations

"""MIDI export utilities."""

from pathlib import Path
from typing import Dict, List
import math

from .stems import Stem


def stems_to_midi(
    stems: Dict[str, List[Stem]],
    tempo: float,
    meter: str,
    path: str | Path,
    ticks_per_beat: int = 480,
) -> None:
    """Export ``stems`` as a Standard MIDI file to ``path``.

    Parameters
    ----------
    stems:
        Mapping of instrument name to lists of :class:`Stem` events.
    tempo:
        Tempo in beats-per-minute.
    meter:
        Time signature in ``"N/D"`` form, e.g. ``"4/4"``.
    path:
        Destination file path. Parent directories are created automatically.
    ticks_per_beat:
        Resolution of the MIDI file (default: 480).
    """

    try:  # Prefer mido when available
        import mido  # type: ignore
    except Exception:  # pragma: no cover - optional dependency
        mido = None  # type: ignore

    ticks_per_second = ticks_per_beat * tempo / 60.0
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    num_str, den_str = meter.split("/", 1)
    num = int(num_str)
    den = int(den_str)
    denom_pow = int(math.log2(den))

    if mido is not None:
        mid = mido.MidiFile(type=1, ticks_per_beat=ticks_per_beat)
        meta = mido.MidiTrack()
        meta.append(mido.MetaMessage("track_name", name="meta", time=0))
        meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo), time=0))
        meta.append(
            mido.MetaMessage("time_signature", numerator=num, denominator=den, time=0)
        )
        meta.append(mido.MetaMessage("end_of_track", time=0))
        mid.tracks.append(meta)

        for inst, note_list in stems.items():
            track = mido.MidiTrack()
            track.append(mido.MetaMessage("track_name", name=inst, time=0))
            events: List[tuple[int, bool, int, int, int]] = []
            for n in note_list:
                start_tick = int(round(n.start * ticks_per_second))
                end_tick = int(round((n.start + n.dur) * ticks_per_second))
                events.append((start_tick, True, n.pitch, n.vel, n.chan))
                events.append((end_tick, False, n.pitch, 0, n.chan))
            events.sort(key=lambda e: e[0])
            prev_tick = 0
            for tick, is_on, pitch, vel, chan in events:
                delta = tick - prev_tick
                msg = "note_on" if is_on else "note_off"
                track.append(
                    mido.Message(msg, note=int(pitch), velocity=int(vel), channel=chan, time=delta)
                )
                prev_tick = tick
            track.append(mido.MetaMessage("end_of_track", time=0))
            mid.tracks.append(track)
        mid.save(path)
        return

    # ------------------------------------------------------------------
    # Fallback writer
    # ------------------------------------------------------------------

    def _varlen(value: int) -> bytes:
        out = bytearray([value & 0x7F])
        value >>= 7
        while value:
            out.insert(0, (value & 0x7F) | 0x80)
            value >>= 7
        return bytes(out)

    n_tracks = 1 + len(stems)
    with open(path, "wb") as fh:
        header = (
            b"MThd"
            + (6).to_bytes(4, "big")
            + (1).to_bytes(2, "big")
            + n_tracks.to_bytes(2, "big")
            + ticks_per_beat.to_bytes(2, "big")
        )
        fh.write(header)

        meta_data = bytearray()
        meta_data.extend(b"\x00\xFF\x03\x04meta")
        tempo_val = int(round(60_000_000 / tempo))
        meta_data.extend(b"\x00\xFF\x51\x03" + tempo_val.to_bytes(3, "big"))
        meta_data.extend(b"\x00\xFF\x58\x04" + bytes([num, denom_pow, 24, 8]))
        meta_data.extend(b"\x00\xFF\x2F\x00")
        fh.write(b"MTrk" + len(meta_data).to_bytes(4, "big") + meta_data)

        for inst, note_list in stems.items():
            events: List[tuple[int, bool, int, int, int]] = []
            for n in note_list:
                start_tick = int(round(n.start * ticks_per_second))
                end_tick = int(round((n.start + n.dur) * ticks_per_second))
                events.append((start_tick, True, n.pitch, n.vel, n.chan))
                events.append((end_tick, False, n.pitch, 0, n.chan))
            events.sort(key=lambda e: e[0])

            track_data = bytearray()
            name_bytes = inst.encode("utf-8")
            track_data.extend(b"\x00\xFF\x03" + bytes([len(name_bytes)]) + name_bytes)
            prev_tick = 0
            for tick, is_on, pitch, vel, chan in events:
                delta = tick - prev_tick
                track_data.extend(_varlen(delta))
                status = (0x90 if is_on else 0x80) | (chan & 0x0F)
                track_data.extend(bytes([status, pitch & 0x7F, vel & 0x7F]))
                prev_tick = tick
            track_data.extend(b"\x00\xFF\x2F\x00")
            fh.write(b"MTrk" + len(track_data).to_bytes(4, "big") + track_data)
