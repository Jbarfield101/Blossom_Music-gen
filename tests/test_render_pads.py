import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.stems import render_pads


def test_render_pads_merges_bars_and_jitters_start():
    pattern = {"density": 0.7}
    voiced = [
        [60, 64, 67, 71],
        [60, 64, 67, 71],
    ]
    register = {"pads": [60, 84]}
    notes = render_pads(pattern, voiced, register, "4/4", 120, seed=1)

    assert len(notes) == 4
    durations = {round(n.dur, 2) for n in notes}
    assert durations == {4.0}
    assert not all(n.start == 0 for n in notes)
    assert all(abs(n.start) < 0.05 for n in notes)


def test_render_pads_drops_inner_voices_on_low_density():
    pattern = {"density": 0.2}
    voiced = [[60, 64, 67, 71]]
    register = {"pads": [60, 84]}
    notes = render_pads(pattern, voiced, register, "4/4", 120, seed=2)

    pitches = sorted(n.pitch for n in notes)
    assert pitches == [60, 71]
