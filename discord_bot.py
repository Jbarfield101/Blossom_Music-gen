from __future__ import annotations

import asyncio
import math
import os
from typing import Dict, List, Optional

import discord
from discord import app_commands
from discord.ext import commands

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover - optional
    np = None  # type: ignore[assignment]

try:
    import resampy  # type: ignore
except Exception:  # pragma: no cover - optional
    resampy = None  # type: ignore[assignment]
    try:
        from scipy.signal import resample_poly  # type: ignore
    except Exception:  # pragma: no cover - optional
        resample_poly = None  # type: ignore[assignment]

from config.discord_token import get_token
from mouth.tts import TTSEngine

# A simple list the UI scrapes to display available slash commands
COMMAND_SUMMARIES = [
    ("/ping", "Check if the bot is alive"),
    ("/join [channel]", "Join your voice channel or specified channel"),
    ("/leave", "Leave the current voice channel"),
    ("/say <text>", "Speak text in the connected voice channel"),
]


def ensure_opus_loaded() -> None:
    if discord.opus.is_loaded():
        return
    # Try common library names by platform
    candidates = [
        "opus",  # Unix
        "libopus",  # Unix alt
        "libopus-0",  # Windows (vcpkg)
        "opus.dll",  # Windows alt
    ]
    for name in candidates:
        try:
            discord.opus.load_opus(name)
            if discord.opus.is_loaded():
                return
        except Exception:
            continue
    # If still not loaded, let discord.py raise when attempting to use voice


