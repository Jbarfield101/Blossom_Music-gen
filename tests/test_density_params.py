import os, sys, pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.pattern_synth import density_to_hit_prob, density_to_note_rate


def test_density_to_hit_prob_boundaries():
    assert density_to_hit_prob(0) == 0
    assert density_to_hit_prob(0.5) == 0.5
    assert density_to_hit_prob(1) == 1


def test_density_to_note_rate_boundaries():
    assert density_to_note_rate(0) == 1
    assert density_to_note_rate(0.5) == 3
    assert density_to_note_rate(1) == 4
