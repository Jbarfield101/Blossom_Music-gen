import { createContext, createElement, useContext, useEffect, useMemo, useReducer } from 'react';
import {
  fetchWorldInventorySnapshot,
  persistWorldInventoryItem,
  moveWorldInventoryItem,
  createWorldInventoryLedgerEntry,
  updateWorldInventoryLedgerEntry,
  deleteWorldInventoryLedgerEntry,
} from '../api/worldInventory.js';

function slugify(value, fallback = 'item') {
  const base = value ?? fallback ?? '';
  return String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/--+/g, '-')
    || String(fallback ?? 'item');
}

function stableHash(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  const normalized = (hash >>> 0).toString(36);
  return normalized.padStart(6, '0');
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(values)) return out;
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (!str) continue;
    const lower = str.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(str);
  }
  return out;
}

function ensureStableId(prefix, entity, fallbackKey = '') {
  if (entity && typeof entity === 'object') {
    for (const key of ['id', 'uuid', 'guid', 'slug', 'key', 'identifier']) {
      const candidate = entity[key];
      if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
    const label = entity.name || entity.title || entity.label;
    if (label) {
      const slug = slugify(label);
      const hash = stableHash(
        `${label}::${entity.createdAt ?? entity.created_at ?? ''}::${entity.origin ?? entity.provenance ?? ''}::${fallbackKey}`
      );
      return `${prefix}-${slug}-${hash}`;
    }
  }
  const fallback = stableHash(`${prefix}::${fallbackKey}`);
  return `${prefix}-${fallback}`;
}

function toNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString();
  }
  const str = String(value).trim();
  if (!str) return '';
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) {
    const num = Number(str);
    if (Number.isFinite(num)) {
      const fromNum = new Date(num);
      if (!Number.isNaN(fromNum.getTime())) {
        return fromNum.toISOString();
      }
    }
    return str;
  }
  return parsed.toISOString();
}

function normalizeAttunement(raw) {
  if (!raw || typeof raw !== 'object') {
    const required = raw === true;
    return {
      required,
      restrictions: [],
      notes: '',
      attunedTo: [],
    };
  }
  const required = Boolean(raw.required ?? raw.isRequired ?? raw.mandatory);
  const notes = raw.notes ? String(raw.notes) : '';
  const restrictions = uniqueStrings(raw.restrictions ?? raw.limits ?? []);
  const attunedTo = uniqueStrings(
    raw.attunedTo ?? raw.boundTo ?? raw.by ?? raw.attuned ?? []
  );
  return {
    required,
    restrictions,
    notes,
    attunedTo,
  };
}

function normalizeCharges(raw) {
  if (!raw || typeof raw !== 'object') {
    const value = toNumber(raw, 0);
    return {
      current: value,
      maximum: value,
      recharge: '',
    };
  }
  const maximum = Math.max(0, toNumber(raw.maximum ?? raw.max ?? raw.capacity ?? 0, 0));
  const current = Math.min(maximum, Math.max(0, toNumber(raw.current ?? raw.value ?? maximum, maximum)));
  const recharge = raw.recharge ? String(raw.recharge) : '';
  return {
    current,
    maximum,
    recharge,
  };
}

function normalizeDurability(raw) {
  if (!raw || typeof raw !== 'object') {
    const value = toNumber(raw, 0);
    return {
      current: value,
      maximum: value,
      state: value <= 0 ? 'broken' : 'stable',
      notes: '',
    };
  }
  const maximum = Math.max(0, toNumber(raw.maximum ?? raw.max ?? raw.capacity ?? raw.total ?? 0, 0));
  const current = Math.min(maximum, Math.max(0, toNumber(raw.current ?? raw.value ?? maximum, maximum)));
  const state = raw.state
    ? String(raw.state)
    : raw.condition
    ? String(raw.condition)
    : current <= 0
    ? 'broken'
    : 'stable';
  const notes = raw.notes ? String(raw.notes) : '';
  return {
    current,
    maximum,
    state,
    notes,
  };
}

