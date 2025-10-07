# Discord Configuration

Set the bot token before launching ``discord_bot.py``. Blossom first checks the
``DISCORD_TOKEN`` environment variable and then looks for a ``secrets.json``
file (the desktop app’s **Settings → Discord** page mirrors these steps).

```bash
export DISCORD_TOKEN="your_bot_token"
python discord_bot.py
```

Alternatively, create ``secrets.json`` in the project root or in the app data
directory (``%APPDATA%/com.blossom.musicgen`` on Windows,
``~/Library/Application Support/com.blossom.musicgen`` on macOS, or
``~/.local/share/com.blossom.musicgen`` on Linux):

```json
{
  "discord": {
    "botToken": "your_bot_token",
    "guildId": "optional guild id"
  }
}
```

If you prefer a text file, ``config.discord_token.set_token`` will write the
token to ``config/discord_token.txt``, which is also checked at runtime.

The Discord bot reads command permission rules from `config/discord.yaml` on startup.
Each top-level key in the file is the name of a slash command (use the full
`group subcommand` name for grouped commands).  Every command maps to two lists:

- `channels` – channel IDs where the command is allowed.  If omitted or empty,
  the command may be used in any channel.
- `roles` – role IDs permitted to invoke the command.  If omitted or empty,
  any member may use the command regardless of role.

Example configuration:

```yaml
npc:
  channels: [1234567890]
  roles: [111111]

lore:
  channels: [1234567890]
  roles: []

"scene as":
  channels: [222222]
  roles: [333333]
```

In the example above `npc` can only run in channel `1234567890` by members with
role `111111`.  The `lore` command is restricted to the same channel but has no
role requirement.  Grouped commands such as `scene as` use their qualified
command name as the key.
