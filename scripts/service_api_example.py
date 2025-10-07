"""Example usage of :mod:`service_api`.

This script demonstrates simple interactions such as performing a search,
listing NPC notes and fetching the raw Markdown for a note. It assumes the
DreadHaven lore directory is present (see ``brain.constants.DEFAULT_DREADHAVEN_ROOT``).
"""

from __future__ import annotations

import service_api


def main() -> None:
    # Search for chunks mentioning "dragon"
    hits = service_api.search("dragon")
    print("Search results:")
    for hit in hits:
        print(f"{hit['path']} -> {hit['score']:.2f}")

    # List NPC notes and show their aliases
    npcs = service_api.list_npcs()
    print("\nNPCs:")
    for npc in npcs:
        print(f"{npc['path']} aliases={npc['aliases']}")

    if npcs:
        # Fetch the raw Markdown for the first NPC note
        path = npcs[0]['path']
        print(f"\nContent of {path}:")
        print(service_api.get_note(path))


if __name__ == "__main__":
    main()
