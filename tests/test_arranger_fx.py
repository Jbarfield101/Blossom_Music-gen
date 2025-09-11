"""Tests for arrangement time-domain effects controlled by style hooks."""

import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.arranger import arrange_song
from core.song_spec import SongSpec, Section
from core.stems import Stem, bars_to_beats, beats_to_secs


def _basic_spec() -> SongSpec:
    """Return a minimal song specification with verse/chorus/bridge."""

    return SongSpec(
        tempo=120,
        meter="4/4",
        sections=[
            Section("verse", 4),
            Section("chorus", 4),
            Section("bridge", 4),
        ],
        cadences=[{"bar": 3, "type": "sec"}],
    )


def test_arranger_effects():
    spec = _basic_spec()

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_beat = beats_to_secs(spec.tempo)
    sec_per_bar = beats_per_bar * sec_per_beat

    stems = {
        "drums": [
            Stem(start=0.0, dur=0.25, pitch=36, vel=100, chan=9),
            Stem(start=8 * sec_per_bar, dur=0.25, pitch=36, vel=100, chan=9),
        ],
        "pads": [],
    }

    style = {
        "fx": {
            "cadence_noise": True,
            "cadence_toms": True,
            "chorus_swells": True,
            "bridge_drop": True,
        }
    }

    out = arrange_song(spec, stems, style=style, seed=1)

    cadence_start = 2 * sec_per_bar
    tol = 0.02  # allow for micro-timing jitter applied by dynamics
    # Noise sweep added to FX instrument
    fx_notes = out.get("fx", [])
    assert any(
        abs(n.start - cadence_start) < tol and abs(n.dur - sec_per_bar) < tol
        for n in fx_notes
    )

    # Tom roll should add tom pitches within pre-cadence bar
    drum_notes = out.get("drums", [])
    assert any(
        cadence_start - tol <= n.start < cadence_start + sec_per_bar + tol
        and n.pitch in (45, 47, 50)
        for n in drum_notes
    )

    # Reverse pad swell before chorus
    chorus_start = 4 * sec_per_bar
    pad_notes = out.get("pads", [])
    assert any(
        abs(n.start - (chorus_start - sec_per_bar)) < tol
        and abs((n.start + n.dur) - chorus_start) < tol
        for n in pad_notes
    )

    # First bar of bridge should have no drums
    bridge_start = 8 * sec_per_bar
    assert not any(
        bridge_start - tol <= n.start < bridge_start + sec_per_bar for n in drum_notes
    )

