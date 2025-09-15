This directory contains bundled Piper voice models for offline TTS.

Place extracted model folders here if you intend to ship voices with the app.
The Tauri build includes any files under this directory via tauri.conf.json
bundle.resources = ["assets/voice_models/**"].

If you already have voice models in the project root under assets/voice_models,
you can copy them here or adjust tauri.conf.json to point to that location.
