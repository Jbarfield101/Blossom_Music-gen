"""Minimal MusicGen smoke test.

This script downloads the pre-trained ``facebook/musicgen-small`` model on
first use and generates a short audio clip from a text prompt.  The output is
saved to ``out/musicgen_sample.wav`` in the current directory.
"""

from pathlib import Path

from scipy.io.wavfile import write as write_wav
from transformers import pipeline
from tqdm import tqdm


DEFAULT_PROMPT = "lofi hip hop beat for studying"


def main(prompt: str = DEFAULT_PROMPT) -> Path:
    """Generate a short audio clip from ``prompt`` and return the output path."""

    with tqdm(total=3, leave=False) as progress:
        progress.set_description("Loading model")
        pipe = pipeline("text-to-audio", model="facebook/musicgen-small")
        progress.update()

        progress.set_description("Generating audio")
        result = pipe(prompt)
        progress.update()

        audio = result[0]["audio"]
        sample_rate = result[0]["sampling_rate"]
        out_path = Path("out") / "musicgen_sample.wav"
        out_path.parent.mkdir(parents=True, exist_ok=True)

        progress.set_description("Writing file")
        write_wav(out_path, sample_rate, audio)
        progress.update()

    print(f"Saved {out_path}")
    return out_path


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()
