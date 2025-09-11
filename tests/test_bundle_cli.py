import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


def _write_spec(path: Path) -> None:
    spec = {
        "title": "BundleTest",
        "tempo": 120,
        "meter": "4/4",
        "sections": [{"name": "A", "length": 1}],
        "harmony_grid": [{"section": "A", "chords": ["C"]}],
        "density_curve": {"A": 1.0},
        "register_policy": {
            "drums": [36, 50],
            "bass": [40, 60],
            "keys": [60, 72],
            "pads": [60, 72],
        },
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(spec, fh)


def test_bundle_creation(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    bundle_dir = tmp_path / "bundle"
    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--bundle",
        str(bundle_dir),
        "--bundle-stems",
        "--arrange",
        "off",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    assert (bundle_dir / "song.json").exists()
    assert (bundle_dir / "stems.mid").exists()
    assert (bundle_dir / "mix.wav").exists()
    assert (bundle_dir / "arrangement.txt").exists()
    report_path = bundle_dir / "arrange_report.json"
    assert report_path.exists()
    with report_path.open() as fh:
        report = json.load(fh)
    assert isinstance(report.get("sections"), list)
    assert isinstance(report.get("fills"), list)
    assert (bundle_dir / "render_config.json").exists()
    assert (bundle_dir / "README.txt").exists()
    if (bundle_dir / "stems").exists():
        assert any((bundle_dir / "stems").glob("*.wav"))

    log_path = bundle_dir / "progress.jsonl"
    assert log_path.exists()
    with log_path.open() as fh:
        entries = [json.loads(line) for line in fh]
    rhash = next(e["hash"] for e in entries if "hash" in e)
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo_root
    ).decode().strip()

    with (bundle_dir / "render_config.json").open() as fh:
        cfg = json.load(fh)
    loud = cfg.get("loudness_lufs")
    assert isinstance(loud, (float, int))
    mix_entry = next(e for e in entries if e.get("stage") == "mix")
    assert mix_entry.get("loudness_lufs") == pytest.approx(loud, abs=0.1)

    readme_text = (bundle_dir / "README.txt").read_text()
    assert rhash in readme_text
    assert commit in readme_text
    assert f"Loudness: {loud:.1f} LUFS" in readme_text

    metrics_path = bundle_dir / "metrics.json"
    assert metrics_path.exists()
    with metrics_path.open() as fh:
        metrics = json.load(fh)
    assert "chord_tone_coverage" in metrics
    assert "audio_stats" in metrics
    assert "hash" in metrics
    assert "duration" in metrics
    assert "section_counts" in metrics

    mix_bytes = (bundle_dir / "mix.wav").read_bytes()
    idx = mix_bytes.find(b"ICMT")
    assert idx != -1
    size = int.from_bytes(mix_bytes[idx + 4 : idx + 8], "little")
    comment = mix_bytes[idx + 8 : idx + 8 + size].rstrip(b"\x00").decode("utf-8")
    assert comment == rhash

    stems_dir = bundle_dir / "stems"
    stem_files = list(stems_dir.glob("*.wav"))
    if stem_files:
        b = stem_files[0].read_bytes()
        idx = b.find(b"ICMT")
        assert idx != -1
        size = int.from_bytes(b[idx + 4 : idx + 8], "little")
        stem_comment = b[idx + 8 : idx + 8 + size].rstrip(b"\x00").decode("utf-8")
        assert stem_comment == rhash

    mix_path = tmp_path / "mix.wav"
    stems_dir = tmp_path / "stems"
    cmd2 = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--mix",
        str(mix_path),
        "--stems",
        str(stems_dir),
        "--arrange",
        "off",
    ]
    subprocess.run(cmd2, cwd=repo_root, check=True)
    assert mix_path.exists()
    assert any(stems_dir.glob("*.wav"))

    log_path2 = mix_path.parent / "progress.jsonl"
    with log_path2.open() as fh:
        entries2 = [json.loads(line) for line in fh]
    rhash2 = next(e["hash"] for e in entries2 if "hash" in e)
    data = mix_path.read_bytes()
    idx = data.find(b"ICMT")
    assert idx != -1
    size = int.from_bytes(data[idx + 4 : idx + 8], "little")
    comment2 = data[idx + 8 : idx + 8 + size].rstrip(b"\x00").decode("utf-8")
    assert comment2 == rhash2
    stem_file2 = next(stems_dir.glob("*.wav"))
    b2 = stem_file2.read_bytes()
    idx2 = b2.find(b"ICMT")
    assert idx2 != -1
    size2 = int.from_bytes(b2[idx2 + 4 : idx2 + 8], "little")
    comment_stem2 = b2[idx2 + 8 : idx2 + 8 + size2].rstrip(b"\x00").decode("utf-8")
    assert comment_stem2 == rhash2


def test_bundle_default_path(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]
    spec_path = tmp_path / "spec.json"
    _write_spec(spec_path)

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    export_root = repo_root / "export"
    if export_root.exists():
        shutil.rmtree(export_root)

    cmd = [
        str(py310),
        "main_render.py",
        "--spec",
        str(spec_path),
        "--bundle",
        "--arrange",
        "off",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    bundles = list(export_root.glob("Render_*"))
    assert len(bundles) == 1
    bundle_dir = bundles[0]
    assert (bundle_dir / "render_config.json").exists()
    assert (bundle_dir / "mix.wav").exists()

    shutil.rmtree(export_root)


def test_bundle_with_preset(tmp_path):
    repo_root = Path(__file__).resolve().parents[1]

    py310 = Path(sys.executable).resolve().parent.parent / "3.10.17/bin/python"
    if not py310.exists():
        pytest.skip("python3.10 not available")

    bundle_dir = tmp_path / "bundle"
    cmd = [
        str(py310),
        "main_render.py",
        "--preset",
        "lofi_loop",
        "--bundle",
        str(bundle_dir),
        "--arrange",
        "off",
    ]
    subprocess.run(cmd, cwd=repo_root, check=True)

    song_json = bundle_dir / "song.json"
    assert song_json.exists()
    with song_json.open() as fh:
        data = json.load(fh)
    assert data.get("title") == "Lofi Loop"
    assert (bundle_dir / "mix.wav").exists()
