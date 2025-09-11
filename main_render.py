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
from datetime import datetime

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
from core.render_hash import get_git_commit, render_hash


def _write_wav(path: Path, audio: np.ndarray, sr: int, *, comment: str | None = None) -> None:
    """Write ``audio`` to ``path`` as 16-bit PCM WAV with optional ``comment``.

    The function implements a tiny WAV writer that always produces little‑endian
    PCM data so that we can embed an ``INFO/ICMT`` metadata chunk containing the
    provided comment.  This avoids depending on external libraries for metadata
    support.
    """

    import struct

    data = np.clip(audio, -1.0, 1.0)
    if data.ndim == 1:
        data = data[:, None]
    channels = data.shape[1]
    pcm = (data * 32767).astype("<i2")
    raw = pcm.tobytes()

    fmt_chunk = b"fmt " + struct.pack(
        "<IHHIIHH", 16, 1, channels, sr, sr * channels * 2, channels * 2, 16
    )

    info_chunk = b""
    if comment:
        txt = comment.encode("utf-8")
        icmt_size = len(txt) + 1  # include null terminator
        icmt = b"ICMT" + struct.pack("<I", icmt_size) + txt + b"\x00"
        if icmt_size % 2:
            icmt += b"\x00"
        payload = b"INFO" + icmt
        if len(payload) % 2:
            payload += b"\x00"
        info_chunk = b"LIST" + struct.pack("<I", len(payload)) + payload

    data_chunk = b"data" + struct.pack("<I", len(raw)) + raw

    riff_size = 4 + len(fmt_chunk) + len(info_chunk) + len(data_chunk)
    with path.open("wb") as fh:
        fh.write(b"RIFF")
        fh.write(struct.pack("<I", riff_size))
        fh.write(b"WAVE")
        fh.write(fmt_chunk)
        if info_chunk:
            fh.write(info_chunk)
        fh.write(data_chunk)


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


