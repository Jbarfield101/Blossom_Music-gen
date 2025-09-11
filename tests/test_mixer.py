import numpy as np

from core.mixer import mix, _plate_reverb


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
                "eq": {"type": "peaking", "freq": 1000.0, "gain": 6.0, "q": 1.0},
            }
        },
        "master": {"compressor": {"enabled": False}},
    }
    out_no = mix(stems, sr, cfg_no)
    out_eq = mix(stems, sr, cfg_eq)
    amp_no = np.max(np.abs(out_no[100:, 0]))
    amp_eq = np.max(np.abs(out_eq[100:, 0]))
    assert amp_eq > amp_no * 1.5


def test_low_shelf_boosts_bass():
    sr = 44100
    t = np.arange(int(sr * 0.1)) / sr
    sine = 0.25 * np.sin(2 * np.pi * 100 * t).astype(np.float32)
    stems = {"bass": sine}
    cfg_no = {"tracks": {"bass": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}}, "master": {"compressor": {"enabled": False}}}
    cfg_eq = {
        "tracks": {
            "bass": {
                "gain": 0.0,
                "pan": 0.0,
                "reverb_send": 0.0,
                "eq": {"type": "low_shelf", "freq": 500.0, "gain": 6.0, "q": 1.0},
            }
        },
        "master": {"compressor": {"enabled": False}},
    }
    out_no = mix(stems, sr, cfg_no)
    out_eq = mix(stems, sr, cfg_eq)
    amp_no = np.max(np.abs(out_no[100:, 0]))
    amp_eq = np.max(np.abs(out_eq[100:, 0]))
    assert amp_eq > amp_no * 1.5


def test_high_shelf_boosts_treble():
    sr = 44100
    t = np.arange(int(sr * 0.1)) / sr
    sine = 0.25 * np.sin(2 * np.pi * 5000 * t).astype(np.float32)
    stems = {"lead": sine}
    cfg_no = {"tracks": {"lead": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}}, "master": {"compressor": {"enabled": False}}}
    cfg_eq = {
        "tracks": {
            "lead": {
                "gain": 0.0,
                "pan": 0.0,
                "reverb_send": 0.0,
                "eq": {"type": "high_shelf", "freq": 2000.0, "gain": 6.0, "q": 1.0},
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
    stem = np.ones(int(sr * 0.1), dtype=np.float32) * np.sqrt(2.0)
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
                "attack": 0.001,
                "release": 0.05,
                "knee_db": 0.0,
                "lookahead_ms": 0.0,
            },
            "limiter": {"enabled": False},
        },
    }
    out_no = mix(stems, sr, cfg_no)
    out_comp = mix(stems, sr, cfg_comp)
    peak_no = float(np.max(np.abs(out_no)))
    steady = int(len(stem) * 0.8)
    peak_comp = float(np.max(np.abs(out_comp[steady:])))
    target = 10 ** ((-20 + (0 - (-20)) / 2) / 20)
    assert np.isclose(peak_comp, target, atol=1e-2)
    assert peak_no > peak_comp


def test_bus_compressor_lookahead_catches_transient():
    sr = 44100
    stem = np.zeros(int(sr * 0.1), dtype=np.float32)
    step = int(sr * 0.01)
    stem[step:] = np.sqrt(2.0)
    stems = {"keys": stem}
    lookahead_ms = 5.0
    cfg_no = {
        "tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {
            "compressor": {
                "enabled": True,
                "threshold": -20.0,
                "attack": 0.005,
                "release": 0.05,
                "knee_db": 0.0,
                "lookahead_ms": 0.0,
            },
            "limiter": {"enabled": False},
        },
    }
    cfg_la = {
        "tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {
            "compressor": {
                "enabled": True,
                "threshold": -20.0,
                "attack": 0.005,
                "release": 0.05,
                "knee_db": 0.0,
                "lookahead_ms": lookahead_ms,
            },
            "limiter": {"enabled": False},
        },
    }
    out_no = mix(stems, sr, cfg_no)
    out_la = mix(stems, sr, cfg_la)
    lookahead = int(sr * (lookahead_ms / 1000.0))
    assert out_no[step, 0] > out_la[step + lookahead, 0]


def test_saturation_reduces_peak_and_adds_harmonics():
    sr = 44100
    t = np.arange(sr) / sr
    sine = (2.0 * np.sin(2 * np.pi * 100 * t)).astype(np.float32)
    stems = {"keys": sine}
    base_cfg = {"tracks": {"keys": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}}}
    cfg_no = {
        **base_cfg,
        "master": {
            "saturation": {"drive": 0.0},
            "compressor": {"enabled": False},
            "limiter": {"enabled": False},
        },
    }
    cfg_sat = {
        **base_cfg,
        "master": {
            "saturation": {"drive": 5.0},
            "compressor": {"enabled": False},
            "limiter": {"enabled": False},
        },
    }
    out_no = mix(stems, sr, cfg_no)
    out_sat = mix(stems, sr, cfg_sat)
    peak_no = np.max(np.abs(out_no))
    peak_sat = np.max(np.abs(out_sat))
    assert peak_sat < peak_no

    spec_no = np.abs(np.fft.rfft(out_no[:, 0]))
    spec_sat = np.abs(np.fft.rfft(out_sat[:, 0]))
    third = 300  # 3rd harmonic of 100 Hz when len == sr
    assert spec_sat[third] > spec_no[third] * 10


def test_reverb_predelay_shifts_response():
    sr = 100
    imp = np.zeros(200, dtype=np.float32)
    imp[0] = 1.0
    stereo = np.stack([imp, imp], axis=1)
    ir_no = _plate_reverb(stereo, sr, decay=0.2, predelay=0.0, damp=0.5)
    ir_pd = _plate_reverb(stereo, sr, decay=0.2, predelay=0.05, damp=0.5)

    def first_nonzero(ir: np.ndarray) -> int:
        nz = np.where(np.abs(ir[:, 0]) > 1e-5)[0]
        return int(nz[0]) if len(nz) else len(ir)

    first_no = first_nonzero(ir_no)
    first_pd = first_nonzero(ir_pd)
    assert first_pd >= first_no + int(0.05 * sr) - 1


def test_reverb_damping_reduces_high_freq():
    sr = 100
    imp = np.zeros(200, dtype=np.float32)
    imp[0] = 1.0
    stereo = np.stack([imp, imp], axis=1)
    ir_low = _plate_reverb(stereo, sr, decay=0.3, predelay=0.0, damp=0.0)
    ir_high = _plate_reverb(stereo, sr, decay=0.3, predelay=0.0, damp=0.9)

    hf_low = np.sum(np.abs(np.diff(ir_low[:, 0])))
    hf_high = np.sum(np.abs(np.diff(ir_high[:, 0])))
    assert hf_high < hf_low
