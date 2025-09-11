import numpy as np

from core.mixer import mix


def test_chorus_alters_autocorr_and_fft():
    sr = 44100
    t = np.arange(int(sr * 0.2)) / sr
    pad = np.sin(2 * np.pi * 220 * t).astype(np.float32)
    stems = {"pads": pad}
    dry_cfg = {
        "tracks": {"pads": {"gain": 0.0, "pan": 0.0, "reverb_send": 0.0}},
        "master": {"compressor": {"enabled": False}, "limiter": {"enabled": False}},
    }
    chor_cfg = {
        "tracks": {
            "pads": {
                "gain": 0.0,
                "pan": 0.0,
                "reverb_send": 0.0,
                "chorus": {"depth": 5.0, "rate": 0.5, "mix": 1.0},
            }
        },
        "master": {"compressor": {"enabled": False}, "limiter": {"enabled": False}},
    }

    out_dry = mix(stems, sr, dry_cfg)
    out_chor = mix(stems, sr, chor_cfg)

    auto_dry = np.correlate(out_dry[:, 0], out_dry[:, 0], mode="full")
    auto_chor = np.correlate(out_chor[:, 0], out_chor[:, 0], mode="full")
    fft_dry = np.abs(np.fft.rfft(out_dry[:, 0]))
    fft_chor = np.abs(np.fft.rfft(out_chor[:, 0]))

    assert np.mean(np.abs(auto_dry - auto_chor)) > 1e-3
    assert np.mean(np.abs(fft_dry - fft_chor)) > 1e-3
