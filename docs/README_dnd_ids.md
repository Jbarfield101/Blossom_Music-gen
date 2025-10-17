# Dreadhaven ID reference

This guide explains how the Dreadhaven vault's NPC (and related entity) identifiers are structured, how they are created, and how to backfill them when migrating existing notes.

## ID format

IDs follow `<type>_<slug>_<suffix>` with:

- `type`: a short lowercase prefix such as `npc`, `quest`, `loc`, `faction`, `monster`, `encounter`, or `session`.
- `slug`: up to 24 lowercase characters drawn from `a-z`, `0-9`, and `-`. It is derived from the entity name by lowercasing, replacing spaces/underscores with `-`, stripping illegal characters, and collapsing duplicate dashes. Empty names fall back to `entity`.
- `suffix`: a collision-resistant random string of 4–6 characters using `0-9a-z`.

NPC-specific constants and helpers live in [`scripts/backfill_dnd_ids.py`](../scripts/backfill_dnd_ids.py#L19-L63). Front-end helpers that mirror the same rules for all entity types are in [`ui/src/lib/dndIds.js`](../ui/src/lib/dndIds.js#L1-L70), with schema definitions in [`ui/src/lib/dndSchemas.js`](../ui/src/lib/dndSchemas.js).

## Creation flow

1. When authoring content in the Tauri desktop app, IDs are generated client-side via `makeId` in `ui/src/lib/dndIds.js` before notes are synced to disk.
2. Backend scripts and tests use `generate_unique_npc_id` from `scripts/backfill_dnd_ids.py` to compute a fresh ID while avoiding collisions against the vault index.
3. `notes/index_cache.py` maintains a cached lookup table (`.blossom_index.json`) of parsed metadata so the UI and services can resolve relationships efficiently without re-parsing every Markdown file. Backfill runs update this cache after assigning new IDs.

## Migration & backfill script

Use `scripts/backfill_dnd_ids.py` to audit existing Markdown notes and inject missing IDs. Common invocations:

```bash
# Inspect planned changes without touching files
python scripts/backfill_dnd_ids.py --vault /path/to/vault --dry-run

# Apply changes and refresh the index cache in-place
python scripts/backfill_dnd_ids.py --vault /path/to/vault
```

### Required environment

- Python 3.10+ with dependencies from `requirements.txt` (or run `python start.py` to bootstrap the workspace).
- For the desktop flow, install UI packages and start Tauri once IDs are backfilled:

  ```bash
  npm install
  npm install --prefix ui
  npm run tauri dev
  ```

### What the script does

1. Walk every Markdown file in the vault, skipping hidden directories.
2. Parse frontmatter via `notes.parser.parse_note`.
3. Skip notes that already contain a valid ID (`npc_*` pattern).
4. Generate a new ID from the note's `name`/`title` and write it back to the file frontmatter.
5. Update `.blossom_index.json` through `notes.index_cache.upsert_from_file` so other tooling can immediately resolve the entity.

The script logs `updated`, `skipped`, and `errors` counts and exits with a non-zero status when errors are encountered.

## Index reference

- Location: `<vault>/.blossom_index.json`.
- Purpose: store denormalised metadata (`id`, `type`, aliases, tags, regions, relationships) for fast lookup in the UI and automation workflows.
- Maintenance: automatic updates occur during backfill runs and when the desktop app modifies notes. Use `notes.index_cache.reset_index` followed by `notes.index_cache.save_index(..., force=True)` if you need to rebuild it from scratch.

## Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Script reports parsing failures | Malformed frontmatter | Open the file, ensure `---` fences wrap valid YAML, rerun with `--dry-run` to confirm |
| Duplicate ID collision | Vault already contains generated ID | Delete the conflicting `id` field, rerun the script to regenerate |
| `.blossom_index.json` missing or stale | Script couldn't write index or app crashed | Run the script again without `--dry-run`, or call `notes.index_cache.save_index(vault, force=True)` after backfilling |
| UI still shows old data | Desktop cache not refreshed | Restart the Tauri app (`npm run tauri dev`) so it reloads the updated index |

## Verification checklist

1. Run the dry-run command against a test vault to ensure IDs would be generated as expected.
2. Inspect the log summary and sample entries for correctness.
3. Remove `--dry-run` and repeat if results look good, then launch the Tauri app to confirm the UI resolves new IDs.
4. Have another teammate follow this checklist on a fresh clone and capture any clarifications or edge cases in a follow-up commit to this document.

Keep this guide updated as new entity types or workflows are introduced.
