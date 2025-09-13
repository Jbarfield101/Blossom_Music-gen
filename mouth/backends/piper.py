"""Piper text-to-speech backend."""

from __future__ import annotations

import io
import subprocess
from typing import Optional

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

        cmd = [self.executable, "--model", str(model)]
        if self.config_path:
            cmd.extend(["--config", str(self.config_path)])

        proc = subprocess.run(
            cmd,
            input=text.encode("utf-8"),
            stdout=subprocess.PIPE,
            check=True,
        )

        audio, _ = sf.read(io.BytesIO(proc.stdout), dtype="float32")
        return audio
