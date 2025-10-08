from __future__ import annotations

import asyncio
import math
import os
from typing import Dict, List, Optional
import json
import uuid
from datetime import datetime, timezone
import time

import discord
from discord.ext import commands

try:
    from discord import app_commands  # type: ignore
except Exception:  # pragma: no cover - optional
    app_commands = None  # type: ignore[assignment]

Option = getattr(discord, 'Option', None)

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

try:
    import soundfile as sf  # type: ignore
except Exception:  # pragma: no cover - optional
    sf = None  # type: ignore[assignment]

from config.discord_token import get_token
from mouth.tts import TTSEngine

# A simple list the UI scrapes to display available slash commands


class SlashResponder:
    """Adapter that normalizes Discord interactions across discord.py and py-cord."""

    def __init__(self, source: object) -> None:
        ctx = None
        interaction = None
        if hasattr(source, "respond") and hasattr(source, "defer"):
            ctx = source
            interaction = getattr(source, "interaction", None)
        if interaction is None and hasattr(source, "response"):
            interaction = source
        if interaction is None:
            raise TypeError("Unsupported interaction source")
        self._ctx = ctx
        self.interaction = interaction

    def response_done(self) -> bool:
        if self._ctx is not None:
            return bool(getattr(self._ctx, "responded", False))
        try:
            response = getattr(self.interaction, "response", None)
            if response is None:
                return False
            return bool(response.is_done())
        except Exception:
            return False

    async def defer(self, *, ephemeral: bool | None = None, thinking: bool | None = None) -> None:
        if self._ctx is not None:
            kwargs = {}
            if ephemeral is not None:
                kwargs["ephemeral"] = ephemeral
            if thinking is not None:
                kwargs["with_message"] = bool(thinking)
            try:
                await self._ctx.defer(**kwargs)
            except TypeError:
                kwargs.pop("with_message", None)
                await self._ctx.defer(**kwargs)
            except Exception:
                pass
            return
        response = getattr(self.interaction, "response", None)
        if response is None:
            return
        base_kwargs: dict[str, object] = {}
        if ephemeral is not None:
            base_kwargs["ephemeral"] = ephemeral
        if thinking is not None:
            base_kwargs["thinking"] = thinking
        variants: list[dict[str, object]] = []
        if base_kwargs:
            variants.append(dict(base_kwargs))
        if "thinking" in base_kwargs:
            stripped = dict(base_kwargs)
            stripped.pop("thinking", None)
            variants.append(stripped)
        if "ephemeral" in base_kwargs:
            stripped = dict(base_kwargs)
            stripped.pop("ephemeral", None)
            variants.append(stripped)
        variants.append({})
        for kwargs in variants:
            try:
                await response.defer(**kwargs)
                return
            except TypeError:
                continue
            except Exception:
                return
        try:
            await response.defer()
        except Exception:
            pass

    async def send_initial(self, *args, **kwargs) -> None:
        if self._ctx is not None:
            await self._ctx.respond(*args, **kwargs)
            return
        response = getattr(self.interaction, "response", None)
        if response is not None:
            await response.send_message(*args, **kwargs)

    async def send_followup(self, *args, **kwargs) -> None:
        if self._ctx is not None:
            send_followup = getattr(self._ctx, "send_followup", None)
            if send_followup is not None:
                await send_followup(*args, **kwargs)
                return
            followup_manager = getattr(self._ctx, "followup", None)
            if followup_manager is not None:
                await followup_manager.send(*args, **kwargs)
                return
        followup = getattr(self.interaction, "followup", None)
        if followup is not None:
            await followup.send(*args, **kwargs)

    async def send_message(self, *args, **kwargs) -> None:
        if self.response_done():
            await self.send_followup(*args, **kwargs)
            return
        try:
            await self.send_initial(*args, **kwargs)
        except Exception:
            await self.send_followup(*args, **kwargs)

COMMAND_SUMMARIES = [
    ("/ping", "Check if the bot is alive"),
    ("/join [channel]", "Join your voice channel or specified channel"),
    ("/leave", "Leave the current voice channel"),
    ("/say <text>", "Speak text in the connected voice channel"),
    ("/act", "Open UI to choose NPC + voice"),
]

