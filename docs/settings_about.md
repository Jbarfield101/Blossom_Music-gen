# Settings · About Panel Metrics

The desktop app's **Settings → About** section now surfaces usage counters for
cloud services that Blossom can invoke on your behalf.

## Counters and Sources

- **OpenAI Tokens** – incremented whenever a Python backend call to
  `brain.ollama_client.generate` uses the OpenAI Chat Completions API. Both
  prompt and completion tokens from the OpenAI response are tallied. If the
  API only reports a total token count, it is recorded against the prompt side.
- **ElevenLabs Characters** – incremented when voice synthesis runs through a
  voice profile tagged as ElevenLabs. The character count is derived from the
  text that was sent for synthesis.

## Reset Behaviour

Daily counters reset automatically at midnight UTC. The all-time totals
continue accumulating until the `cache/usage_metrics.json` file is removed.
This JSON file is created alongside other cache artefacts in the repository and
is safe to delete if you need to reset the totals manually.

The About panel reads the metrics via the `usage_metrics` Tauri command, which
forces a fresh snapshot before rendering. No manual refresh is required.
