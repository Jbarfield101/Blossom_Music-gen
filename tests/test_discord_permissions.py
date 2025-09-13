import os
import sys
import types
from unittest.mock import MagicMock, AsyncMock

import pytest

# Skip tests if discord.py is not installed
pytest.importorskip("discord")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

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


@pytest.mark.asyncio
async def test_permission_check(tmp_path):
    cfg = tmp_path / "discord.yaml"
    _write_config(cfg)
    discord_config.PERMISSIONS_FILE = cfg
    discord_config._RULE_CACHE = None

    bot = BlossomBot()
    interaction = _make_interaction("npc", channel_id=2, role_ids=[3])
    allowed = await bot._permission_check(interaction)
    assert not allowed
    interaction.response.send_message.assert_called_once()

    interaction_ok = _make_interaction("npc", channel_id=1, role_ids=[2])
    allowed_ok = await bot._permission_check(interaction_ok)
    assert allowed_ok