DEFAULT_GREETING_PATH = os.path.join("assets", "scripted_sounds", "Discord_Recorded _Greeting.wav")
GREETING_MIN_INTERVAL = 5.0  # seconds


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
        self.self_deaf = self._resolve_self_deaf_flag()
        self.greeting_path = self._resolve_greeting_path()
        self.greeting_volume = self._resolve_greeting_volume()
        self._last_greeting: Dict[int, float] = {}
        # Avoid clobbering discord.Client.voice_clients property
        self._guild_voice_map: Dict[int, discord.VoiceClient] = {}
        self.permissions = self._load_permissions()
        # Current persona voice profile name (registry key)
        self.current_profile: str = ""
        print(f"[discord] Self-deafen on connect: {self.self_deaf}")

    def _resolve_self_deaf_flag(self) -> bool:
        value = os.getenv("DISCORD_SELF_DEAF")
        if value is None:
            return True
        return value.strip().lower() not in {"0", "false", "no"}

    def _resolve_greeting_path(self) -> str:
        path_env = os.getenv("DISCORD_GREETING_PATH")
        if path_env and path_env.strip():
            return os.path.abspath(path_env.strip())
        return os.path.abspath(DEFAULT_GREETING_PATH)

    def _resolve_greeting_volume(self) -> float:
        value = os.getenv("DISCORD_GREETING_VOLUME") or "1.0"
        try:
            vol = float(value)
            if vol <= 0:
                return 1.0
            return min(vol, 4.0)
        except Exception:
            return 1.0

    # ---- Persona management -------------------------------------------------
    def _persona_path(self) -> str:
        # Control file for UI-driven persona/takeover (simple file-based IPC)
        return os.path.join("data", "discord_persona.json")

    def _status_path(self) -> str:
        # Status file the UI can read to discover current voice channel
        return os.path.join("data", "discord_status.json")

    def _control_path(self) -> str:
        # Runtime control file for toggles (self-deaf, etc.)
        return os.path.join("data", "discord_control.json")

    async def _apply_self_deaf_state(
        self,
        vc: discord.VoiceClient,
        channel: Optional['discord.abc.Connectable'] = None,
    ) -> None:
        target = channel or getattr(vc, 'channel', None)
        guild = None
        if target is not None:
            guild = getattr(target, 'guild', None)
        if guild is None:
            guild = getattr(vc, 'guild', None)
        if guild is None or not hasattr(guild, 'change_voice_state'):
            return
        target_channel = target or getattr(vc, 'channel', None)
        try:
            await guild.change_voice_state(channel=target_channel, self_deaf=self.self_deaf)
        except TypeError:
            try:
                await guild.change_voice_state(channel=target_channel, deafen=self.self_deaf)
            except Exception as exc:
                print(f"[discord] Failed to apply self-deafen state via deafen flag: {exc}", flush=True)
        except Exception as exc:
            print(f"[discord] Failed to apply self-deafen state: {exc}", flush=True)

    async def _connect_voice(self, connectable: 'discord.abc.Connectable') -> discord.VoiceClient:
        try:
            vc = await connectable.connect(self_deaf=self.self_deaf, reconnect=True)  # type: ignore[arg-type]
        except TypeError:
            vc = await connectable.connect(reconnect=True)  # type: ignore[arg-type]
        try:
            await self._apply_self_deafen_state(vc, connectable)
        except Exception as exc:
            print(f"[discord] Failed to align self-deafen state: {exc}", flush=True)
        return vc

    def _write_status(self, guild_id: Optional[int], channel_id: Optional[int]) -> None:
        try:
            os.makedirs("data", exist_ok=True)
            payload = {
                "guild_id": int(guild_id) if guild_id else None,
                "channel_id": int(channel_id) if channel_id else None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            with open(self._status_path(), "w", encoding="utf-8") as f:
                json.dump(payload, f)
        except Exception:
            pass

    def _tts_path(self) -> str:
        return os.path.join("data", "discord_tts.json")

    async def _handle_tts_request(self, data: dict) -> None:

        text = str(data.get("text") or "").strip()

        if not text:

            print('[discord] TTS request ignored: empty text')

            return

        channel_hint = data.get("channel_id")

        print(f"[discord] TTS request received (len={len(text)}, channel={channel_hint})", flush=True)

        vc: Optional[discord.VoiceClient] = None

        try:

            if self._guild_voice_map:

                vc = next(iter(self._guild_voice_map.values()))

        except Exception:

            vc = None

        # Optionally join a channel if specified

        if (vc is None or not vc.is_connected()) and channel_hint:

            try:

                chan = self.get_channel(int(channel_hint)) or await self.fetch_channel(int(channel_hint))

                if hasattr(chan, "connect"):

                    print(f"[discord] TTS: connecting to channel {getattr(chan, 'id', None)}", flush=True)

                    v = await self._connect_voice(chan)

                    if getattr(chan, "guild", None):

                        self._set_guild_vc(chan.guild, v)  # type: ignore[arg-type]

                        vc = v

                        try:

                            gid = getattr(chan, "guild", None)

                            gid_val = getattr(gid, "id", None) if gid else None

                            self._write_status(gid_val, getattr(chan, "id", None))

                        except Exception as exc:

                            print(f"[discord] TTS: failed to write status: {exc}", flush=True)

                        await self._play_greeting(v, force=True)

            except Exception as exc:

                print(f"[discord] TTS: failed to connect to channel {channel_hint}: {exc}")

        if vc is None or not vc.is_connected():

            print('[discord] TTS request skipped: no active voice connection', flush=True)

            return

        # Speak using current persona if set

        try:

            await self.speak(vc, text)

        except Exception as exc:

            print(f"[discord] Failed to speak generated audio: {exc}", flush=True)



    async def _apply_control_payload(self, payload: dict) -> None:
        if not isinstance(payload, dict):
            return
        updated = False
        if "self_deaf" in payload:
            new_flag = bool(payload.get("self_deaf"))
            if new_flag != self.self_deaf:
                self.self_deaf = new_flag
                updated = True
                print(f"[discord] Updated self-deafen preference to {self.self_deaf}")
                for vc in list(self._guild_voice_map.values()):
                    if vc is None:
                        continue
                    try:
                        if not vc.is_connected():
                            continue
                        guild = getattr(vc, "guild", None)
                        channel = getattr(vc, "channel", None)
                        if guild is not None and channel is not None:
                            await guild.change_voice_state(channel=channel, self_deaf=self.self_deaf)
                    except Exception as exc:
                        print(f"[discord] Failed to apply self-deaf state: {exc}")
        if "greeting_path" in payload:
            raw_path = payload.get("greeting_path")
            if isinstance(raw_path, str):
                candidate = raw_path.strip()
                if candidate:
                    candidate_abs = os.path.abspath(candidate)
                    if candidate_abs != self.greeting_path:
                        self.greeting_path = candidate_abs
                        updated = True
                        print(f"[discord] Updated greeting path to {self.greeting_path}")
        if "greeting_volume" in payload:
            try:
                vol = float(payload.get("greeting_volume"))
                if vol > 0 and abs(vol - self.greeting_volume) > 1e-3:
                    self.greeting_volume = min(vol, 4.0)
                    updated = True
                    print(f"[discord] Updated greeting volume to {self.greeting_volume:.2f}")
            except Exception:
                pass
        if not updated:
            print("[discord] Control payload received with no changes")

    def _load_greeting_audio(self, path: str) -> tuple[Optional['np.ndarray'], int]:
        if sf is None:
            print('[discord] Greeting skipped: soundfile module not available', flush=True)
            return None, 0
        try:
            data, rate = sf.read(path, dtype='float32', always_2d=True)  # type: ignore[arg-type]
            if data.ndim > 1:
                data = data.mean(axis=1)
            print(f"[discord] Greeting audio loaded ({path}) @ {rate} Hz", flush=True)
            return data, int(rate)
        except Exception as exc:
            print(f"[discord] Failed to load greeting audio ({path}): {exc}", flush=True)
            return None, 0

    async def _stream_audio(
        self,
        vc: discord.VoiceClient,
        audio: 'np.ndarray | List[float]',
        input_rate: int,
        *,
        volume: float = 1.0,
        label: str = 'audio',
    ) -> None:
        try:
            if vc is None or not vc.is_connected():
                print(f"[discord] stream_audio skipped: voice client not connected ({label})")
                return
            ensure_opus_loaded()
            if np is not None:
                arr = np.asarray(audio, dtype=np.float32)
                if arr.ndim == 2:
                    arr = arr.mean(axis=1)
                audio48 = np.asarray(_resample_to_48k(arr, input_rate), dtype=np.float32)
                if volume != 1.0:
                    audio48 = audio48 * float(volume)
                pcm = np.clip(audio48 * 32767, -32768, 32767).astype(np.int16).tobytes()
                total_samples = audio48.shape[0]
            else:
                if isinstance(audio, list):
                    arr = [float(x) for x in audio]
                else:
                    arr = [float(x) for x in audio]  # type: ignore[arg-type]
                if len(arr) == 0:
                    return
                audio48 = _resample_to_48k(arr, input_rate)
                if volume != 1.0:
                    audio48 = [float(sample) * float(volume) for sample in audio48]
                pcm = bytearray()
                for sample in audio48:
                    value = int(max(min(sample * 32767, 32767), -32768))
                    pcm.extend(value.to_bytes(2, 'little', signed=True))
                total_samples = len(audio48)
            if not pcm:
                print(f"[discord] stream_audio produced empty buffer ({label})")
                return
            encoder = discord.opus.Encoder(48000, 1)
            frame_size = encoder.frame_size
            step = frame_size * 2
            print(
                f"[discord] Streaming {label}: {total_samples} samples @48k, frame={frame_size}, volume={volume:.2f}"
            )
            for i in range(0, len(pcm), step):
                if not vc.is_connected():
                    print(f"[discord] stream_audio stopped early (voice client disconnected) [{label}]")
                    return
                frame = pcm[i : i + step]
                if len(frame) < step:
                    frame = frame.ljust(step, b"\x00")
                packet = encoder.encode(frame, frame_size)
                vc.send_audio_packet(packet, encode=False)
                await asyncio.sleep(frame_size / 48000.0)
            print(f"[discord] Completed streaming {label}")
        except Exception as exc:
            print(f"[discord] Failed to stream {label}: {exc}")

    async def _play_greeting(self, vc: Optional[discord.VoiceClient], *, force: bool = False) -> None:
        if vc is None or not vc.is_connected():
            print('[discord] Greeting skipped: no active voice connection', flush=True)
            return
        path = (self.greeting_path or '').strip()
        print(f"[discord] Greeting requested (path={path}, force={force})", flush=True)
        if not path:
            print('[discord] Greeting skipped: no path configured', flush=True)
            return
        resolved = os.path.abspath(path)
        if not os.path.exists(resolved):
            print(f"[discord] Greeting skipped: file not found ({resolved})", flush=True)
            return
        guild = getattr(vc, 'guild', None)
        guild_id = getattr(guild, 'id', None) if guild else None
        if guild_id is not None and not force:
            last = self._last_greeting.get(int(guild_id))
            if last and time.time() - last < GREETING_MIN_INTERVAL:
                remaining = GREETING_MIN_INTERVAL - (time.time() - last)
                print(
                    f"[discord] Greeting skipped: recently played for guild {guild_id} (wait {remaining:.1f}s)"
                )
                return
        audio, rate = self._load_greeting_audio(resolved)
        if audio is None or rate <= 0:
            return
        print(
            f"[discord] Playing greeting from {resolved} ({len(audio)} samples @ {rate} Hz, volume={self.greeting_volume:.2f})"
        )
        await self._stream_audio(vc, audio, rate, volume=self.greeting_volume, label='greeting')
        if guild_id is not None:
            self._last_greeting[int(guild_id)] = time.time()

    def _read_persona_file(self) -> Optional[dict]:
        path = self._persona_path()
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    async def _watch_persona(self) -> None:
        """Poll control files for persona/tts requests."""
        last_nonce = None
        last_tts = None
        last_control = None
        while True:
            try:
                data = self._read_persona_file() or {}
                nonce = data.get("nonce")
                if data.get("action") == "takeover" and nonce and nonce != last_nonce:
                    profile = str(data.get("profile") or "").strip()
                    channel_id = data.get("channel_id")
                    # Apply profile
                    if profile:
                        self.current_profile = profile
                    # Join voice channel if provided
                    if channel_id:
                        try:
                            chan = self.get_channel(int(channel_id)) or await self.fetch_channel(int(channel_id))
                            if hasattr(chan, "connect"):
                                target_id = getattr(chan, "id", None)
                                print(f"[discord] persona takeover: connecting to channel {target_id}")
                                vc = await chan.connect(self_deaf=self.self_deaf, reconnect=True)  # type: ignore[arg-type]
                                if getattr(chan, "guild", None):
                                    self._set_guild_vc(chan.guild, vc)  # type: ignore[arg-type]
                                    try:
                                        gid = getattr(chan, "guild", None)
                                        gid_val = getattr(gid, "id", None) if gid else None
                                        cid_val = getattr(chan, "id", None)
                                        self._write_status(gid_val, cid_val)
                                    except Exception as exc:
                                        print(f"[discord] persona takeover: failed to write status: {exc}")
                                await self._play_greeting(vc, force=True)
                        except Exception:
                            pass
                    last_nonce = nonce
            except Exception:
                pass
            # Runtime control file
            try:
                if os.path.exists(self._control_path()):
                    with open(self._control_path(), "r", encoding="utf-8") as f:
                        cdata = json.load(f)
                    cnonce = cdata.get("nonce")
                    cache_key = cnonce or json.dumps(cdata, sort_keys=True)
                    if cache_key != last_control:
                        last_control = cache_key
                        await self._apply_control_payload(cdata)
            except Exception:
                pass
            # TTS control file
            try:
                if os.path.exists(self._tts_path()):
                    with open(self._tts_path(), "r", encoding="utf-8") as f:
                        tdata = json.load(f)
                    tnonce = tdata.get("nonce")
                    if tnonce and tnonce != last_tts:
                        last_tts = tnonce
                        await self._handle_tts_request(tdata)
            except Exception:
                pass
            await asyncio.sleep(1.0)

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
        if app_commands is not None and hasattr(self, 'tree'):
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
            return

        # Pycord or other forks without app_commands: rely on sync_commands API
        try:
            guild_val = int(guild_id) if guild_id else None
        except Exception:
            guild_val = None
        try:
            if guild_val is not None:
                await self.sync_commands(force=True, guild_ids=[guild_val])
                print(f"[discord] Synced commands to guild {guild_val}")
            else:
                await self.sync_commands(force=True)
                print("[discord] Global command sync requested")
        except Exception as e:
            print(f"[discord] Command sync failed: {e}")

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

        # Resolve target channel: explicit option or the requester's current channel

        target: Optional[discord.VoiceChannel] = channel

        if target is None:

            me = interaction.user  # type: ignore[assignment]

            if hasattr(me, "voice") and me.voice and me.voice.channel:

                target = me.voice.channel  # type: ignore[assignment]

        if target is None:

            raise RuntimeError("You are not in a voice channel and no channel was provided.")



        guild_id = getattr(interaction.guild, "id", None)

        channel_id = getattr(target, "id", None)

        user_id = getattr(interaction.user, "id", None)

        print(

            f"[discord] join request: guild={guild_id} channel={channel_id} user={user_id} self_deaf={self.self_deaf}"

        )



        # Preflight permission check if possible

        if interaction.guild and isinstance(target, discord.VoiceChannel):

            me_member = interaction.guild.me

            if me_member is not None:

                perms = target.permissions_for(me_member)

                if not perms.connect:

                    raise RuntimeError("Missing permission to connect to that voice channel.")

                if target.user_limit and len(target.members) >= target.user_limit and not perms.move_members:

                    raise RuntimeError("Channel is full and I lack Move Members permission.")



        # Reuse or move existing connection when already connected

        existing = self._get_guild_vc(interaction.guild)

        if existing and existing.is_connected():

            try:

                current_channel = getattr(existing, "channel", None)

                if current_channel == target:

                    print("[discord] join: already connected to requested channel", flush=True)

                    await self._play_greeting(existing)

                    return existing

                before_channel = getattr(current_channel, "id", None)

                print(

                    f"[discord] join: moving voice client from channel {before_channel} to {channel_id}"

                )

                await existing.move_to(target)
                try:
                    await self._apply_self_deaf_state(existing, target)
                except Exception as exc:
                    print(f"[discord] join: failed to update self-deafen after move ({exc})", flush=True)

                await self._play_greeting(existing, force=True)

                return existing

            except discord.ClientException as exc:

                print(f"[discord] join: move failed, reconnecting ({exc})", flush=True)

                try:

                    await existing.disconnect(force=True)

                except Exception as disconnect_error:

                    print(f"[discord] join: failed to disconnect existing client ({disconnect_error})", flush=True)



        # Fresh connect

        print(f"[discord] join: connecting to channel {channel_id}", flush=True)

        vc = await self._connect_voice(target)

        if interaction.guild:

            self._set_guild_vc(interaction.guild, vc)

            try:

                gid = getattr(interaction.guild, "id", None)

                cid = getattr(target, "id", None)

                self._write_status(gid, cid)

            except Exception as exc:

                print(f"[discord] join: failed to write status: {exc}", flush=True)

        await self._play_greeting(vc)

        return vc





    async def speak(self, vc: discord.VoiceClient, text: str) -> None:

        if vc is None or not vc.is_connected():

            print('[discord] speak skipped: voice client not connected')

            return

        profile = None

        try:

            if self.current_profile:

                profile = self.engine.registry.get_profile(self.current_profile)

        except Exception as exc:

            print(f"[discord] Failed to resolve persona profile '{self.current_profile}': {exc}")

            profile = None

        audio = self.engine.synthesize(text, profile)

        print(

            f"[discord] speak: streaming {len(text)} characters (persona={self.current_profile or 'default'})"

        )

        await self._stream_audio(vc, audio, self.input_rate, label='tts')



bot = SlashTTSBot()


@bot.event
async def on_voice_state_update(
    member: discord.Member,
    before: discord.VoiceState | None,
    after: discord.VoiceState | None,
) -> None:
    try:
        bot_id = getattr(bot.user, 'id', None)
        if bot_id is None or getattr(member, 'id', None) != bot_id:
            return
        before_channel = getattr(getattr(before, 'channel', None), 'id', None)
        after_channel = getattr(getattr(after, 'channel', None), 'id', None)
        self_deaf = getattr(after, 'self_deaf', None) if after else None
        self_mute = getattr(after, 'self_mute', None) if after else None
        print(
            f"[discord] Voice state update (bot): {before_channel} -> {after_channel}, self_deaf={self_deaf}, self_mute={self_mute}"
        )
    except Exception as exc:
        print(f"[discord] on_voice_state_update error: {exc}", flush=True)

@bot.event
async def on_ready() -> None:
    try:
        # Set a simple presence and perform per-guild sync for immediacy
        await bot.change_presence(activity=discord.Game(name="Blossom DM"))
    except Exception:
        pass
    # Start persona watcher
    try:
        bot.loop.create_task(bot._watch_persona())
    except Exception:
        pass
    try:
        if app_commands is not None and hasattr(bot, 'tree'):
            # Always perform per-guild sync for immediate availability
            for g in bot.guilds:
                try:
                    gid = discord.Object(id=g.id)
                    bot.tree.copy_global_to(guild=gid)
                    cmds = await bot.tree.sync(guild=gid)
                    print(f"[discord] Synced {len(cmds)} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
        else:
            for g in bot.guilds:
                try:
                    await bot.sync_commands(force=True, guild_ids=[g.id])
                    count = len(getattr(bot, 'application_commands', []) or [])
                    print(f"[discord] Synced {count} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
    except Exception as e:
        print(f"[discord] on_ready sync error: {e}")




async def _sync_command(target: object) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    try:
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await responder.send_message("You need Manage Server permissions to sync commands.", ephemeral=True)
            return
        if not interaction.guild:
            await responder.send_message("Use this in a server.", ephemeral=True)
            return
        await _maybe_defer(target, ephemeral=True, thinking=True)
        if app_commands is not None and hasattr(bot, 'tree'):
            gid = discord.Object(id=interaction.guild.id)
            bot.tree.copy_global_to(guild=gid)
            cmds = await bot.tree.sync(guild=gid)
            await responder.send_message(f"Synced {len(cmds)} commands to this server.", ephemeral=True)
        else:
            await bot.sync_commands(force=True, guild_ids=[interaction.guild.id])
            count = len(getattr(bot, 'application_commands', []) or [])
            await responder.send_message(f"Synced {count} commands to this server.", ephemeral=True)
    except Exception as e:
        await responder.send_message(f"Sync failed: {e}", ephemeral=True)




async def _ping_command(target: object) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "ping"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    await responder.send_message("Pong", ephemeral=True)




async def _join_command(target: object, channel: Optional[discord.VoiceChannel]) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "join"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    try:
        await _maybe_defer(target, thinking=True)
        vc = await bot.join(interaction, channel)
        await responder.send_message(f"Joined {vc.channel.mention}")
    except Exception as e:
        await responder.send_message(f"Join failed: {e}", ephemeral=True)




async def _leave_command(target: object) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "leave"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    vc = bot._get_guild_vc(interaction.guild)
    if not vc:
        await responder.send_message("Not connected to a voice channel.", ephemeral=True)
        return
    try:
        await vc.disconnect(force=True)
    finally:
        if interaction.guild:
            bot._set_guild_vc(interaction.guild, None)
        try:
            gid = getattr(interaction.guild, 'id', None)
            bot._write_status(gid, None)
        except Exception:
            pass
    await responder.send_message("Left the voice channel.")




async def _say_command(target: object, text: str) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "say"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    vc = bot._get_guild_vc(interaction.guild)
    if vc is None or not vc.is_connected():
        try:
            vc = await bot.join(interaction, None)
        except Exception as e:
            await responder.send_message(f"Not in a voice channel: {e}", ephemeral=True)
            return
    await _maybe_defer(target, thinking=True)
    try:
        await bot.speak(vc, text)
        await responder.send_message("Done.", ephemeral=True)
    except Exception as e:
        await responder.send_message(f"Failed to speak: {e}", ephemeral=True)




async def _persona_command(target: object, profile: str) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "act"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    bot.current_profile = (profile or "").strip()
    if not bot.current_profile:
        await responder.send_message("Persona cleared.", ephemeral=True)
    else:
        await responder.send_message(f"Persona set to: {bot.current_profile}", ephemeral=True)




async def _takeover_command(target: object, profile: str) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "act"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    try:
        bot.current_profile = (profile or "").strip()
        vc = await bot.join(interaction, None)
        await responder.send_message(
            f"Taking over as {bot.current_profile or 'narrator'} in {vc.channel.mention}", ephemeral=True
        )
    except Exception as e:
        await responder.send_message(f"Takeover failed: {e}", ephemeral=True)




async def _act_command(target: object) -> None:
    responder = SlashResponder(target)
    interaction = responder.interaction
    if not bot._is_allowed(interaction, "act"):
        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)
        return
    try:
        req = {
            "guild_id": getattr(interaction.guild, 'id', None),
            "channel_id": getattr(interaction.channel, 'id', None),
            "user_id": getattr(interaction.user, 'id', None),
            "username": getattr(interaction.user, 'name', None),
            "request_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        print(json.dumps({"discord_act": req}), flush=True)
        await responder.send_message("Prompting the Blossom UI to select an NPC and voice...", ephemeral=True)
    except Exception as e:
        await responder.send_message(f"Act failed: {e}", ephemeral=True)




        if app_commands is not None and hasattr(bot, 'tree'):
            # Always perform per-guild sync for immediate availability
            for g in bot.guilds:
                try:
                    gid = discord.Object(id=g.id)
                    bot.tree.copy_global_to(guild=gid)
                    cmds = await bot.tree.sync(guild=gid)
                    print(f"[discord] Synced {len(cmds)} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
        else:
            for g in bot.guilds:
                try:
                    await bot.sync_commands(force=True, guild_ids=[g.id])
                    count = len(getattr(bot, 'application_commands', []) or [])
                    print(f"[discord] Synced {count} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
    except Exception as e:
        print(f"[discord] on_ready sync error: {e}")


async def _maybe_defer(
    target: object,
    *,
    ephemeral: bool | None = None,
    thinking: bool | None = None,
) -> None:
    responder = SlashResponder(target)
    if responder.response_done():
        return
    await responder.defer(ephemeral=ephemeral, thinking=thinking)


async def _sync_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    try:

        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:

            await responder.send_message("You need Manage Server permissions to sync commands.", ephemeral=True)

            return

        if not interaction.guild:

            await responder.send_message("Use this in a server.", ephemeral=True)

            return

        await _maybe_defer(target, ephemeral=True, thinking=True)

        if app_commands is not None and hasattr(bot, 'tree'):

            gid = discord.Object(id=interaction.guild.id)

            bot.tree.copy_global_to(guild=gid)

            cmds = await bot.tree.sync(guild=gid)

            await responder.send_message(f"Synced {len(cmds)} commands to this server.", ephemeral=True)

        else:

            await bot.sync_commands(force=True, guild_ids=[interaction.guild.id])

            count = len(getattr(bot, 'application_commands', []) or [])

            await responder.send_message(f"Synced {count} commands to this server.", ephemeral=True)

    except Exception as e:

        await responder.send_message(f"Sync failed: {e}", ephemeral=True)





async def _ping_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "ping"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    await responder.send_message("Pong", ephemeral=True)





async def _join_command(target: object, channel: Optional[discord.VoiceChannel]) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "join"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    try:

        await _maybe_defer(target, thinking=True)

        vc = await bot.join(interaction, channel)

        await responder.send_message(f"Joined {vc.channel.mention}")

    except Exception as e:

        await responder.send_message(f"Join failed: {e}", ephemeral=True)





async def _leave_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "leave"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    vc = bot._get_guild_vc(interaction.guild)

    if not vc:

        await responder.send_message("Not connected to a voice channel.", ephemeral=True)

        return

    try:

        await vc.disconnect(force=True)

    finally:

        if interaction.guild:

            bot._set_guild_vc(interaction.guild, None)

        try:

            gid = getattr(interaction.guild, 'id', None)

            bot._write_status(gid, None)

        except Exception:

            pass

    await responder.send_message("Left the voice channel.")





async def _say_command(target: object, text: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "say"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    vc = bot._get_guild_vc(interaction.guild)

    if vc is None or not vc.is_connected():

        try:

            vc = await bot.join(interaction, None)

        except Exception as e:

            await responder.send_message(f"Not in a voice channel: {e}", ephemeral=True)

            return

    await _maybe_defer(target, thinking=True)

    try:

        await bot.speak(vc, text)

        await responder.send_message("Done.", ephemeral=True)

    except Exception as e:

        await responder.send_message(f"Failed to speak: {e}", ephemeral=True)





async def _persona_command(target: object, profile: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "act"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    bot.current_profile = (profile or "").strip()

    if not bot.current_profile:

        await responder.send_message("Persona cleared.", ephemeral=True)

    else:

        await responder.send_message(f"Persona set to: {bot.current_profile}", ephemeral=True)





async def _takeover_command(target: object, profile: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "act"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    try:

        bot.current_profile = (profile or "").strip()

        vc = await bot.join(interaction, None)

        await responder.send_message(

            f"Taking over as {bot.current_profile or 'narrator'} in {vc.channel.mention}", ephemeral=True

        )

    except Exception as e:

        await responder.send_message(f"Takeover failed: {e}", ephemeral=True)





async def _act_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "act"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    try:

        req = {

            "guild_id": getattr(interaction.guild, 'id', None),

            "channel_id": getattr(interaction.channel, 'id', None),

            "user_id": getattr(interaction.user, 'id', None),

            "username": getattr(interaction.user, 'name', None),

            "request_id": str(uuid.uuid4()),

            "timestamp": datetime.now(timezone.utc).isoformat(),

        }

        print(json.dumps({"discord_act": req}), flush=True)

        await responder.send_message("Prompting the Blossom UI to select an NPC and voice...", ephemeral=True)

    except Exception as e:

        await responder.send_message(f"Act failed: {e}", ephemeral=True)





        if app_commands is not None and hasattr(bot, 'tree'):
            # Always perform per-guild sync for immediate availability
            for g in bot.guilds:
                try:
                    gid = discord.Object(id=g.id)
                    bot.tree.copy_global_to(guild=gid)
                    cmds = await bot.tree.sync(guild=gid)
                    print(f"[discord] Synced {len(cmds)} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
        else:
            for g in bot.guilds:
                try:
                    await bot.sync_commands(force=True, guild_ids=[g.id])
                    count = len(getattr(bot, 'application_commands', []) or [])
                    print(f"[discord] Synced {count} commands to guild {g.id} ({g.name})")
                except Exception as e:
                    print(f"[discord] Guild sync failed for {getattr(g, 'id', '?')}: {e}")
    except Exception as e:
        print(f"[discord] on_ready sync error: {e}")


async def _maybe_defer(
    target: object,
    *,
    ephemeral: bool | None = None,
    thinking: bool | None = None,
) -> None:
    responder = SlashResponder(target)
    if responder.response_done():
        return
    await responder.defer(ephemeral=ephemeral, thinking=thinking)


async def _sync_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    try:

        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:

            await responder.send_message("You need Manage Server permissions to sync commands.", ephemeral=True)

            return

        if not interaction.guild:

            await responder.send_message("Use this in a server.", ephemeral=True)

            return

        await _maybe_defer(target, ephemeral=True, thinking=True)

        if app_commands is not None and hasattr(bot, 'tree'):

            gid = discord.Object(id=interaction.guild.id)

            bot.tree.copy_global_to(guild=gid)

            cmds = await bot.tree.sync(guild=gid)

            await responder.send_message(f"Synced {len(cmds)} commands to this server.", ephemeral=True)

        else:

            await bot.sync_commands(force=True, guild_ids=[interaction.guild.id])

            count = len(getattr(bot, 'application_commands', []) or [])

            await responder.send_message(f"Synced {count} commands to this server.", ephemeral=True)

    except Exception as e:

        await responder.send_message(f"Sync failed: {e}", ephemeral=True)





async def _ping_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "ping"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    await responder.send_message("Pong", ephemeral=True)





async def _join_command(target: object, channel: Optional[discord.VoiceChannel]) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "join"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    try:

        await _maybe_defer(target, thinking=True)

        vc = await bot.join(interaction, channel)

        await responder.send_message(f"Joined {vc.channel.mention}")

    except Exception as e:

        await responder.send_message(f"Join failed: {e}", ephemeral=True)





async def _leave_command(target: object) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "leave"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    vc = bot._get_guild_vc(interaction.guild)

    if not vc:

        await responder.send_message("Not connected to a voice channel.", ephemeral=True)

        return

    try:

        await vc.disconnect(force=True)

    finally:

        if interaction.guild:

            bot._set_guild_vc(interaction.guild, None)

        try:

            gid = getattr(interaction.guild, 'id', None)

            bot._write_status(gid, None)

        except Exception:

            pass

    await responder.send_message("Left the voice channel.")





async def _say_command(target: object, text: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "say"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    vc = bot._get_guild_vc(interaction.guild)

    if vc is None or not vc.is_connected():

        try:

            vc = await bot.join(interaction, None)

        except Exception as e:

            await responder.send_message(f"Not in a voice channel: {e}", ephemeral=True)

            return

    await _maybe_defer(target, thinking=True)

    try:

        await bot.speak(vc, text)

        await responder.send_message("Done.", ephemeral=True)

    except Exception as e:

        await responder.send_message(f"Failed to speak: {e}", ephemeral=True)





async def _persona_command(target: object, profile: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "act"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    bot.current_profile = (profile or "").strip()

    if not bot.current_profile:

        await responder.send_message("Persona cleared.", ephemeral=True)

    else:

        await responder.send_message(f"Persona set to: {bot.current_profile}", ephemeral=True)





async def _takeover_command(target: object, profile: str) -> None:

    responder = SlashResponder(target)

    interaction = responder.interaction

    if not bot._is_allowed(interaction, "act"):

        await responder.send_message("You are not allowed to use this command here.", ephemeral=True)

        return

    try:

        bot.current_profile = (profile or "").strip()

        vc = await bot.join(interaction, None)

        await responder.send_message(

            f"Taking over as {bot.current_profile or 'narrator'} in {vc.channel.mention}", ephemeral=True

        )

    except Exception as e:

        await responder.send_message(f"Takeover failed: {e}", ephemeral=True)







if app_commands is not None and hasattr(bot, 'tree'):

    @bot.tree.command(description="Admin: Sync slash commands in this server")
    async def sync(interaction: discord.Interaction) -> None:
        await _sync_command(interaction)

    @bot.tree.command(description="Check if the bot is alive")
    async def ping(interaction: discord.Interaction) -> None:
        await _ping_command(interaction)

    @bot.tree.command(description="Join your current voice channel")
    @app_commands.describe(channel="Voice channel to join (optional)")
    async def join(interaction: discord.Interaction, channel: Optional[discord.VoiceChannel] = None) -> None:
        await _join_command(interaction, channel)

    @bot.tree.command(description="Leave the current voice channel")
    async def leave(interaction: discord.Interaction) -> None:
        await _leave_command(interaction)

    @bot.tree.command(description="Speak text in the current voice channel")
    @app_commands.describe(text="What should I say?")
    async def say(interaction: discord.Interaction, text: str) -> None:
        await _say_command(interaction, text)

    @bot.tree.command(description="Set persona voice by profile name")
    @app_commands.describe(profile="Voice profile name (from Manage Voices / registry)")
    async def persona(interaction: discord.Interaction, profile: str) -> None:
        await _persona_command(interaction, profile)

    @bot.tree.command(description="Take over: set persona and join your voice channel")
    @app_commands.describe(profile="Voice profile name (from Manage Voices / registry)")
    async def takeover(interaction: discord.Interaction, profile: str) -> None:
        await _takeover_command(interaction, profile)

    @bot.tree.command(description="Open UI to choose an NPC and voice")
    async def act(interaction: discord.Interaction) -> None:
        await _act_command(interaction)

else:
    if Option is None:
        raise RuntimeError("discord.Option is unavailable. Install py-cord>=2.4 to use slash commands.")

    @bot.slash_command(description="Admin: Sync slash commands in this server")
    async def sync(ctx: 'discord.ApplicationContext') -> None:
        await _sync_command(ctx)

    @bot.slash_command(description="Check if the bot is alive")
    async def ping(ctx: 'discord.ApplicationContext') -> None:
        await _ping_command(ctx)

    @bot.slash_command(description="Join your current voice channel")
    async def join(
        ctx: 'discord.ApplicationContext',
        channel: Optional[discord.VoiceChannel] = Option(
            discord.VoiceChannel,
            "Voice channel to join (optional)",
            required=False,
            default=None,
        ),
    ) -> None:
        await _join_command(ctx, channel)

    @bot.slash_command(description="Leave the current voice channel")
    async def leave(ctx: 'discord.ApplicationContext') -> None:
        await _leave_command(ctx)

    @bot.slash_command(description="Speak text in the current voice channel")
    async def say(
        ctx: 'discord.ApplicationContext',
        text: str = Option(str, "What should I say?"),
    ) -> None:
        await _say_command(ctx, text)

    @bot.slash_command(description="Set persona voice by profile name")
    async def persona(
        ctx: 'discord.ApplicationContext',
        profile: str = Option(str, "Voice profile name (from Manage Voices / registry)"),
    ) -> None:
        await _persona_command(ctx, profile)

    @bot.slash_command(description="Take over: set persona and join your voice channel")
    async def takeover(
        ctx: 'discord.ApplicationContext',
        profile: str = Option(str, "Voice profile name (from Manage Voices / registry)"),
    ) -> None:
        await _takeover_command(ctx, profile)

    @bot.slash_command(description="Open UI to choose an NPC and voice")
    async def act(ctx: 'discord.ApplicationContext') -> None:
        await _act_command(ctx)





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
