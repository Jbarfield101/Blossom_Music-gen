# LLM Orchestrator

Coordinate local large language model responses with context drawn from Obsidian notes.

## Setup

1. **Install and run Ollama**

   ```bash
   curl -fsSL https://ollama.ai/install.sh | sh
   ollama run mistral  # downloads the model and starts the server
   ```

2. **Ensure the DreadHaven lore folder exists**

   All lore lookups now use the hard-coded DreadHaven directory defined in
   `brain/constants.py`. Create the folder if it is missing (default:
   `D:\Documents\DreadHaven`) and populate it with the campaign notes.

## Command-line usage

Send a message to the orchestrator via the `dialogue.respond` helper:

```bash
python - <<'PY'
from brain import dialogue

print(dialogue.respond("Hello there!"))
PY
```

### NPC dialogue

```python
from brain import dialogue

reply = dialogue.respond("Hello, what do I know about the king?")
print(reply)
```

### Rules Q&A

```python
from brain import dialogue

reply = dialogue.respond("What are the house rules for resting?")
print(reply)
```

## JSON schema

Requests and responses can be represented with the following fields:

```json
{
  "message": "User's input text",
  "response": "Model output",
  "notes": [
    {
      "path": "npcs/king.md",
      "heading": "King",
      "content": "- King Arthur\n- Ruler of Camelot",
      "score": 0.12
    }
  ]
}
```

`notes` lists any matching note summaries injected into the prompt. Each entry records the source `path`, the note `heading`, the extracted `content` and the search `score`.
