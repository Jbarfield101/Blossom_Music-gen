"""Tests for the Discord token helpers."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import discord_token


@pytest.fixture(autouse=True)
def reset_token_cache() -> None:
    """Ensure the module-level token cache is cleared between tests."""

    discord_token._TOKEN = None
    yield
    discord_token._TOKEN = None


def _write_secrets(path: Path, token: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"discord": {"botToken": token}}), encoding="utf-8")


def test_get_token_from_project_root_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The project-root ``secrets.json`` is used when no token file exists."""

    monkeypatch.setattr(discord_token, "TOKEN_FILE", tmp_path / "discord_token.txt")
    monkeypatch.setattr(discord_token, "PROJECT_ROOT", tmp_path)

    _write_secrets(tmp_path / "secrets.json", "abc123")

    assert discord_token.get_token() == "abc123"

    # Cache is honored even if the secrets file changes on disk.
    _write_secrets(tmp_path / "secrets.json", "changed")
    assert discord_token.get_token() == "abc123"


def test_get_token_from_tauri_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Fallback to the Tauri store secrets when present."""

    monkeypatch.setattr(discord_token, "TOKEN_FILE", tmp_path / "config" / "discord_token.txt")
    monkeypatch.setattr(discord_token, "PROJECT_ROOT", tmp_path / "project")

    data_dir = tmp_path / "appdata"
    home_dir = tmp_path / "home"
    home_dir.mkdir()

    monkeypatch.setenv("XDG_DATA_HOME", str(data_dir))
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setenv("HOME", str(home_dir))

    secrets_path = data_dir / discord_token.TAURI_IDENTIFIER / discord_token.SECRETS_FILE_NAME
    _write_secrets(secrets_path, "store-token")

    assert discord_token.get_token() == "store-token"
