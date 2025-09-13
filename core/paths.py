"""Centralized filesystem paths used throughout the project."""

from pathlib import Path

# Path to the directory holding all model files. Ensure the directory exists
# so callers can rely on its presence without performing their own checks.
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

__all__ = ["MODEL_DIR"]

