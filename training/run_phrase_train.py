import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--midis", nargs="+", required=True, help="MIDI files to include in the dataset")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--lr", type=float, default=0.001)  # unused but kept for interface compatibility
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        midi_dir = tmp_path / "midis"
        midi_dir.mkdir()
        for midi in args.midis:
            src = Path(midi)
            if src.exists():
                shutil.copy(src, midi_dir / src.name)
        build_cmd = [
            "data/build_dataset.py",
            "--midi-dir",
            str(midi_dir),
            "--out-dir",
            str(tmp_path),
        ]
        subprocess.run([sys.executable] + build_cmd, check=True)
        print("build: 100% dataset built")
        sys.stdout.flush()

        train_cmd = [
            "training/phrase_models/train_phrase_models.py",
            "--train",
            str(tmp_path / "train.jsonl"),
            "--val",
            str(tmp_path / "val.jsonl"),
            "--epochs",
            str(args.epochs),
        ]
        subprocess.run([sys.executable] + train_cmd, check=True)
        print("train: 100% done")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
