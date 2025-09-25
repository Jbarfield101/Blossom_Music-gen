import asyncio
import os
import sys
import types
from unittest.mock import MagicMock, AsyncMock

import pytest

# Skip tests if discord.py is not installed
pytest.importorskip("discord")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import discord_bot
from discord_bot import BlossomBot
import config.discord as discord_config
sys.modules.setdefault(
    "config.discord_profiles", types.SimpleNamespace(get_profile=lambda g, c: {}, set_profile=lambda g,c,p: None)
)


def _write_config(path):
    path.write_text(
        """npc:\n  channels: [1]\n  roles: [2]\n""",
        encoding="utf-8",
    )


def _make_interaction(cmd_name, channel_id=1, role_ids=None):
    interaction = MagicMock()
    interaction.command = MagicMock()
    interaction.command.qualified_name = cmd_name
    interaction.channel = MagicMock(id=channel_id)
    interaction.user = MagicMock()
    interaction.user.roles = [MagicMock(id=r) for r in (role_ids or [])]
    interaction.response = MagicMock()
    interaction.response.send_message = AsyncMock()
    return interaction


def test_load_permissions(tmp_path):
    cfg = tmp_path / "discord.yaml"
    _write_config(cfg)
    discord_config.PERMISSIONS_FILE = cfg
    discord_config._RULE_CACHE = None
    rules = discord_config.get_permission_rules()
    assert rules == {"npc": {"channels": [1], "roles": [2]}}


def test_permission_check(tmp_path):
    cfg = tmp_path / "discord.yaml"
    _write_config(cfg)
    discord_config.PERMISSIONS_FILE = cfg
    discord_config._RULE_CACHE = None

    bot = BlossomBot()
    interaction = _make_interaction("npc", channel_id=2, role_ids=[3])
    allowed = asyncio.run(bot._permission_check(interaction))
    assert not allowed
    interaction.response.send_message.assert_called_once()

    interaction_ok = _make_interaction("npc", channel_id=1, role_ids=[2])
    allowed_ok = asyncio.run(bot._permission_check(interaction_ok))
    assert allowed_ok


def test_commands_list_includes_all_entries():
    bot = BlossomBot()
    interaction = MagicMock()
    interaction.response = MagicMock()
    interaction.response.send_message = AsyncMock()

    asyncio.run(bot.commands_list.callback(bot, interaction))

    interaction.response.send_message.assert_called_once()
    args, kwargs = interaction.response.send_message.call_args
    message = args[0]
    assert "Available Blossom commands" in message
    for syntax, description in discord_bot.COMMAND_SUMMARIES:
        assert syntax in message
        assert description in message
    assert kwargs.get("ephemeral") is True


def test_npcs_lists_known_characters(monkeypatch):
    bot = BlossomBot()
    interaction = MagicMock()
    interaction.response = MagicMock()
    interaction.response.send_message = AsyncMock()

    monkeypatch.setattr(
        discord_bot.service_api,
        "list_npcs",
        lambda: [
            {"aliases": ["Aelar", "Prince of Autumn"], "fields": {"voice": "soft"}},
            {"aliases": ["Brakka"], "fields": {}},
        ],
    )

    asyncio.run(bot.npcs.callback(bot, interaction))

    interaction.response.send_message.assert_called_once()
    args, kwargs = interaction.response.send_message.call_args
    message = args[0]
    assert "Known NPCs" in message
    assert "Aelar" in message
    assert "voice: soft" in message
    assert kwargs.get("ephemeral") is True


def test_lore_entries_lists_summaries(monkeypatch):
    bot = BlossomBot()
    interaction = MagicMock()
    interaction.response = MagicMock()
    interaction.response.send_message = AsyncMock()

    monkeypatch.setattr(
        discord_bot.service_api,
        "list_lore",
        lambda: [
            {"title": "Ancient Tome", "summary": "Forgotten rituals."},
            {"path": "lore/dragons.md", "summary": ""},
        ],
    )

    asyncio.run(bot.lore_entries.callback(bot, interaction))

    interaction.response.send_message.assert_called_once()
    args, kwargs = interaction.response.send_message.call_args
    message = args[0]
    assert "Lore entries" in message
    assert "Ancient Tome" in message
    assert "Forgotten rituals" in message
    assert "dragons" in message
    assert kwargs.get("ephemeral") is True
