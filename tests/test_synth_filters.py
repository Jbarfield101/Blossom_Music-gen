import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
from core import synth
from core.stems import Stem


def test_pulse_waveform():
    sr = 8000
    note = Stem(start=0.0, dur=0.01, pitch=69, vel=127, chan=0)
    params = synth.SynthParams(
        wave="pulse",
        pulse_width=0.25,
        attack=0.0,
        decay=0.0,
        sustain=1.0,
        release=0.0,
        cutoff_min=sr,
        cutoff_max=sr,
        lpf_order=2,
        keytrack=0.0,
    )
    data = synth.render_note(note, sr, params)
    ratio = np.mean(data > 0)
    assert np.isclose(ratio, 0.25, atol=0.05)


def test_keytrack_increases_cutoff():
    sr = 8000
    note = Stem(start=0.0, dur=0.05, pitch=80, vel=100, chan=0)
    base = dict(
        wave="saw",
        attack=0.0,
        decay=0.0,
        sustain=1.0,
        release=0.0,
        cutoff_min=200.0,
        cutoff_max=200.0,
        lpf_order=2,
    )
    no_track = synth.SynthParams(keytrack=0.0, **base)
    track = synth.SynthParams(keytrack=10.0, **base)
    no_data = synth.render_note(note, sr, no_track)
    track_data = synth.render_note(note, sr, track)
    rms_no = np.sqrt(np.mean(no_data**2))
    rms_track = np.sqrt(np.mean(track_data**2))
    assert rms_track > rms_no


def test_filter_order_affects_slope():
    sr = 8000
    note = Stem(start=0.0, dur=0.05, pitch=100, vel=127, chan=0)
    p12 = synth.SynthParams(
        wave="saw",
        attack=0.0,
        decay=0.0,
        sustain=1.0,
        release=0.0,
        cutoff_min=200.0,
        cutoff_max=200.0,
        lpf_order=2,
    )
    p24 = synth.SynthParams(
        wave="saw",
        attack=0.0,
        decay=0.0,
        sustain=1.0,
        release=0.0,
        cutoff_min=200.0,
        cutoff_max=200.0,
        lpf_order=4,
    )
    d12 = synth.render_note(note, sr, p12)
    d24 = synth.render_note(note, sr, p24)
    rms12 = np.sqrt(np.mean(d12**2))
    rms24 = np.sqrt(np.mean(d24**2))
    assert rms24 < rms12
