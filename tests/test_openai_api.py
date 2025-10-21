"""Tests for the OpenAI API key helper."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import openai_api, secrets  # noqa: E402


@pytest.fixture(autouse=True)
def reset_openai_cache() -> None:
    """Clear the cached API key before and after each test."""

    openai_api._API_KEY = None
    yield
    openai_api._API_KEY = None


def test_get_api_key_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Environment variable takes precedence."""

    monkeypatch.setenv("OPENAI_API_KEY", "  sk-secret-env  ")
    assert openai_api.get_api_key(force_reload=True) == "sk-secret-env"
    monkeypatch.delenv("OPENAI_API_KEY")


def test_get_api_key_from_secrets_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fall back to secrets.json when the environment is unset."""

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(secrets, "PROJECT_ROOT", tmp_path)
    (tmp_path / "secrets.json").write_text(
        json.dumps({"openai": {"apiKey": "sk-from-secrets"}}),
        encoding="utf-8",
    )

    assert openai_api.get_api_key(force_reload=True) == "sk-from-secrets"
