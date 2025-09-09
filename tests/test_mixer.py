import numpy as np

from core.mixer import mix


def test_gain_pan_limiter():
    sr = 44100
    # Loud mono signal to trigger limiter
    stem = np.ones(1000, dtype=np.float32) * 2.0
    stems = {"keys": stem}
    cfg = {
        "tracks": {"keys": {"gain": -6.0, "pan": 1.0, "reverb_send": 0.0}},
        "master": {"limiter": {"enabled": True, "threshold": -0.1}},
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
    }
    out = mix(stems, sr, cfg)
    # Expect some energy in the tail from the reverb
    assert np.any(np.abs(out[10:, 0]) > 1e-5) or np.any(np.abs(out[10:, 1]) > 1e-5)
