import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

from core.song_spec import SongSpec
from core.stems import build_stems_for_song
from core.render import render_song


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


def _maybe_export_mp3(wav_path: Path) -> None:
    """Convert ``wav_path`` to MP3 using ``ffmpeg`` if available."""

    if shutil.which("ffmpeg") is None:
        return
    mp3_path = wav_path.with_suffix(".mp3")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(wav_path),
                str(mp3_path),
            ],
            check=True,
        )
    except Exception:
        # Conversion is best effort only
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True, help="Song specification JSON")
    ap.add_argument("--seed", type=int, default=42, help="Random seed")
    ap.add_argument(
        "--mix",
        default="out/mix.wav",
        help="Output path for the master mix WAV",
    )
    ap.add_argument(
        "--stems",
        default="out/stems",
        help="Directory to write individual stem WAVs",
    )
    ap.add_argument(
        "--piano-sfz",
        dest="piano_sfz",
        help="Path to piano SFZ file or directory. If omitted, uses render_config.json",
    )
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)
    spec.validate()

    stems = build_stems_for_song(spec, seed=args.seed)

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

    rendered = render_song(stems, sr=44100, sfz_paths={"keys": sfz_path})

    mix_path = Path(args.mix)
    mix_path.parent.mkdir(parents=True, exist_ok=True)
    _write_wav(mix_path, rendered.pop("mix"), 44100)
    _maybe_export_mp3(mix_path)

    stem_dir = Path(args.stems)
    stem_dir.mkdir(parents=True, exist_ok=True)
    for name, audio in rendered.items():
        stem_path = stem_dir / f"{name}.wav"
        _write_wav(stem_path, audio, 44100)
        _maybe_export_mp3(stem_path)
