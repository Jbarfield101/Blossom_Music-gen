import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import render_keys


def test_chord_stabs_with_tensions_and_no_leading_tone_duplication():
    pattern = {
        "stabs": [1] + [0]*15,
        "tension_policy": {0: [11, 14]},
    }
    voiced = [[60, 64, 67, 71]]  # Cmaj7
    register = {"keys": [60, 84]}
    notes = render_keys(pattern, voiced, register, "4/4", 120, seed=1)
    pitches = sorted(n.pitch for n in notes)
    assert pitches == [64, 71, 74]


def test_arpeggio_iterates_satb_order():
    pattern = {"arp": [1, 0, 1, 0, 1, 0, 1, 0]}
    voiced = [[60, 64, 67, 71]]  # ascending bass->soprano
    register = {"keys": [60, 84]}
    notes = render_keys(pattern, voiced, register, "4/4", 120, seed=2)
    pitches = [n.pitch for n in notes]
    assert pitches == [71, 67, 64, 60]
