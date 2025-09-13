"""Minimal configuration enabling speaker diarization with the Discord bot."""
import asyncio

from ears import run_bot, pyannote_diarize

asyncio.run(
    run_bot(
        "BOT_TOKEN",
        123456789012345678,
        diarizer=pyannote_diarize,
    )
)