function normalizeLedgerEntry(entry, fallbackKey) {
  if (!entry) return null;
  const id = ensureStableId('ledger', entry, fallbackKey);
  const actor = entry.actor ? String(entry.actor) : '';
  const action = entry.action ? String(entry.action) : '';
  const notes = entry.notes ? String(entry.notes) : '';
  const timestamp = normalizeTimestamp(
    entry.timestamp ?? entry.date ?? entry.recordedAt ?? entry.recorded_at ?? ''
  );
  return {
    id,
    actor,
    action,
    notes,
    timestamp,
  };
}

function normalizeProvenance(raw, itemId) {
  if (!raw || typeof raw !== 'object') {
    return {
      origin: '',
      ledger: [],
    };
  }
  const origin = raw.origin ? String(raw.origin) : '';
  const ledgerSource = Array.isArray(raw.ledger) ? raw.ledger : Array.isArray(raw) ? raw : [];
  const ledger = ledgerSource
    .map((entry, index) => normalizeLedgerEntry(entry, `${itemId}-${index}`))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.timestamp || '';
      const bTime = b.timestamp || '';
      if (aTime === bTime) return a.id.localeCompare(b.id);
      return bTime.localeCompare(aTime);
    });
  return {
    origin,
    ledger,
  };
}

function normalizeLink(value, prefix) {
  if (!value && value !== 0) return '';
  if (typeof value === 'object') {
    return ensureStableId(prefix, value);
  }
  return String(value);
}

function normalizeItem(raw) {
  const id = ensureStableId('item', raw, raw?.name ?? raw?.title ?? raw?.slug ?? 'item');
  const name = raw?.name || raw?.title || 'Unnamed Item';
  const rarity = raw?.rarity ? String(raw.rarity).toLowerCase() : 'common';
  const type = raw?.type ? String(raw.type) : '';
  const tags = uniqueStrings(raw?.tags || []);
  const quests = uniqueStrings(raw?.quests || []);
  const tagsLower = tags.map((tag) => tag.toLowerCase());
  const questsLower = quests.map((quest) => quest.toLowerCase());
  const attunement = normalizeAttunement(raw?.attunement);
  const charges = normalizeCharges(raw?.charges);
  const durability = normalizeDurability(raw?.durability);
  const provenance = normalizeProvenance(raw?.provenance ?? {}, id);
  const description = raw?.description ? String(raw.description) : '';
  const notes = raw?.notes ? String(raw.notes) : '';
  const ownerId = normalizeLink(raw?.ownerId ?? raw?.owner?.id, 'owner');
  const containerId = normalizeLink(raw?.containerId ?? raw?.container?.id, 'container');
  const locationId = normalizeLink(raw?.locationId ?? raw?.location?.id, 'location');
  const weight = raw?.weight !== undefined ? toNumber(raw.weight, null) : null;
  const createdAt = raw?.createdAt ?? raw?.created_at ?? '';
  const updatedAt = raw?.updatedAt ?? raw?.updated_at ?? '';

  const searchParts = [
    name,
    rarity,
    type,
    tags.join(' '),
    quests.join(' '),
    description,
    notes,
    provenance.origin,
    attunement.notes,
    attunement.restrictions?.join(' ') ?? '',
  ];
  for (const entry of provenance.ledger) {
    searchParts.push(entry.actor, entry.action, entry.notes, entry.timestamp);
  }

  return {
    id,
    name,
    rarity,
    type,
    tags,
    tagsLower,
    quests,
    questsLower,
    attunement,
    charges,
    durability,
    provenance,
    description,
    notes,
    ownerId,
    containerId,
    locationId,
    weight,
    createdAt,
    updatedAt,
    searchText: searchParts
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    sortKey: `${name}`.toLowerCase(),
  };
}

function normalizeEntity(raw, prefix) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const id = ensureStableId(prefix, raw, raw?.name ?? raw?.title ?? raw?.label ?? prefix);
  const name = raw?.name || raw?.title || raw?.label || id;
  const summary = raw?.summary || raw?.description || '';
  const tags = uniqueStrings(raw?.tags || []);
  const quests = uniqueStrings(raw?.quests || []);
  return {
    id,
    name,
    summary: String(summary || ''),
    tags,
    tagsLower: tags.map((tag) => tag.toLowerCase()),
    quests,
    questsLower: quests.map((quest) => quest.toLowerCase()),
    type: raw?.type ? String(raw.type) : '',
    locationId: normalizeLink(raw?.locationId ?? raw?.location?.id, 'location'),
  };
}

