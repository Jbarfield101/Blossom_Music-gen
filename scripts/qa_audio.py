import sys
import os
import glob
import numpy as np
import soundfile as sf


def main(argv):
    files = argv[1:] or ["gl.wav", "hifi.wav"]
    expanded = []
    for f in files:
        expanded.extend(glob.glob(f))
    if not expanded:
        print("No files matched.")
        return 1
    for path in expanded:
        try:
            x, sr = sf.read(path)
            x = np.asarray(x, dtype=np.float32)
            if x.ndim > 1:
                # Mixdown to mono for simple stats
                x = x.mean(axis=1)
            finite = np.isfinite(x).all()
            peak = float(np.max(np.abs(x))) if x.size else 0.0
            mean_abs = float(np.mean(np.abs(x))) if x.size else 0.0
            shape = (len(x),) if x.ndim == 1 else x.shape
            print(f"{path} sr={sr} shape={shape} peak={peak:.6f} mean_abs={mean_abs:.6f} finite={finite}")
            if peak > 0.99:
                print("  WARN: peak exceeds 0.99; consider lowering gain before dither.")
        except Exception as e:
            print(f"{path} ERROR: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

