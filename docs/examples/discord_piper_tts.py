"""Speak a line in a Discord voice channel using Piper TTS.

Replace ``BOT_TOKEN``, the channel ID and the model paths with real values.
"""
import asyncio

from mouth.discord_player import run_bot
from mouth import VoiceRegistry, VoiceProfile

registry = VoiceRegistry()
registry.set_profile("narrator", VoiceProfile("/path/to/narrator.onnx"))
registry.set_profile("npc", VoiceProfile("/path/to/npc.onnx"))
registry.save()

asyncio.run(
    run_bot(
        "BOT_TOKEN",
        123456789012345678,
        text="Welcome to the guild hall!",
        voice="npc",  # omit to use the narrator
        registry=registry,
        model_path="/path/to/narrator.onnx",
    )
)
