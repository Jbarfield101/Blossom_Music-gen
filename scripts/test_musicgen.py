"""Minimal MusicGen smoke test.

This script downloads the pre-trained ``facebook/musicgen-small`` model on
first use and generates a short audio clip from a text prompt.  The output is
saved to ``musicgen_sample.wav`` in the current directory.
"""

from pathlib import Path

from scipy.io.wavfile import write as write_wav
from transformers import pipeline


DEFAULT_PROMPT = "lofi hip hop beat for studying"


def main(prompt: str = DEFAULT_PROMPT) -> Path:
    """Generate a short audio clip from ``prompt`` and return the output path."""

    pipe = pipeline("text-to-audio", model="facebook/musicgen-small")
    result = pipe(prompt)
    audio = result[0]["audio"]
    sample_rate = result[0]["sampling_rate"]
    out_path = Path("musicgen_sample.wav")
    write_wav(out_path, sample_rate, audio)
    print(f"Saved {out_path}")
    return out_path


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
