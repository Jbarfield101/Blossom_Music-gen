from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

try:
    # Lazy imports to keep repo usable without diffusers installed
    from diffusers import (
        StableDiffusionPipeline,
        EulerAncestralDiscreteScheduler,
    )
    import torch
    _HAS_DIFFUSERS = True
except Exception:
    _HAS_DIFFUSERS = False
    StableDiffusionPipeline = object  # type: ignore
    DPMSolverMultistepScheduler = object  # type: ignore
    torch = None  # type: ignore

from PIL import Image


@dataclass
class RiffusionConfig:
    model: str = os.environ.get("RIFFUSION_MODEL", "riffusion/riffusion-model-v1")
    device: Optional[str] = None  # e.g. "cuda", "cpu"; None = auto
    dtype: Optional[str] = None   # e.g. "float16", "float32"; None = auto
    # Allow enabling safety checker via env: set RIFFUSION_DISABLE_SAFETY=0 to keep it enabled
    disable_safety: bool = os.environ.get("RIFFUSION_DISABLE_SAFETY", "1") != "0"


class RiffusionPipelineWrapper:
    """Thin wrapper around a Diffusers text-to-image pipeline for Riffusion.

    Riffusion treats generated images as spectrogram tiles. This wrapper only
    concerns image generation; conversion to/from audio is handled elsewhere.
    """

    def __init__(self, cfg: Optional[RiffusionConfig] = None):
        if cfg is None:
            cfg = RiffusionConfig()
        self.cfg = cfg
        self._pipe = None

    def _autodetect_device(self) -> str:
        if not _HAS_DIFFUSERS:
            return "cpu"
        if self.cfg.device:
            return self.cfg.device
        if torch.cuda.is_available():  # type: ignore[attr-defined]
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():  # type: ignore[attr-defined]
            return "mps"
        return "cpu"

    def _autodetect_dtype(self):
        if not _HAS_DIFFUSERS:
            return None
        if self.cfg.dtype:
            return getattr(torch, self.cfg.dtype)
        device = self._autodetect_device()
        if device == "cuda":
            return torch.float16
        return torch.float32

    def load(self):
        if not _HAS_DIFFUSERS:
            raise RuntimeError(
                "diffusers/torch not installed. Install diffusers, torch, and safetensors."
            )
        if self._pipe is not None:
            return
        dtype = self._autodetect_dtype()
        kwargs = {}
        if self.cfg.disable_safety:
            kwargs["safety_checker"] = None
        # Avoid safetensors lookup spam on models that only provide pickled weights
        kwargs["use_safetensors"] = False
        pipe = StableDiffusionPipeline.from_pretrained(self.cfg.model, **kwargs)
        # Use Euler Ancestral scheduler for riffusion-style generations
        pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        device = self._autodetect_device()
        try:
            pipe = pipe.to(device=device, dtype=dtype)
        except Exception:
            pipe = pipe.to(device)
        # Reduce console noise; our job system emits its own progress
        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:
            pass
        # Older pipelines may still carry safety checker attributes
        if hasattr(pipe, "safety_checker"):
            pipe.safety_checker = None
        self._pipe = pipe

    @property
    def is_loaded(self) -> bool:
        return self._pipe is not None

    def generate_tile(
        self,
        prompt: str,
        negative_prompt: Optional[str] = None,
        seed: Optional[int] = None,
        steps: int = 30,
        guidance_scale: float = 7.0,
        width: int = 512,
        height: int = 512,
    ) -> Image.Image:
        """Generate a single spectrogram tile image from a text prompt."""
        if self._pipe is None:
            self.load()
        assert self._pipe is not None
        generator = None
        if seed is not None and _HAS_DIFFUSERS:
            generator = torch.Generator(device=self._autodetect_device()).manual_seed(seed)  # type: ignore
        out = self._pipe(
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=int(steps),
            guidance_scale=float(guidance_scale),
            width=int(width),
            height=int(height),
            generator=generator,
        )
        img = out.images[0]
        if not isinstance(img, Image.Image):
            img = Image.fromarray(img)
        return img