def _resample_to_48k(audio: List[float] | 'np.ndarray', input_rate: int) -> List[float] | 'np.ndarray':
    if input_rate == 48000:
        return audio
    if np is not None and resampy is not None:
        return resampy.resample(audio, input_rate, 48000)
    if np is not None and 'resample_poly' in globals() and resample_poly is not None:  # type: ignore[name-defined]
        g = math.gcd(input_rate, 48000)
        return resample_poly(audio, 48000 // g, input_rate // g)  # type: ignore[no-any-return]
    # naive fallback
    ratio = 48000 / float(input_rate)
    return [audio[int(i / ratio)] for i in range(int(len(audio) * ratio))]  # type: ignore[index]


class SlashTTSBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.guilds = True
        intents.voice_states = True
        super().__init__(command_prefix="!", intents=intents)
        self.engine = TTSEngine()
        self.input_rate = 22050
        # Avoid clobbering discord.Client.voice_clients property
        self._guild_voice_map: Dict[int, discord.VoiceClient] = {}
        self.permissions = self._load_permissions()

    def _load_permissions(self) -> Dict[str, Dict[str, List[int]]]:
        """Load simple permissions from config/discord.yaml if present.

        Format:
          command:
            channels: [id, id]
            roles: [id, id]
        """
        path = os.path.join("config", "discord.yaml")
        if not os.path.exists(path):
            return {}
        perms: Dict[str, Dict[str, List[int]]] = {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.read().splitlines()
            current: Optional[str] = None
            for raw in lines:
                line = raw.rstrip()
                if not line or line.lstrip().startswith("#"):
                    continue
                if not line.startswith(" "):
                    # top-level key like: command:
                    if not line.endswith(":"):
                        continue
                    current = line[:-1].strip().strip('"')
                    if current:
                        perms[current] = {"channels": [], "roles": []}
                    continue
                if current is None:
                    continue
                # handle indented keys
                stripped = line.strip()
                if ":" not in stripped:
                    continue
                key, value = stripped.split(":", 1)
                key = key.strip()
                value = value.strip()
                if value.startswith("[") and value.endswith("]"):
                    items = [v.strip() for v in value[1:-1].split(",") if v.strip()]
                else:
                    items = [v.strip() for v in value.split() if v.strip()]
                try:
                    ids = [int(x.strip('"\'')) for x in items if x]
                except Exception:
                    ids = []
                if key in ("channels", "roles"):
                    perms[current][key] = ids
        except Exception:
            return {}
        return perms

    def _is_allowed(self, interaction: discord.Interaction, command_name: str) -> bool:
        cfg = self.permissions.get(command_name)
        if not cfg:
            return True
        channels = cfg.get("channels") or []
        roles = cfg.get("roles") or []
        # channel restriction
        if channels and interaction.channel_id not in channels:
            return False
        # role restriction
        if roles and isinstance(interaction.user, discord.Member):
            user_role_ids = {r.id for r in interaction.user.roles}
            if user_role_ids.isdisjoint(roles):
                return False
        return True

    async def setup_hook(self) -> None:  # called before login
        # Fast guild-scoped sync when DISCORD_GUILD_ID is provided
        guild_id = os.getenv("DISCORD_GUILD_ID")
        if guild_id:
            try:
                gid = discord.Object(id=int(guild_id))
                await self.tree.sync(guild=gid)
                print(f"[discord] Synced commands to guild {guild_id}")
            except Exception:
                await self.tree.sync()
                print("[discord] Fallback: global command sync requested")
        else:
            # Global sync may take up to an hour; we'll also perform
            # a per-guild sync in on_ready for immediate availability.
            try:
                await self.tree.sync()
                print("[discord] Global command sync requested")
            except Exception as e:
                print(f"[discord] Global sync failed: {e}")

    def _get_guild_vc(self, guild: discord.Guild | None) -> Optional[discord.VoiceClient]:
        if guild is None:
            return None
        return self._guild_voice_map.get(guild.id)

    def _set_guild_vc(self, guild: discord.Guild, vc: Optional[discord.VoiceClient]) -> None:
        if vc is None:
            self._guild_voice_map.pop(guild.id, None)
        else:
            self._guild_voice_map[guild.id] = vc

    async def join(self, interaction: discord.Interaction, channel: Optional[discord.VoiceChannel]) -> discord.VoiceClient:
        if channel is None:
            # Try the user's current voice channel
            me = interaction.user  # type: ignore[assignment]
            if hasattr(me, "voice") and me.voice and me.voice.channel:
                channel = me.voice.channel  # type: ignore[assignment]
        if channel is None:
            raise RuntimeError("You are not in a voice channel and no channel was provided.")
        vc = await channel.connect()
        if interaction.guild:
            self._set_guild_vc(interaction.guild, vc)
        return vc

    async def speak(self, vc: discord.VoiceClient, text: str) -> None:
        ensure_opus_loaded()
        audio = self.engine.synthesize(text)
        audio48 = _resample_to_48k(audio, self.input_rate)

        if np is not None:
            pcm = np.clip(audio48 * 32767, -32768, 32767).astype(np.int16).tobytes()  # type: ignore[operator]
        else:  # pragma: no cover
            samples = [int(max(min(x * 32767, 32767), -32768)) for x in audio48]  # type: ignore[operator]
            pcm = bytearray()
            for s in samples:
                pcm.extend(int(s).to_bytes(2, "little", signed=True))

        encoder = discord.opus.Encoder(48000, 1)
        frame_size = encoder.frame_size
        step = frame_size * 2

        for i in range(0, len(pcm), step):
            frame = pcm[i : i + step]
            if len(frame) < step:
                frame = frame.ljust(step, b"\x00")
            packet = encoder.encode(frame, frame_size)
            vc.send_audio_packet(packet, encode=False)
            await asyncio.sleep(frame_size / 48000.0)


bot = SlashTTSBot()


@bot.event
async def on_ready() -> None:
    try:
        # Set a simple presence and perform per-guild sync for immediacy
        await bot.change_presence(activity=discord.Game(name="Blossom DM"))
    except Exception:
        pass
    try:
        # Always perform per-guild sync for immediate availability
        for g in bot.guilds:
            try:
                gid = discord.Object(id=g.id)
                # Copy global commands to this guild so they are available instantly
                bot.tree.copy_global_to(guild=gid)
                cmds = await bot.tree.sync(guild=gid)
                print(f"[discord] Synced {len(cmds)} commands to guild {g.id} ({g.name})")
            except Exception as e:
                print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
    except Exception as e:
        print(f"[discord] on_ready sync error: {e}")


@bot.tree.command(description="Admin: Sync slash commands in this server")
async def sync(interaction: discord.Interaction) -> None:
    try:
        # Basic permission gate: require Manage Guild to sync
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await interaction.response.send_message("You need Manage Server permissions to sync commands.", ephemeral=True)
            return
        if not interaction.guild:
            await interaction.response.send_message("Use this in a server.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        gid = discord.Object(id=interaction.guild.id)
        bot.tree.copy_global_to(guild=gid)
        cmds = await bot.tree.sync(guild=gid)
        await interaction.followup.send(f"Synced {len(cmds)} commands to this server.", ephemeral=True)
    except Exception as e:
        await interaction.followup.send(f"Sync failed: {e}", ephemeral=True)


@bot.tree.command(description="Check if the bot is alive")
async def ping(interaction: discord.Interaction) -> None:
    if not bot._is_allowed(interaction, "ping"):
        await interaction.response.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    await interaction.response.send_message("Pong", ephemeral=True)


@bot.tree.command(description="Join your current voice channel")
@app_commands.describe(channel="Voice channel to join (optional)")
async def join(interaction: discord.Interaction, channel: Optional[discord.VoiceChannel] = None) -> None:
    if not bot._is_allowed(interaction, "join"):
        await interaction.response.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    try:
        vc = await bot.join(interaction, channel)
        await interaction.response.send_message(f"Joined {vc.channel.mention}")
    except Exception as e:
        await interaction.response.send_message(f"Join failed: {e}", ephemeral=True)


@bot.tree.command(description="Leave the current voice channel")
async def leave(interaction: discord.Interaction) -> None:
    if not bot._is_allowed(interaction, "leave"):
        await interaction.response.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    vc = bot._get_guild_vc(interaction.guild)
    if not vc:
        await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
        return
    try:
        await vc.disconnect(force=True)
    finally:
        if interaction.guild:
            bot._set_guild_vc(interaction.guild, None)
    await interaction.response.send_message("Left the voice channel.")


@bot.tree.command(description="Speak text in the current voice channel")
@app_commands.describe(text="What should I say?")
async def say(interaction: discord.Interaction, text: str) -> None:
    if not bot._is_allowed(interaction, "say"):
        await interaction.response.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    vc = bot._get_guild_vc(interaction.guild)
    if vc is None or not vc.is_connected():
        # Attempt to join the author's channel implicitly
        try:
            vc = await bot.join(interaction, None)
        except Exception as e:
            await interaction.response.send_message(f"Not in a voice channel: {e}", ephemeral=True)
            return
    # Defer as we'll take a moment to synthesize
    if not interaction.response.is_done():
        await interaction.response.defer(thinking=True)
    try:
        await bot.speak(vc, text)
        await interaction.followup.send("Done.", ephemeral=True)
    except Exception as e:
        await interaction.followup.send(f"Failed to speak: {e}", ephemeral=True)


def main() -> None:
    token_env = os.getenv("DISCORD_TOKEN")
    token = (token_env.strip() if isinstance(token_env, str) and token_env else None) or get_token()
    token = token.strip() if isinstance(token, str) else None
    if not token:
        raise SystemExit("Set DISCORD_TOKEN or store a token via config.discord_token.set_token().")
    try:
        print("[discord] Starting bot...")
        print(f"[discord] Token length: {len(token)} (source: {'env' if token_env else 'secrets.json'})")
        bot.run(token)
    except Exception as e:
        print(f"[discord] Bot exited: {e}")


if __name__ == "__main__":
    main()
