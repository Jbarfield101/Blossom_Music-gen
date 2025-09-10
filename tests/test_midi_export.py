from core.stems import Stem
from core.midi_export import stems_to_midi


def _mini_stems():
    return {"test": [Stem(start=0.0, dur=0.5, pitch=60, vel=100, chan=0)]}


def test_stems_to_midi(tmp_path):
    out_file = tmp_path / "mini.mid"
    stems_to_midi(_mini_stems(), tempo=120, meter="4/4", path=out_file)
    data = out_file.read_bytes()
    assert data.startswith(b"MThd")
    assert data.count(b"MTrk") == 2
    assert b"test" in data
    assert b"\xff\x51\x03\x07\xa1\x20" in data  # tempo 120 BPM
    assert b"\xff\x58\x04\x04\x02\x18\x08" in data  # time signature 4/4
    assert b"\x90\x3c\x64" in data  # note on
    assert b"\x80\x3c\x00" in data  # note off
