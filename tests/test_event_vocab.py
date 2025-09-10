import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import Stem
from core import event_vocab


def test_round_trip_encode_decode():
    notes = [
        Stem(start=0.0, dur=1.0, pitch=60, vel=100, chan=0),
        Stem(start=4.0, dur=1.0, pitch=64, vel=90, chan=1),
    ]
    tokens = event_vocab.encode(
        notes,
        section="A",
        meter="4/4",
        density=0.5,
        chord="C",
        seed=1234,
        cadence=True,
    )
    decoded, meta = event_vocab.decode(tokens)
    assert decoded == notes
    assert meta["section"] == event_vocab.SECTION_TO_ID["A"]
    assert meta["meter_beats"] == 4
    assert meta["density_bucket"] == event_vocab.density_to_bucket(0.5)
    assert meta["chord"] == event_vocab.CHORD_TO_ID["C"]
    assert meta["seed"] == (1234 & 0xFFFF)
    assert meta["cadence"] == 1
