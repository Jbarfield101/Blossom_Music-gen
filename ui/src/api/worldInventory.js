import { invoke } from '@tauri-apps/api/core';

export function fetchWorldInventorySnapshot() {
  return invoke('world_inventory_fetch');
}

export function persistWorldInventoryItem(itemId, changes) {
  return invoke('world_inventory_update_item', { itemId, changes });
}

export function moveWorldInventoryItem(itemId, targets) {
  return invoke('world_inventory_move_item', { itemId, targets });
}

export function createWorldInventoryLedgerEntry(itemId, entry) {
  return invoke('world_inventory_create_ledger_entry', { itemId, entry });
}

export function updateWorldInventoryLedgerEntry(itemId, entryId, entry) {
  return invoke('world_inventory_update_ledger_entry', { itemId, entryId, entry });
}

export function deleteWorldInventoryLedgerEntry(itemId, entryId) {
  return invoke('world_inventory_delete_ledger_entry', { itemId, entryId });
}

