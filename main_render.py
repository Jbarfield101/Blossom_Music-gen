import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import argparse
import json
import shutil
import subprocess
import shlex
import time
import random
from pathlib import Path

import numpy as np

try:  # pragma: no cover - optional dependency
    from tqdm import tqdm  # type: ignore
except Exception:  # pragma: no cover - lightweight fallback
    class tqdm:  # type: ignore
        def __init__(self, total: int, disable: bool = False):
            self.total = total
            self.disable = disable
            self.n = 0

        def update(self, n: int = 1) -> None:
            self.n += n

        def set_description(self, desc: str) -> None:
            if not self.disable:
                print(desc)

        def close(self) -> None:  # pragma: no cover - no-op fallback
            pass

from core.song_spec import SongSpec, extend_sections_to_minutes
from core.stems import build_stems_for_song, bars_to_beats, beats_to_secs
from core.pattern_synth import build_patterns_for_song
from core import theory
from core.arranger import arrange_song
from core.render import render_song
from core.mixer import mix as mix_stems
from core.style import load_style
from core.midi_export import stems_to_midi


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


def _print_arrangement_summary(spec: SongSpec, mix: np.ndarray, sr: int) -> str:
    """Print and return a human-readable summary of the song arrangement."""

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_per_bar * beats_to_secs(spec.tempo)
    sec_map = spec.bars_by_section()

    lines = []
    for name, bar_range in sec_map.items():
        start_bar = bar_range.start
        end_bar = bar_range.stop - 1
        start_s = int(start_bar * sec_per_bar * sr)
        end_s = int((end_bar + 1) * sec_per_bar * sr)
        loud = _rms_db(mix[start_s:end_s])
        lines.append(
            f"  {name}: entry bar {start_bar + 1}, exit bar {end_bar + 1}, "
            f"loudness {loud:.1f} dB"
        )

    cadence = spec.cadence_bars()
    if cadence:
        fills = ", ".join(str(b + 1) for b in sorted(cadence))
        lines.append(f"  Fill bars: {fills}")
    else:
        lines.append("  Fill bars: none")

    summary = "Arrangement summary:\n" + "\n".join(lines)
    print("\n" + summary)
    return summary


def _rng_context() -> dict:
    py = random.getstate()
    np_state = np.random.get_state()
    return {
        "python": {
            "version": py[0],
            "state": list(py[1][:5]),
            "gauss": py[2],
        },
        "numpy": {
            "algorithm": np_state[0],
            "state": np_state[1][:5].tolist(),
            "pos": np_state[2],
        },
    }


def _log_stage(logs: list, progress: tqdm, name: str, start: float, **extra) -> None:
    entry = {
        "stage": name,
        "duration_sec": time.monotonic() - start,
        "rng": _rng_context(),
    }
    if extra:
        entry.update(extra)
    logs.append(entry)
    progress.set_description(name)
    progress.update(1)


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
        "--bundle",
        help="Directory to bundle render outputs",
    )
    ap.add_argument(
        "--bundle-stems",
        action="store_true",
        help="Include individual stem WAVs in bundle",
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
    ap.add_argument(
        "--verbose",
        action="store_true",
        help="Enable progress bar and JSON logging",
    )
    args = ap.parse_args()

    progress = tqdm(total=8, disable=not args.verbose)
    logs: list = [{"seed": args.seed}]

    t0 = time.monotonic()
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
    _log_stage(logs, progress, "spec", t0)

    t0 = time.monotonic()
    chords = spec.all_chords()
    theory.generate_satb(chords)
    _log_stage(logs, progress, "voicing", t0)

    t0 = time.monotonic()
    build_patterns_for_song(spec, seed=args.seed)
    _log_stage(logs, progress, "patterns", t0)

    t0 = time.monotonic()
    stems = build_stems_for_song(spec, seed=args.seed, style=style)
    _log_stage(logs, progress, "stems", t0)

    t0 = time.monotonic()
    if args.arrange == "on":
        stems = arrange_song(spec, stems, style=style, seed=args.seed)
    _log_stage(logs, progress, "arrange", t0)

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

    t0 = time.monotonic()
    rendered = render_song(
        stems,
        sr=44100,
        tempo=spec.tempo,
        meter=spec.meter,
        sfz_paths=sfz_map,
        style=style,
    )
    stem_peaks = {k: float(np.max(np.abs(v))) for k, v in rendered.items()}
    _log_stage(logs, progress, "render", t0, peaks=stem_peaks)

    t0 = time.monotonic()
    mix_audio = mix_stems(rendered, 44100, cfg)
    mix_peak = float(np.max(np.abs(mix_audio)))
    _log_stage(logs, progress, "mix", t0, peak=mix_peak)

    summary = _print_arrangement_summary(spec, mix_audio, 44100)

    t0 = time.monotonic()
    if args.bundle:
        bundle_dir = Path(args.bundle)
        bundle_dir.mkdir(parents=True, exist_ok=True)

        mix_path = bundle_dir / "mix.wav"
        _write_wav(mix_path, mix_audio, 44100)
        _maybe_export_mp3(mix_path)

        if args.bundle_stems:
            stem_dir = bundle_dir / "stems"
            stem_dir.mkdir(parents=True, exist_ok=True)
            for name, audio in rendered.items():
                stem_path = stem_dir / f"{name}.wav"
                _write_wav(stem_path, audio, 44100)
                _maybe_export_mp3(stem_path)

        shutil.copy(args.spec, bundle_dir / "song.json")
        stems_to_midi(stems, spec.tempo, spec.meter, bundle_dir / "stems.mid")

        with (bundle_dir / "config.json").open("w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=2)

        (bundle_dir / "arrangement.txt").write_text(summary + "\n", encoding="utf-8")

        cmdline = (
            "python "
            + Path(__file__).name
            + " "
            + " ".join(shlex.quote(a) for a in sys.argv[1:])
        )
        readme = (
            "This bundle was generated by running:\n"
            f"{cmdline}\n\n"
            "To reproduce, run the above command from the repository root."
        )
        (bundle_dir / "README.txt").write_text(readme, encoding="utf-8")
    else:
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

    _log_stage(logs, progress, "write", t0)

    progress.close()

    log_dir = Path(args.bundle) if args.bundle else Path(args.mix).parent
    log_path = log_dir / "progress.jsonl"
    with log_path.open("w", encoding="utf-8") as fh:
        for entry in logs:
            json.dump(entry, fh)
            fh.write("\n")
