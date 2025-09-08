from core.stems import Stem, export_midi


def _mini_stems():
    return {"test": [Stem(start=0.0, dur=0.5, pitch=60, vel=100, chan=0)]}


def test_export_midi(tmp_path):
    out_file = tmp_path / "mini.mid"
    export_midi(_mini_stems(), out_file)
    expected = bytes.fromhex(
        "4d546864000000060001000101e04d54726b0000000d00903c648360803c0000ff2f00"
    )
    assert out_file.read_bytes() == expected
