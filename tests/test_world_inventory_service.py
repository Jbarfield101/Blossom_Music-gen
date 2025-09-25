from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

import service_inventory as inv


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "inventory.sqlite"


def read_ids(entries, key="id"):
    return {entry[key] for entry in entries}


def test_create_entities_and_snapshot(db_path: Path) -> None:
    owner = inv.create_owner({"name": "Aveline", "attunement_slots": 2}, db_path=db_path)
    location = inv.create_location({"path": "World/Castle/Armory", "name": "Armory"}, db_path=db_path)
    container = inv.create_container(
        {
            "name": "Vault",
            "capacity": 5,
            "weight_capacity": 50,
            "owner_id": owner.id,
            "location_id": location.id,
            "tags": ["secure"],
        },
        db_path=db_path,
    )
    item_set = inv.create_set({"name": "Dragon Relics", "tags": ["ancient"]}, db_path=db_path)
    item = inv.create_item(
        {
            "name": "Sunblade",
            "rarity": "rare",
            "type": "weapon",
            "attunement_required": True,
            "owner_id": owner.id,
            "container_id": container.id,
            "location_id": location.id,
            "set_id": item_set.id,
            "tags": ["weapon", "holy"],
            "quests": ["Lightbringers"],
            "provenance": {"origin": "Ancient Temple"},
        },
        db_path=db_path,
    )
    ledger_entry = inv.create_ledger_entry(
        item.id,
        {"actor": "Dungeon Master", "action": "discovered", "notes": "Recovered from ruins"},
        db_path=db_path,
    )

    snapshot = inv.get_snapshot(db_path=db_path)
    assert snapshot["owners"][0]["id"] == owner.id
    assert snapshot["locations"][0]["path"] == "World/Castle/Armory"
    assert snapshot["containers"][0]["owner_id"] == owner.id
    assert snapshot["sets"][0]["id"] == item_set.id
    assert snapshot["items"][0]["id"] == item.id
    assert read_ids(snapshot["items"][0]["provenance"]["ledger"]) == {ledger_entry.id}

    change_log = inv.list_change_log(db_path=db_path)
    entity_actions = {(entry["entity_type"], entry["entity_id"], entry["action"]) for entry in change_log}
    assert ("item", item.id, "create") in entity_actions
    assert ("item", item.id, "ledger.create") in entity_actions
    assert ("container", container.id, "create") in entity_actions


def test_attunement_slots_enforced(db_path: Path) -> None:
    owner = inv.create_owner({"name": "Mira", "attunement_slots": 1}, db_path=db_path)
    inv.create_item({"name": "Ring of Power", "attunement_required": True, "owner_id": owner.id}, db_path=db_path)
    with pytest.raises(inv.ValidationError):
        inv.create_item({"name": "Second Ring", "attunement_required": True, "owner_id": owner.id}, db_path=db_path)

    non_attuned = inv.create_item({"name": "Cloak", "attunement_required": False, "owner_id": owner.id}, db_path=db_path)
    with pytest.raises(inv.ValidationError):
        inv.update_item(non_attuned.id, {"attunement_required": True}, db_path=db_path)


def test_container_capacity_enforced(db_path: Path) -> None:
    container = inv.create_container(
        {"name": "Bag of Holding", "capacity": 2, "weight_capacity": 10},
        db_path=db_path,
    )
    inv.create_item({"name": "Sword", "container_id": container.id, "weight": 3}, db_path=db_path)
    inv.create_item({"name": "Shield", "container_id": container.id, "weight": 4}, db_path=db_path)
    with pytest.raises(inv.ValidationError):
        inv.create_item({"name": "Armor", "container_id": container.id, "weight": 2}, db_path=db_path)

    stray = inv.create_item({"name": "Gem", "weight": 1}, db_path=db_path)
    with pytest.raises(inv.ValidationError):
        inv.update_item(stray.id, {"container_id": container.id, "weight": 8}, db_path=db_path)


def test_search_and_change_log(db_path: Path) -> None:
    owner = inv.create_owner({"name": "Scholar"}, db_path=db_path)
    item_one = inv.create_item(
        {
            "name": "Wand of Secrets",
            "tags": ["wand", "arcane"],
            "quests": ["Mystery"],
            "owner_id": owner.id,
        },
        db_path=db_path,
    )
    item_two = inv.create_item(
        {
            "name": "Relic of Dawn",
            "tags": ["relic"],
            "quests": ["Lightbringers"],
        },
        db_path=db_path,
    )

    ledger_entry = inv.create_ledger_entry(
        item_two.id,
        {"actor": "Archivist", "action": "catalogued", "notes": "Stored in vault"},
        db_path=db_path,
    )
    inv.update_ledger_entry(
        item_two.id,
        ledger_entry.id,
        {"notes": "Transferred to library"},
        db_path=db_path,
    )
    inv.delete_ledger_entry(item_two.id, ledger_entry.id, db_path=db_path)

    results = inv.search_items("wand", db_path=db_path)
    assert read_ids(results) == {item_one.id}

    tag_results = inv.search_items(tags=["relic"], db_path=db_path)
    assert read_ids(tag_results) == {item_two.id}

    log = inv.list_change_log(db_path=db_path)
    actions = {(entry["entity_id"], entry["action"]) for entry in log}
    assert (item_two.id, "ledger.create") in actions
    assert (item_two.id, "ledger.update") in actions
    assert (item_two.id, "ledger.delete") in actions


def test_reset_database_removes_storage(db_path: Path) -> None:
    inv.create_owner({"name": "Orchid"}, db_path=db_path)
    assert db_path.exists()
    inv.reset_database(db_path=db_path)
    assert not db_path.exists()
