import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorldInventoryInitialState,
  ensureStableId,
  filterItems,
  normalizeItem,
  worldInventoryReducer,
} from '../src/lib/worldInventoryState.js';

const BASE_ITEM = {
  name: 'Sunblade',
  type: 'Weapon',
  rarity: 'Legendary',
  tags: ['Radiant', 'Sword'],
  quests: ['Vault of Dawn'],
  attunement: { required: true, restrictions: ['Paladin'] },
  charges: { current: 3, maximum: 5, recharge: 'dawn' },
  durability: { current: 5, maximum: 5, state: 'pristine' },
  provenance: {
    origin: 'Recovered from the Dawnspire',
    ledger: [
      {
        actor: 'Archivist Lysa',
        action: 'Catalogued relic',
        notes: 'Certified authentic',
        timestamp: '2024-05-01T10:00:00Z',
      },
    ],
  },
};

test('normalizeItem produces deterministic identifiers and searchable text', () => {
  const first = normalizeItem(BASE_ITEM);
  const second = normalizeItem(BASE_ITEM);
  assert.equal(first.id, second.id, 'IDs should be deterministic across normalizations');
  assert.equal(first.tagsLower.includes('radiant'), true, 'tagsLower should normalize casing');
  assert.equal(first.questsLower.includes('vault of dawn'), true);
  assert.match(first.searchText, /archivist/, 'searchText should index provenance ledger');
  assert.equal(first.attunement.required, true);
});

test('ensureStableId falls back to hashed slug when no identifier is provided', () => {
  const idA = ensureStableId('item', { name: 'Echo Shard' });
  const idB = ensureStableId('item', { name: 'Echo Shard' });
  assert.equal(idA, idB);
  assert.match(idA, /^item-/, 'fallback identifiers should include the prefix');
});

test('filterItems applies search, tag, rarity, and quest filters', () => {
  const moonBlade = normalizeItem({ ...BASE_ITEM, name: 'Moon Blade', rarity: 'Rare', tags: ['Fey'], quests: ['Autumn Court'] });
  const stormAmulet = normalizeItem({
    ...BASE_ITEM,
    name: 'Storm Amulet',
    rarity: 'Uncommon',
    tags: ['Storm'],
    quests: ['Sky Trial'],
    provenance: { origin: 'Sky Citadel', ledger: [] },
  });
  const items = {
    byId: { [moonBlade.id]: moonBlade, [stormAmulet.id]: stormAmulet },
    allIds: [moonBlade.id, stormAmulet.id],
  };
  let results = filterItems(items, { search: '', tags: ['fey'], rarities: [], quests: [] });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, moonBlade.id, 'tag filter should pick Fey items');
  results = filterItems(items, { search: '', tags: [], rarities: ['rare'], quests: [] });
  assert.equal(results[0].id, moonBlade.id, 'rarity filter should match Rare items');
  results = filterItems(items, { search: '', tags: [], rarities: [], quests: ['sky trial'] });
  assert.equal(results[0].id, stormAmulet.id, 'quest filter should match quest entries');
  results = filterItems(items, { search: 'storm', tags: [], rarities: [], quests: [] });
  assert.equal(results[0].id, stormAmulet.id, 'search text should match item name');
});

test('worldInventoryReducer loads snapshots and maintains selection', () => {
  const initial = createWorldInventoryInitialState();
  const state = worldInventoryReducer(initial, {
    type: 'loadSuccess',
    snapshot: {
      items: [
        { id: 'item-alpha', name: 'Alpha Relic' },
        { id: 'item-beta', name: 'Beta Relic' },
      ],
      owners: [{ id: 'owner-1', name: 'Caretaker' }],
      containers: [],
      locations: [],
    },
  });
  assert.equal(state.items.allIds.length, 2);
  assert.equal(state.selectedItemId, 'item-alpha', 'first item should be selected by default');
  const next = worldInventoryReducer(state, {
    type: 'selectItem',
    itemId: 'item-beta',
  });
  assert.equal(next.selectedItemId, 'item-beta');
  const updated = worldInventoryReducer(next, {
    type: 'upsertItem',
    item: { id: 'item-beta', name: 'Beta Relic', rarity: 'rare' },
  });
  assert.equal(updated.items.byId['item-beta'].rarity, 'rare');
});
