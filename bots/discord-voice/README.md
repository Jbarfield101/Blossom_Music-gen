Blossom Discord Voice Bot

This bot joins a Discord voice channel, captures per-user audio, and transcribes speech with optional Whisper API integration. It keeps a mapping of Discord users → Players → TTS voices so you always know who is speaking and what they said.

Setup

- Requirements:
  - Node.js 18+
  - ffmpeg on PATH (for resampling)
  - A Discord application + bot token (enable Guilds + GuildVoiceStates intents)
- Install deps:
  - cd bots/discord-voice
  - npm install
- Configure env:
  - Copy `.env.example` to `.env` and fill `DISCORD_TOKEN`
  - Optional: set `GUILD_ID` to register slash commands instantly to a dev server
  - Optional: set `WHISPER_API=openai` and `OPENAI_API_KEY` for real transcripts

Run

- Register slash commands (optional; also happens on startup):
  - npm run deploy:commands
- Start the bot:
  - npm start

Commands

- /join — Bot joins your current voice channel and starts listening
- /leave — Disconnect from voice
- /assign user player voice? — Map a Discord user to a Player and optional TTS voice
- /voice user voice — Update only the TTS voice mapping
- /whois user — Show mapping
- /players — List all mappings

Notes

- Per-user audio is keyed by Discord userId; no diarization is needed.
- If `WHISPER_API` is not configured, the bot logs a stub transcript with duration only.
- Transcripts are logged to stdout; adapt `handleUtterance` to forward into your app (IPC/HTTP).