function buildCollection(list, prefix, normalizer) {
  const byId = Object.create(null);
  const ids = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const normalized = normalizer(entry, prefix);
      if (!normalized || !normalized.id) continue;
      if (!byId[normalized.id]) {
        ids.push(normalized.id);
      }
      byId[normalized.id] = normalized;
    }
  }
  ids.sort((a, b) => {
    const itemA = byId[a];
    const itemB = byId[b];
    const nameA = itemA?.name ? itemA.name.toLowerCase() : '';
    const nameB = itemB?.name ? itemB.name.toLowerCase() : '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.localeCompare(b);
  });
  return { byId, allIds: ids };
}

function buildItemCollection(list) {
  const byId = Object.create(null);
  const ids = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      const normalized = normalizeItem(entry);
      if (!normalized?.id) continue;
      if (!byId[normalized.id]) {
        ids.push(normalized.id);
      }
      byId[normalized.id] = normalized;
    }
  }
  ids.sort((a, b) => {
    const itemA = byId[a];
    const itemB = byId[b];
    const nameA = itemA?.sortKey ?? '';
    const nameB = itemB?.sortKey ?? '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.localeCompare(b);
  });
  return { byId, allIds: ids };
}

function upsertItemCollection(collection, item) {
  const byId = { ...collection.byId, [item.id]: item };
  const ids = collection.allIds.includes(item.id)
    ? collection.allIds.slice()
    : [...collection.allIds, item.id];
  ids.sort((a, b) => {
    const itemA = byId[a];
    const itemB = byId[b];
    const nameA = itemA?.sortKey ?? '';
    const nameB = itemB?.sortKey ?? '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.localeCompare(b);
  });
  return { byId, allIds: ids };
}

function upsertCollection(collection, entity) {
  const byId = { ...collection.byId, [entity.id]: entity };
  const ids = collection.allIds.includes(entity.id)
    ? collection.allIds.slice()
    : [...collection.allIds, entity.id];
  ids.sort((a, b) => {
    const entityA = byId[a];
    const entityB = byId[b];
    const nameA = entityA?.name ? entityA.name.toLowerCase() : '';
    const nameB = entityB?.name ? entityB.name.toLowerCase() : '';
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.localeCompare(b);
  });
  return { byId, allIds: ids };
}

function normalizeSnapshot(snapshot) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    items: buildItemCollection(safe.items || []),
    containers: buildCollection(safe.containers || [], 'container', normalizeEntity),
    owners: buildCollection(safe.owners || [], 'owner', normalizeEntity),
    locations: buildCollection(safe.locations || [], 'location', normalizeEntity),
  };
}

function createInitialState() {
  return {
    loading: false,
    loaded: false,
    error: '',
    items: { byId: Object.create(null), allIds: [] },
    containers: { byId: Object.create(null), allIds: [] },
    owners: { byId: Object.create(null), allIds: [] },
    locations: { byId: Object.create(null), allIds: [] },
    filters: {
      search: '',
      tags: [],
      rarities: [],
      quests: [],
    },
    selectedItemId: '',
    pendingItems: {},
  };
}

