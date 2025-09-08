import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import Stem, enforce_register, dedupe_collisions


def test_enforce_register_clamps_pitch():
    s_low = Stem(start=0.0, dur=1.0, pitch=50, vel=100, chan=0)
    s_high = Stem(start=0.0, dur=1.0, pitch=90, vel=100, chan=0)
    s_ok = Stem(start=0.0, dur=1.0, pitch=65, vel=100, chan=0)
    enforce_register(s_low, 60, 72)
    enforce_register(s_high, 60, 72)
    enforce_register(s_ok, 60, 72)
    assert s_low.pitch == 60
    assert s_high.pitch == 72
    assert s_ok.pitch == 65


def test_dedupe_and_bass_key_nudge():
    stems = {
        "keys": [
            Stem(start=0.0, dur=0.5, pitch=60, vel=100, chan=1),
            Stem(start=0.01, dur=0.5, pitch=60, vel=100, chan=1),
        ],
        "bass": [
            Stem(start=0.0, dur=0.5, pitch=60, vel=100, chan=0),
        ],
    }
    dedupe_collisions(stems)
    # within-key duplicates removed
    assert len(stems["keys"]) == 1
    k = stems["keys"][0]
    # key start nudged away from bass
    assert 0.005 <= k.start - stems["bass"][0].start <= 0.010 + 1e-9
