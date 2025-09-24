import os
import asyncio
from typing import List

import discord
from discord.ext import commands
from discord import app_commands
import requests

import service_api
from brain import dialogue
from mouth.registry import VoiceRegistry
from config.discord import get_permission_rules
from config.discord_profiles import get_profile, set_profile
from config.discord_token import get_token
import session_export


COMMAND_SUMMARIES = [
    ("/npc <alias[: message]>", "Fetch NPC info or speak in their voice."),
    ("/lore <query>", "Query lore notes and generate a response."),
    ("/note <path> <text>", "Append a timestamped entry to a note."),
    ("/track <stat> <delta>", "Update a combat tracker statistic."),
    ("/commands", "List Blossom's available slash commands."),
    ("/scene as <voice>", "Switch the narrator TTS voice."),
    ("/export session", "Export the current session log."),
]


class BlossomBot(commands.Bot):
    """Discord bot providing slash commands for lore and note management."""

    scene_group = app_commands.Group(name="scene", description="Scene related commands")
    export_group = app_commands.Group(name="export", description="Export utilities")

    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)
        self.voice_registry = VoiceRegistry()
        self.permissions = get_permission_rules()
        self.tree.interaction_check = self._permission_check

    async def setup_hook(self) -> None:  # pragma: no cover - Discord runtime
        """Register slash commands once the bot is ready."""
        self.tree.add_command(self.npc)
        self.tree.add_command(self.lore)
        self.tree.add_command(self.note)
        self.tree.add_command(self.track)
        self.tree.add_command(self.commands_list)
        self.tree.add_command(self.scene_group)
        self.tree.add_command(self.export_group)

        guild_id = os.getenv("DISCORD_GUILD_ID")
        if guild_id:
            guild: discord.abc.Snowflake | None = None
            try:
                guild_id_int = int(guild_id)
            except ValueError:
                guild_id_int = None
            else:
                # Prefer an actual guild object so commands mirror instantly.
                try:
                    guild = self.get_guild(guild_id_int)
                    if guild is None:
                        guild = await self.fetch_guild(guild_id_int)
                except discord.DiscordException:
                    guild = None
                if guild is None:
                    guild = discord.Object(id=guild_id_int)

            if guild is not None:
                if isinstance(guild, discord.Guild):
                    self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)

        await self.tree.sync()

    # ------------------------------------------------------------------
    @app_commands.command(name="npc", description="Fetch NPC info or speak in their voice")
    @app_commands.describe(query="NPC alias optionally followed by ':' and dialogue")
    async def npc(self, interaction: discord.Interaction, query: str) -> None:
        """Handle the ``/npc`` command."""
        try:
            npcs = service_api.list_npcs()
        except Exception as exc:
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return

        parts = query.split(":", 1)
        name = parts[0].strip()
        message = parts[1].strip() if len(parts) > 1 else None
        npc = next(
            (
                n
                for n in npcs
                if name.lower() in [a.lower() for a in n.get("aliases", [])]
            ),
            None,
        )
        if npc is None:
            aliases: List[str] = [a for n in npcs for a in n.get("aliases", [])]
            await interaction.response.send_message(
                f"Unknown NPC '{name}'. Known NPCs: {', '.join(aliases)}",
                ephemeral=True,
            )
            return

        if not message:
            fields = npc.get("fields", {})
            info = "\n".join(f"{k}: {v}" for k, v in fields.items()) or "No info available."
            await interaction.response.send_message(info)
            return

        try:
            reply = dialogue.respond(message)
        except Exception as exc:  # pragma: no cover - runtime errors
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return
        await interaction.response.send_message(str(reply))

    # ------------------------------------------------------------------
    @app_commands.command(
        name="lore", description="Query lore notes and generate a response"
    )
    @app_commands.describe(query="Lore question or prompt")
    async def lore(self, interaction: discord.Interaction, query: str) -> None:
        """Handle the ``/lore`` command."""
        try:
            results = service_api.search(query, tags=["lore"])
            summaries = []
            for res in results:
                content = res.get("content", "").strip()
                if content:
                    first = content.splitlines()[0]
                    summaries.append(first)
            prompt = query
            if summaries:
                notes = "\n".join(f"- {s}" for s in summaries)
                prompt = f"{query}\n\nRelevant notes:\n{notes}\n"
            reply = dialogue.respond(prompt)
            await interaction.response.send_message(str(reply))
        except Exception as exc:
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)

    # ------------------------------------------------------------------
    @app_commands.command(
        name="note", description="Append a timestamped entry to a note"
    )
    @app_commands.describe(path="Path within the vault", text="Markdown content to append")
    async def note(
        self, interaction: discord.Interaction, path: str, text: str
    ) -> None:
        """Handle the ``/note`` command."""
        try:
            service_api.create_note(path, text)
        except Exception as exc:
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return
        await interaction.response.send_message(f"Saved note to {path}")

    # ------------------------------------------------------------------
    @app_commands.command(
        name="track", description="Update a combat tracker statistic"
    )
    @app_commands.describe(stat="Statistic name", delta="Amount to add or subtract")
    async def track(
        self, interaction: discord.Interaction, stat: str, delta: int
    ) -> None:
        """Handle the ``/track`` command."""
        url = os.getenv("COMBAT_TRACKER_URL", "http://localhost:8000/track")

        async def _request() -> int:
            def _do_request() -> int:
                response = requests.post(
                    url, json={"stat": stat, "delta": delta}, timeout=10
                )
                response.raise_for_status()
                data = response.json()
                return int(data.get("value", 0))

            return await asyncio.to_thread(_do_request)

        try:
            new_value = await _request()
        except Exception as exc:  # pragma: no cover - network errors
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return

        await interaction.response.send_message(f"{stat} is now {new_value}")

    # ------------------------------------------------------------------
    @app_commands.command(
        name="commands", description="List Blossom's available slash commands"
    )
    async def commands_list(self, interaction: discord.Interaction) -> None:
        """Provide a short description of each registered slash command."""

        lines = ["**Available Blossom commands**"]
        lines.extend(f"{syntax} — {description}" for syntax, description in COMMAND_SUMMARIES)
        message = "\n".join(lines)
        await interaction.response.send_message(message, ephemeral=True)

    # ------------------------------------------------------------------
    @export_group.command(name="session", description="Export the current session log")
    async def export_session(self, interaction: discord.Interaction) -> None:
        """Handle the ``/export session`` command."""
        try:
            note_path = session_export.export_session()
        except Exception as exc:  # pragma: no cover - runtime errors
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return
        await interaction.response.send_message(
            f"Exported session log to {str(note_path)}")

    # ------------------------------------------------------------------
    @scene_group.command(name="as", description="Switch the narrator TTS voice")
    @app_commands.describe(voice="Registered narrator profile to use")
    async def scene_as(
        self, interaction: discord.Interaction, voice: str
    ) -> None:
        """Switch the narrator TTS voice."""
        try:
            profile = self.voice_registry.get_profile(voice)
            self.voice_registry.set_profile("narrator", profile)
            self.voice_registry.save()
            guild_id = getattr(interaction.guild, "id", None)
            channel_id = getattr(interaction.channel, "id", None)
            if guild_id is not None and channel_id is not None:
                current = get_profile(guild_id, channel_id)
                current["voice"] = voice
                set_profile(guild_id, channel_id, current)
        except Exception as exc:
            await interaction.response.send_message(f"Error: {exc}", ephemeral=True)
            return
        await interaction.response.send_message(f"Narrator voice set to {voice}")

    # ------------------------------------------------------------------
    async def _permission_check(self, interaction: discord.Interaction) -> bool:
        """Validate channel and role permissions before running commands."""
        command = getattr(interaction.command, "qualified_name", None)
        if command is None:
            return True
        rules = self.permissions.get(command, {})
        channels = set(rules.get("channels", []))
        roles = set(rules.get("roles", []))
        channel_id = getattr(getattr(interaction, "channel", None), "id", None)
        if channels and channel_id not in channels:
            await interaction.response.send_message(
                "This command is not permitted in this channel.",
                ephemeral=True,
            )
            return False
        if roles:
            user_roles = {
                getattr(r, "id", None) for r in getattr(interaction.user, "roles", [])
            }
            if not user_roles.intersection(roles):
                await interaction.response.send_message(
                    "You do not have permission to use this command.",
                    ephemeral=True,
                )
                return False

        # Load per-channel profile to update narrator voice
        try:
            guild_id = getattr(interaction.guild, "id", None)
            channel_id = getattr(interaction.channel, "id", None)
            if guild_id is not None and channel_id is not None:
                profile = get_profile(guild_id, channel_id)
                voice = profile.get("voice")
                if voice:
                    vp = self.voice_registry.get_profile(voice)
                    self.voice_registry.set_profile("narrator", vp)
        except Exception:
            pass

        return True


__all__ = ["BlossomBot"]


if __name__ == "__main__":  # pragma: no cover - manual execution
    TOKEN = os.getenv("DISCORD_TOKEN") or get_token()
    if not TOKEN:
        raise RuntimeError("Discord token not configured")
    bot = BlossomBot()
    bot.run(TOKEN)
