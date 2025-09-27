"""Piper text-to-speech backend."""

from __future__ import annotations

import io
import subprocess
from typing import Iterable, Optional
import tempfile
import os

import numpy as np
import soundfile as sf

from ..registry import VoiceProfile
from ..tts import TTSBackend


class PiperBackend(TTSBackend):
    """Wrapper around the Piper TTS system."""

    def __init__(self, model_path: str, config_path: Optional[str] = None, executable: str = "piper") -> None:
        self.model_path = model_path
        self.config_path = config_path
        self.executable = executable

    def synthesize(self, text: str, voice: VoiceProfile) -> np.ndarray:
        model = voice.voice_id or self.model_path

        # Write to a temporary WAV file to avoid the Python piper CLI trying to play audio to speakers.
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav_path = tmp.name
        try:
            cmd = [self.executable, "--model", str(model), "--output_file", wav_path]
            if self.config_path:
                cmd.extend(["--config", str(self.config_path)])

            # Some piper variants expect text last; pass text on stdin which is supported by both binary and module CLIs.
            subprocess.run(
                cmd,
                input=text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

            audio, _ = sf.read(wav_path, dtype="float32")
            return audio
        finally:
            try:
                os.remove(wav_path)
            except Exception:
                pass

    # ------------------------------------------------------------------
    def warm_start(self, voices: Optional[Iterable[str]] = None) -> None:
        """Pre-load one or more voice models."""

        targets = list(voices) if voices is not None else [self.model_path]
        for model in targets:
            cmd = [self.executable, "--model", str(model)]
            if self.config_path:
                cmd.extend(["--config", str(self.config_path)])
            try:  # pragma: no cover - warm start is best-effort
                subprocess.run(cmd, input=b"warm start", stdout=subprocess.PIPE, check=True)
            except Exception:
                continue