def _print_arrangement_summary(spec: SongSpec, mix: np.ndarray, sr: int) -> tuple[str, dict]:
    """Print and return a human-readable summary of the song arrangement.

    The function also returns a machine-readable report describing the
    arrangement which can be serialised to JSON for test assertions or other
    tooling.
    """

    beats_per_bar = bars_to_beats(spec.meter)
    sec_per_bar = beats_per_bar * beats_to_secs(spec.tempo)
    sec_map = spec.bars_by_section()

    lines = []
    sections = []
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
        sections.append(
            {
                "name": name,
                "entry_bar": start_bar + 1,
                "exit_bar": end_bar + 1,
                "loudness_db": round(float(loud), 1),
            }
        )

    cadence = spec.cadence_bars()
    if cadence:
        fills = [b + 1 for b in sorted(cadence)]
        lines.append("  Fill bars: " + ", ".join(str(b) for b in fills))
    else:
        fills = []
        lines.append("  Fill bars: none")

    summary = "Arrangement summary:\n" + "\n".join(lines)
    print("\n" + summary)
    report = {"sections": sections, "fills": fills}
    return summary, report


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
    ap.add_argument("--spec", help="Song specification JSON")
    ap.add_argument(
        "--preset",
        help="Song template name or JSON file in assets/presets",
    )
    ap.add_argument("--seed", type=int, default=42, help="Random seed")
    ap.add_argument(
        "--sampler-seed",
        type=int,
        default=0,
        help="Seed for phrase model sampling",
    )
    ap.add_argument(
        "--use-phrase-model",
        choices=["auto", "yes", "no"],
        default="auto",
        help="Use neural phrase models: auto, yes, or no (default: auto)",
    )
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
        nargs="?",
        const=True,
        help="Directory to bundle render outputs",
    )
    ap.add_argument(
        "--mix-preset",
        dest="mix_preset",
        help="Mixing preset name or JSON file in assets/presets",
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
    ap.add_argument("--mix-config", dest="mix_config", help="Extra mix config JSON")
    ap.add_argument(
        "--arrange-config",
        dest="arrange_config",
        help="Extra arrangement config JSON",
    )
    ap.add_argument("--minutes", type=float, help="Target duration in minutes")
    ap.add_argument(
        "--arrange",
        choices=["on", "off"],
        default="on",
        help="Toggle arrangement stage (default: on)",
    )
    ap.add_argument(
        "--melody-midi",
        dest="melody_midi",
        help="Path to a melody MIDI file to merge before arrangement",
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
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip audio rendering and write MIDI only",
    )
    ap.add_argument(
        "--preview",
        type=int,
        metavar="N",
        help="Render only the first N bars",
    )
    args = ap.parse_args()

    if args.bundle is True:
        default_dir = Path("export") / f"Render_{datetime.now().strftime('%Y%m%d_%H%M')}"
        args.bundle = str(default_dir)

    if not args.spec and not args.preset:
        ap.error("either --spec or --preset is required")

    logs: list = [{"seed": args.seed, "sampler_seed": args.sampler_seed}]

    t0 = time.monotonic()
    if args.preset:
        from core.song_templates import load_song_template

        spec = SongSpec.from_dict(load_song_template(args.preset))
    else:
        spec = SongSpec.from_json(args.spec)

    def _load_json(path: Path) -> dict:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _merge(dst: dict, src: dict) -> None:
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                _merge(dst[k], v)
            else:
                dst[k] = v

    def _load_config() -> tuple[dict, dict]:
        cfg: dict = {}
        style: dict = {}

        if args.mix_preset:
            from core.preset import load_preset

            cfg = dict(load_preset(args.mix_preset))
        else:
            cfg_path = Path("render_config.json")
            if cfg_path.exists():
                cfg = _load_json(cfg_path)

        if args.mix_config:
            _merge(cfg, _load_json(Path(args.mix_config)))

        if args.style:
            style = dict(load_style(args.style))
        else:
            arr_path = Path("arrange_config.json")
            if arr_path.exists():
                style = _load_json(arr_path)

        if args.arrange_config:
            _merge(style, _load_json(Path(args.arrange_config)))

        return cfg, style

    cfg, style = _load_config()

    if "swing" in style:
        spec.swing = float(style["swing"])
    if args.minutes:
        spec.outro = args.outro
        extend_sections_to_minutes(spec, args.minutes)
    spec.validate()

    cfg["style"] = style
    if args.bundle or args.verbose:
        print(json.dumps(cfg, indent=2))

    total_steps = 8 if not args.dry_run else 6
    if args.melody_midi:
        total_steps += 1
    progress = tqdm(total=total_steps, disable=not args.verbose)

    _log_stage(logs, progress, "spec", t0)

    t0 = time.monotonic()
    chords = spec.all_chords()
    theory.generate_satb(chords)
    _log_stage(logs, progress, "voicing", t0)

    t0 = time.monotonic()
    build_patterns_for_song(
        spec,
        seed=args.seed,
        sampler_seed=args.sampler_seed,
        verbose=args.verbose,
        use_phrase_model=args.use_phrase_model,
    )
    _log_stage(logs, progress, "patterns", t0)

    t0 = time.monotonic()
    stems = build_stems_for_song(spec, seed=args.seed, style=style)
    _log_stage(logs, progress, "stems", t0)

    if args.melody_midi:
        from core.midi_load import load_melody_midi

        t0 = time.monotonic()
        melody, m_tempo, m_meter = load_melody_midi(Path(args.melody_midi))
        if abs(m_tempo - float(spec.tempo)) > 1e-3 or m_meter != spec.meter:
            raise SystemExit("Melody MIDI tempo/meter mismatch")
        stems["melody"] = melody
        _log_stage(logs, progress, "melody", t0)

    t0 = time.monotonic()
    if args.arrange == "on":
        stems = arrange_song(spec, stems, style=style, seed=args.seed)
    _log_stage(logs, progress, "arrange", t0)

    if args.preview:
        max_beats = args.preview * bars_to_beats(spec.meter)
        for notes in stems.values():
            new_notes = []
            for n in notes:
                if n.start >= max_beats:
                    break
                if n.start + n.dur > max_beats:
                    n.dur = max_beats - n.start
                new_notes.append(n)
            notes[:] = new_notes

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
    commit = get_git_commit()
    rhash = render_hash(spec, cfg, sfz_map, args.seed, args.minutes, commit)
    logs.append({"stage": "hash", "hash": rhash, "commit": commit})

    if not args.dry_run:
        rendered = render_song(
            stems,
            sr=44100,
            tempo=spec.tempo,
            meter=spec.meter,
            sfz_paths=sfz_map,
            style=style,
        )
        stem_peaks = {k: float(np.max(np.abs(v))) for k, v in rendered.items()}
        if args.preview:
            max_samples = int(
                args.preview
                * bars_to_beats(spec.meter)
                * beats_to_secs(spec.tempo)
                * 44100
            )
            for k, v in rendered.items():
                rendered[k] = v[:max_samples]
        _log_stage(logs, progress, "render", t0, peaks=stem_peaks)

        t0 = time.monotonic()
        mix_audio = mix_stems(rendered, 44100, cfg)
        mix_peak = float(np.max(np.abs(mix_audio)))
        _log_stage(logs, progress, "mix", t0, peak=mix_peak)

        summary, arrange_report = _print_arrangement_summary(spec, mix_audio, 44100)

        t0 = time.monotonic()
        if args.bundle:
            bundle_dir = Path(args.bundle)
            bundle_dir.mkdir(parents=True, exist_ok=True)

            mix_path = bundle_dir / "mix.wav"
            _write_wav(mix_path, mix_audio, 44100, comment=rhash)
            _maybe_export_mp3(mix_path)

            if args.bundle_stems:
                stem_dir = bundle_dir / "stems"
                stem_dir.mkdir(parents=True, exist_ok=True)
                for name, audio in rendered.items():
                    stem_path = stem_dir / f"{name}.wav"
                    _write_wav(stem_path, audio, 44100, comment=rhash)
                    _maybe_export_mp3(stem_path)

            if args.spec:
                shutil.copy(args.spec, bundle_dir / "song.json")
            else:
                with (bundle_dir / "song.json").open("w", encoding="utf-8") as fh:
                    json.dump(spec.to_dict(), fh, indent=2)
            stems_to_midi(stems, spec.tempo, spec.meter, bundle_dir / "stems.mid")

            with (bundle_dir / "render_config.json").open("w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2)

            (bundle_dir / "arrangement.txt").write_text(summary + "\n", encoding="utf-8")
            with (bundle_dir / "arrange_report.json").open("w", encoding="utf-8") as fh:
                json.dump(arrange_report, fh, indent=2)

            cmdline = (
                "python "
                + Path(__file__).name
                + " "
                + " ".join(shlex.quote(a) for a in sys.argv[1:])
            )
            readme = (
                "This bundle was generated by running:\n"
                f"{cmdline}\n\n"
                "To reproduce, run the above command from the repository root.\n\n"
                f"Commit: {commit}\n"
                f"Render hash: {rhash}\n"
            )
            (bundle_dir / "README.txt").write_text(readme, encoding="utf-8")
        else:
            mix_path = Path(args.mix)
            mix_path.parent.mkdir(parents=True, exist_ok=True)
            _write_wav(mix_path, mix_audio, 44100, comment=rhash)
            _maybe_export_mp3(mix_path)

            stem_dir = Path(args.stems)
            stem_dir.mkdir(parents=True, exist_ok=True)
            for name, audio in rendered.items():
                stem_path = stem_dir / f"{name}.wav"
                _write_wav(stem_path, audio, 44100, comment=rhash)
                _maybe_export_mp3(stem_path)

        _log_stage(logs, progress, "write", t0)

        progress.close()

        log_dir = Path(args.bundle) if args.bundle else Path(args.mix).parent
    else:
        t0 = time.monotonic()
        if args.bundle:
            bundle_dir = Path(args.bundle)
            bundle_dir.mkdir(parents=True, exist_ok=True)
            if args.spec:
                shutil.copy(args.spec, bundle_dir / "song.json")
            else:
                with (bundle_dir / "song.json").open("w", encoding="utf-8") as fh:
                    json.dump(spec.to_dict(), fh, indent=2)
            stems_to_midi(stems, spec.tempo, spec.meter, bundle_dir / "stems.mid")
            with (bundle_dir / "render_config.json").open("w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2)
            cmdline = (
                "python "
                + Path(__file__).name
                + " "
                + " ".join(shlex.quote(a) for a in sys.argv[1:])
            )
            readme = (
                "This bundle was generated by running:\n"
                f"{cmdline}\n\n"
                "To reproduce, run the above command from the repository root.\n\n"
                f"Commit: {commit}\n"
                f"Render hash: {rhash}\n"
            )
            (bundle_dir / "README.txt").write_text(readme, encoding="utf-8")
            log_dir = bundle_dir
        else:
            stem_dir = Path(args.stems)
            stem_dir.mkdir(parents=True, exist_ok=True)
            stems_to_midi(stems, spec.tempo, spec.meter, stem_dir / "stems.mid")
            log_dir = stem_dir
        _log_stage(logs, progress, "write", t0)
        progress.close()

    log_path = log_dir / "progress.jsonl"
    with log_path.open("w", encoding="utf-8") as fh:
        for entry in logs:
            json.dump(entry, fh)
            fh.write("\n")