function worldInventoryReducer(state, action) {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, error: '' };
    case 'loadSuccess': {
      const normalized = normalizeSnapshot(action.snapshot);
      let selectedItemId = state.selectedItemId;
      if (!selectedItemId || !normalized.items.byId[selectedItemId]) {
        selectedItemId = normalized.items.allIds[0] || '';
      }
      return {
        ...state,
        loading: false,
        loaded: true,
        error: '',
        items: normalized.items,
        containers: normalized.containers,
        owners: normalized.owners,
        locations: normalized.locations,
        selectedItemId,
      };
    }
    case 'loadError':
      return { ...state, loading: false, error: action.error || 'Unable to load world inventory.' };
    case 'selectItem':
      return { ...state, selectedItemId: action.itemId };
    case 'setFilters': {
      const nextFilters = { ...state.filters };
      if (action.filters.search !== undefined) {
        nextFilters.search = String(action.filters.search || '');
      }
      if (action.filters.tags !== undefined) {
        nextFilters.tags = uniqueStrings(action.filters.tags).map((tag) =>
          tag.toLowerCase()
        );
      }
      if (action.filters.rarities !== undefined) {
        const rarities = uniqueStrings(action.filters.rarities);
        nextFilters.rarities = rarities.map((rarity) => rarity.toLowerCase());
      }
      if (action.filters.quests !== undefined) {
        nextFilters.quests = uniqueStrings(action.filters.quests).map((quest) =>
          quest.toLowerCase()
        );
      }
      return { ...state, filters: nextFilters };
    }
    case 'upsertItem': {
      const normalizedItem = normalizeItem(action.item);
      const items = upsertItemCollection(state.items, normalizedItem);
      const selectedItemId = action.select ? normalizedItem.id : state.selectedItemId;
      return {
        ...state,
        items,
        selectedItemId: selectedItemId && items.byId[selectedItemId] ? selectedItemId : items.allIds[0] || '',
      };
    }
    case 'setCollections': {
      return {
        ...state,
        containers:
          action.containers !== undefined
            ? buildCollection(action.containers, 'container', normalizeEntity)
            : state.containers,
        owners:
          action.owners !== undefined
            ? buildCollection(action.owners, 'owner', normalizeEntity)
            : state.owners,
        locations:
          action.locations !== undefined
            ? buildCollection(action.locations, 'location', normalizeEntity)
            : state.locations,
      };
    }
    case 'setPending': {
      const next = { ...state.pendingItems };
      if (action.pending) {
        next[action.itemId] = true;
      } else {
        delete next[action.itemId];
      }
      return { ...state, pendingItems: next };
    }
    case 'setError':
      return { ...state, error: action.error || '' };
    case 'clearError':
      return { ...state, error: '' };
    default:
      return state;
  }
}

