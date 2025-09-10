import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import argparse
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

from core.song_spec import SongSpec, extend_sections_to_minutes
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
from core.arranger import arrange_song
from core.render import render_song
from core.mixer import mix as mix_stems
from core.style import load_style


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


def _rms_db(audio: np.ndarray) -> float:
    """Return RMS loudness of ``audio`` in dBFS."""

    if audio.size == 0:
        return float("-inf")
    rms = np.sqrt(np.mean(np.square(audio)))
    if rms <= 0:
        return float("-inf")
    return 20 * np.log10(rms)


def _print_arrangement_summary(spec: SongSpec, mix: np.ndarray, sr: int) -> None:
    """Print a human-readable summary of the song arrangement."""

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_per_bar * beats_to_secs(spec.tempo)
    sec_map = spec.bars_by_section()

    print("\nArrangement summary:")
    for name, bar_range in sec_map.items():
        start_bar = bar_range.start
        end_bar = bar_range.stop - 1
        start_s = int(start_bar * sec_per_bar * sr)
        end_s = int((end_bar + 1) * sec_per_bar * sr)
        loud = _rms_db(mix[start_s:end_s])
        print(
            f"  {name}: entry bar {start_bar + 1}, exit bar {end_bar + 1}, "
            f"loudness {loud:.1f} dB"
        )

    cadence = spec.cadence_bars()
    if cadence:
        fills = ", ".join(str(b + 1) for b in sorted(cadence))
        print(f"  Fill bars: {fills}")
    else:
        print("  Fill bars: none")


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
        "--keys-sfz",
        dest="keys_sfz",
        help="Path to keys SFZ file or directory. If omitted, uses render_config.json",
    )
    ap.add_argument(
        "--pads-sfz",
        dest="pads_sfz",
        help="Path to pads SFZ file or directory. If omitted, uses render_config.json",
    )
    ap.add_argument(
        "--bass-sfz",
        dest="bass_sfz",
        help="Path to bass SFZ file or directory. If omitted, uses render_config.json",
    )
    ap.add_argument(
        "--style",
        dest="style",
        help="Arrangement style name or JSON file in assets/styles",
    )
    ap.add_argument("--minutes", type=float, help="Target duration in minutes")
    ap.add_argument(
        "--arrange",
        choices=["on", "off"],
        default="on",
        help="Toggle arrangement stage (default: on)",
    )
    ap.add_argument(
        "--outro",
        choices=["hit", "ritard"],
        default="hit",
        help="Outro style when using --minutes",
    )
    args = ap.parse_args()

    spec = SongSpec.from_json(args.spec)

    def _load_config() -> dict:
        cfg: dict = {}
        cfg_path = Path("render_config.json")
        if cfg_path.exists():
            with cfg_path.open("r", encoding="utf-8") as fh:
                cfg = json.load(fh)
        arr_path = Path("arrange_config.json")
        if arr_path.exists():
            with arr_path.open("r", encoding="utf-8") as fh:
                arr_cfg = json.load(fh)
            style_cfg = cfg.setdefault("style", {})
            for k, v in arr_cfg.items():
                if isinstance(v, dict) and isinstance(style_cfg.get(k), dict):
                    style_cfg[k].update(v)
                else:
                    style_cfg[k] = v
        return cfg

    cfg = _load_config()

    style = cfg.get("style", {})
    if args.style:
        style = load_style(args.style)
    if "swing" in style:
        spec.swing = float(style["swing"])
    if args.minutes:
        spec.outro = args.outro
        extend_sections_to_minutes(spec, args.minutes)
    spec.validate()

    stems = build_stems_for_song(spec, seed=args.seed, style=style)
    if args.arrange == "on":
        stems = arrange_song(spec, stems, style=style, seed=args.seed)

    sample_paths = dict(cfg.get("sample_paths", {}))
    if "keys" not in sample_paths and cfg.get("piano_sfz"):
        sample_paths["keys"] = cfg["piano_sfz"]

    sfz_map = {}
    for name, path in sample_paths.items():
        p = Path(path)
        if p.exists():
            sfz_map[name] = p

    def _apply_override(name: str, override: str | None) -> None:
        if override:
            p = Path(override)
            if p.is_dir():
                p = p / f"{name}.sfz"
            if p.exists():
                sfz_map[name] = p
            else:
                raise SystemExit(f"Missing SFZ instrument: {p}")

    _apply_override("keys", args.keys_sfz)
    _apply_override("pads", args.pads_sfz)
    _apply_override("bass", args.bass_sfz)

    rendered = render_song(
        stems,
        sr=44100,
        tempo=spec.tempo,
        meter=spec.meter,
        sfz_paths=sfz_map,
        style=style,
    )
    mix_audio = mix_stems(rendered, 44100, cfg)

    mix_path = Path(args.mix)
    mix_path.parent.mkdir(parents=True, exist_ok=True)
    _write_wav(mix_path, mix_audio, 44100)
    _maybe_export_mp3(mix_path)

    stem_dir = Path(args.stems)
    stem_dir.mkdir(parents=True, exist_ok=True)
    for name, audio in rendered.items():
        stem_path = stem_dir / f"{name}.wav"
        _write_wav(stem_path, audio, 44100)
        _maybe_export_mp3(stem_path)

    _print_arrangement_summary(spec, mix_audio, 44100)
