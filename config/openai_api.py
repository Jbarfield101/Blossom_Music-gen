from __future__ import annotations

"""Helpers for retrieving the configured OpenAI API key."""

import os
from typing import Optional

from . import secrets as secrets_cfg

__all__ = ["get_api_key"]

_API_KEY: Optional[str] = None


def get_api_key(force_reload: bool = False) -> Optional[str]:
    """Return the OpenAI API key from the environment or ``secrets.json``."""

    global _API_KEY
    if not force_reload and _API_KEY:
        return _API_KEY

    key = os.getenv("OPENAI_API_KEY")
    if isinstance(key, str):
        key = key.strip()
        if key:
            os.environ["OPENAI_API_KEY"] = key
            _API_KEY = key
            return key

    secrets = secrets_cfg.load_secrets()
    section = secrets.get("openai")
    if isinstance(section, dict):
        token = section.get("apiKey")
        if isinstance(token, str):
            token = token.strip()
            if token:
                os.environ["OPENAI_API_KEY"] = token
                _API_KEY = token
                return token

    return None