function filterItems(itemsCollection, filters, lookups = {}) {
  const owners = lookups.owners || { byId: {} };
  const containers = lookups.containers || { byId: {} };
  const locations = lookups.locations || { byId: {} };
  const search = (filters.search || '').trim().toLowerCase();
  const tagFilters = Array.isArray(filters.tags)
    ? filters.tags.map((tag) => String(tag).toLowerCase())
    : [];
  const rarityFilters = Array.isArray(filters.rarities)
    ? filters.rarities.map((rarity) => String(rarity).toLowerCase())
    : [];
  const questFilters = Array.isArray(filters.quests)
    ? filters.quests.map((quest) => String(quest).toLowerCase())
    : [];
  const tagSet = new Set(tagFilters);
  const raritySet = new Set(rarityFilters);
  const questSet = new Set(questFilters);

  return itemsCollection.allIds
    .map((id) => itemsCollection.byId[id])
    .filter(Boolean)
    .filter((item) => {
      if (search) {
        const ownerName = owners.byId[item.ownerId]?.name ?? '';
        const containerName = containers.byId[item.containerId]?.name ?? '';
        const locationName = locations.byId[item.locationId]?.name ?? '';
        const haystack = `${item.searchText} ${ownerName} ${containerName} ${locationName}`;
        if (!haystack.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (tagSet.size) {
        for (const tag of tagSet) {
          if (!item.tagsLower.includes(tag)) {
            return false;
          }
        }
      }
      if (raritySet.size && !raritySet.has(item.rarity.toLowerCase())) {
        return false;
      }
      if (questSet.size) {
        for (const quest of questSet) {
          if (!item.questsLower.includes(quest)) {
            return false;
          }
        }
      }
      return true;
    });
}

const WorldInventoryContext = createContext(null);

const defaultApi = {
  fetchSnapshot: fetchWorldInventorySnapshot,
  updateItem: persistWorldInventoryItem,
  moveItem: moveWorldInventoryItem,
  createLedgerEntry: createWorldInventoryLedgerEntry,
  updateLedgerEntry: updateWorldInventoryLedgerEntry,
  deleteLedgerEntry: deleteWorldInventoryLedgerEntry,
};

function extractItemFromResponse(payload) {
  if (!payload) return null;
  if (payload.item) return payload.item;
  if (payload.data?.item) return payload.data.item;
  if (Array.isArray(payload.items)) {
    return payload.items[0];
  }
  return payload;
}

export function WorldInventoryProvider({ children, api: apiOverride }) {
  const [state, dispatch] = useReducer(worldInventoryReducer, undefined, createInitialState);

  const api = useMemo(() => ({ ...defaultApi, ...(apiOverride || {}) }), [apiOverride]);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'loadStart' });
    api.fetchSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        dispatch({ type: 'loadSuccess', snapshot });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to load world inventory', error);
        dispatch({
          type: 'loadError',
          error:
            (error && typeof error.message === 'string' && error.message) ||
            'Unable to load world inventory.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const actions = useMemo(() => {
    const handleItemResponse = (response, options = {}) => {
      if (response && response.containers) {
        dispatch({ type: 'setCollections', containers: response.containers });
      }
      if (response && response.owners) {
        dispatch({ type: 'setCollections', owners: response.owners });
      }
      if (response && response.locations) {
        dispatch({ type: 'setCollections', locations: response.locations });
      }
      const item = extractItemFromResponse(response);
      if (item) {
        dispatch({ type: 'upsertItem', item, select: options.select });
      }
      return item;
    };

    const wrapMutation = async (itemId, mutate, options = {}) => {
      dispatch({ type: 'clearError' });
      if (itemId) {
        dispatch({ type: 'setPending', itemId, pending: true });
      }
      try {
        const result = await mutate();
        return handleItemResponse(result, options);
      } catch (error) {
        console.warn('World inventory mutation failed', error);
        dispatch({
          type: 'setError',
          error:
            (error && typeof error.message === 'string' && error.message) ||
            'Unable to update item.',
        });
        throw error;
      } finally {
        if (itemId) {
          dispatch({ type: 'setPending', itemId, pending: false });
        }
      }
    };

    return {
      refresh: async () => {
        dispatch({ type: 'loadStart' });
        try {
          const snapshot = await api.fetchSnapshot();
          dispatch({ type: 'loadSuccess', snapshot });
        } catch (error) {
          console.warn('Failed to refresh world inventory', error);
          dispatch({
            type: 'loadError',
            error:
              (error && typeof error.message === 'string' && error.message) ||
              'Unable to load world inventory.',
          });
          throw error;
        }
      },
      selectItem: (itemId) => dispatch({ type: 'selectItem', itemId }),
      setFilters: (filters) => dispatch({ type: 'setFilters', filters }),
      updateItem: (itemId, changes) =>
        wrapMutation(itemId, () => api.updateItem(itemId, changes), { select: true }),
      adjustCharges: (itemId, charges) =>
        wrapMutation(itemId, () => api.updateItem(itemId, { charges }), { select: true }),
      adjustDurability: (itemId, durability) =>
        wrapMutation(itemId, () => api.updateItem(itemId, { durability }), { select: true }),
      moveItem: (itemId, targets) =>
        wrapMutation(itemId, () => api.moveItem(itemId, targets), { select: true }),
      addLedgerEntry: (itemId, entry) =>
        wrapMutation(itemId, () => api.createLedgerEntry(itemId, entry), { select: true }),
      updateLedgerEntry: (itemId, entryId, entry) =>
        wrapMutation(itemId, () => api.updateLedgerEntry(itemId, entryId, entry), {
          select: true,
        }),
      deleteLedgerEntry: (itemId, entryId) =>
        wrapMutation(itemId, () => api.deleteLedgerEntry(itemId, entryId), { select: true }),
    };
  }, [api]);

  const value = useMemo(
    () => ({
      state,
      actions,
    }),
    [state, actions]
  );

  return createElement(WorldInventoryContext.Provider, { value }, children);
}

export function useWorldInventory() {
  const ctx = useContext(WorldInventoryContext);
  if (!ctx) {
    throw new Error('useWorldInventory must be used within a WorldInventoryProvider');
  }
  return ctx;
}

export {
  createInitialState as createWorldInventoryInitialState,
  worldInventoryReducer,
  normalizeItem,
  normalizeEntity,
  normalizeSnapshot,
  ensureStableId,
  filterItems,
};

