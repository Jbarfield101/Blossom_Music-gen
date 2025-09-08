import argparse
import json
from pathlib import Path
from typing import List

import numpy as np

from core.song_spec import SongSpec
from core.stems import build_stems_for_song, Stem
from core.render import render_keys


def _write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    """Write ``audio`` to ``path`` as 16-bit PCM WAV.

    Tries to use :mod:`soundfile` and falls back to :mod:`scipy.io.wavfile` if
    available.  Raises :class:`SystemExit` if neither backend is installed.
    """
    try:
        import soundfile as sf  # type: ignore
        sf.write(path, audio, sr, subtype="PCM_16")
        return
    except Exception:
        pass
    try:
        from scipy.io import wavfile  # type: ignore
    except Exception as exc:  # pragma: no cover - handled at runtime
        raise SystemExit(
            "Please install 'soundfile' or 'scipy' to write WAV files."
        ) from exc
    data = np.clip(audio, -1.0, 1.0)
    wavfile.write(path, sr, (data * 32767).astype(np.int16))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument(
        "--piano-sfz",
        dest="piano_sfz",
        help="Path to piano SFZ file or directory. If omitted, uses render_config.json",
    )
    ap.add_argument("--mix", default="out/piano.wav")
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()

    stems = build_stems_for_song(spec, seed=42)
    keys: List[Stem] = stems.get("keys", [])

    if args.piano_sfz:
        sfz_path = Path(args.piano_sfz)
    else:
        cfg_path = Path("render_config.json")
        if cfg_path.exists():
            with cfg_path.open("r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            sfz_path = Path(cfg.get("piano_sfz", "assets/sfz"))
        else:
            sfz_path = Path("assets/sfz")

    if sfz_path.is_dir():
        sfz_path = sfz_path / "piano.sfz"
    if not sfz_path.exists():
        raise SystemExit(f"Missing SFZ instrument: {sfz_path}")

    try:
        mix = render_keys(keys, sfz_path, sr=44100)
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing SFZ asset: {exc}") from exc

    out_path = Path(args.mix)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _write_wav(out_path, mix, 44100)
