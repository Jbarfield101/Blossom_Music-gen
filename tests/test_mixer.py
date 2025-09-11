import numpy as np

from core.mixer import mix


def test_gain_pan_limiter():
    sr = 44100
    # Loud mono signal to trigger limiter
    stem = np.ones(1000, dtype=np.float32) * 2.0
    stems = {"keys": stem}
    cfg = {
        "tracks": {"keys": {"gain": -6.0, "pan": 1.0, "reverb_send": 0.0}},
        "master": {
            "compressor": {"enabled": False},
            "limiter": {"enabled": True, "threshold": -0.1},
        },
    }
    out = mix(stems, sr, cfg)
    assert out.shape == (1000, 2)
    # Hard right pan -> left channel close to zero
    assert np.max(np.abs(out[:, 0])) < 1e-4
    target = 10 ** (-0.1 / 20.0)
    assert np.isclose(np.max(np.abs(out)), target, atol=1e-4)


def test_reverb_send_creates_tail():
    sr = 100
    stem = np.zeros(100, dtype=np.float32)
    stem[0] = 1.0
    stems = {"pads": stem}
    cfg = {
        "tracks": {"pads": {"gain": 0.0, "pan": 0.0, "reverb_send": 1.0}},
        "reverb": {"decay": 0.2, "wet": 1.0},
        "master": {"compressor": {"enabled": False}},
    }
    out = mix(stems, sr, cfg)
    # Expect some energy in the tail from the reverb
    assert np.any(np.abs(out[10:, 0]) > 1e-5) or np.any(np.abs(out[10:, 1]) > 1e-5)


def test_track_eq_boosts_frequency():
    sr = 44100
    t = np.arange(int(sr * 0.1)) / sr
    sine = 0.25 * np.sin(2 * np.pi * 1000 * t).astype(np.float32)
    stems = {"keys": sine}
    cfg_no = {"tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}}, "master": {"compressor": {"enabled": False}}}
    cfg_eq = {
        "tracks": {
            "keys": {
                "gain": 0.0,
                "pan": 0.0,
                "reverb_send": 0.0,
                "eq": {"freq": 1000.0, "gain": 6.0, "q": 1.0},
            }
        },
        "master": {"compressor": {"enabled": False}},
    }
    out_no = mix(stems, sr, cfg_no)
    out_eq = mix(stems, sr, cfg_eq)
    amp_no = np.max(np.abs(out_no[100:, 0]))
    amp_eq = np.max(np.abs(out_eq[100:, 0]))
    assert amp_eq > amp_no * 1.5


def test_bus_compressor_reduces_peak():
    sr = 44100
    stem = np.ones(int(sr * 0.1), dtype=np.float32)
    stems = {"keys": stem}
    cfg_no = {
        "tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {"compressor": {"enabled": False}, "limiter": {"enabled": False}},
    }
    cfg_comp = {
        "tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {
            "compressor": {
                "enabled": True,
                "threshold": -20.0,
                "ratio": 4.0,
                "attack": 0.001,
                "release": 0.05,
            },
            "limiter": {"enabled": False},
        },
    }
    out_no = mix(stems, sr, cfg_no)
    out_comp = mix(stems, sr, cfg_comp)
    peak_no = float(np.max(np.abs(out_no)))
    steady = int(len(stem) * 0.8)
    peak_comp = float(np.max(np.abs(out_comp[steady:])))
    target = 10 ** ((-20 + (0 - (-20)) / 4) / 20)
    assert peak_no > peak_comp
    assert np.isclose(peak_comp, target, atol=0.02)


def test_chorus_modifies_signal():
    sr = 44100
    t = np.arange(int(sr * 0.1)) / sr
    mono = np.sin(2 * np.pi * 220 * t).astype(np.float32)
    stems = {"pads": mono}
    cfg_dry = {
        "tracks": {"pads": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {"compressor": {"enabled": False}},
    }
    cfg_ch = {
        "tracks": {
            "pads": {
                "gain": 0.0,
                "pan": 0.0,
                "reverb_send": 0.0,
                "chorus": {"depth": 5.0, "rate": 0.5, "mix": 1.0},
            }
        },
        "master": {"compressor": {"enabled": False}},
    }
    dry = mix(stems, sr, cfg_dry)
    wet = mix(stems, sr, cfg_ch)
    ac_dry = np.correlate(dry[:, 0], dry[:, 0], mode="full")
    ac_wet = np.correlate(wet[:, 0], wet[:, 0], mode="full")
    assert np.max(np.abs(ac_dry - ac_wet)) > 1e-3
    fft_dry = np.abs(np.fft.rfft(dry[:, 0]))
    fft_wet = np.abs(np.fft.rfft(wet[:, 0]))
    assert np.max(np.abs(fft_dry - fft_wet)) > 1e-3
