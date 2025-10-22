const ENTITY_TYPES = new Set(['npc', 'quest', 'loc', 'domain', 'faction', 'monster', 'encounter', 'session']);
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const ENTITY_ID_PATTERN =
  /^(npc|quest|loc|domain|faction|monster|encounter|session)_[a-z0-9-]{1,24}_[a-z0-9]{4,6}$/;

function defaultRng() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] / 0xffffffff;
  }
  return Math.random();
}

function normalizeSample(sample) {
  if (!Number.isFinite(sample)) {
    return Math.random();
  }
  const value = sample % 1;
  return value < 0 ? value + 1 : value;
}

export function toSlug(name) {
  const base = String(name ?? '').trim().toLowerCase();
  if (!base) return 'entity';
  const replaced = base.replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '-');
  let slug = replaced.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) slug = 'entity';
  if (slug.length > 24) {
    slug = slug.slice(0, 24);
    slug = slug.replace(/-+$/g, '');
    if (!slug) slug = 'entity';
  }
  return slug;
}

export function makeShortId(len = 4, rng = defaultRng) {
  if (!Number.isInteger(len) || len <= 0) {
    throw new Error('makeShortId length must be a positive integer');
  }
  let out = '';
  for (let i = 0; i < len; i += 1) {
    const value = normalizeSample(rng());
    const index = Math.floor(value * ALPHABET.length) % ALPHABET.length;
    out += ALPHABET[index];
  }
  return out;
}

export function makeId(type, name, existingIds, options = {}) {
  let opts = options;
  let existing = existingIds;
  if (existing && !(existing instanceof Set)) {
    if (Array.isArray(existing)) {
      existing = new Set(existing);
    } else if (typeof existing === 'object') {
      opts = existing;
      existing = undefined;
    }
  }
  if (!ENTITY_TYPES.has(type)) {
    throw new Error(`Unsupported entity type: ${type}`);
  }
  const { rng = defaultRng, shortIdLength = 4 } = opts;
  const slug = toSlug(name) || type;
  let attempts = 0;
  const collisions = existing instanceof Set ? existing : undefined;
  while (attempts < 5) {
    const shortId = makeShortId(shortIdLength, rng);
    const candidate = `${type}_${slug}_${shortId}`;
    if (!collisions || !collisions.has(candidate)) {
      return candidate;
    }
    attempts += 1;
  }
  throw new Error(`Failed to generate unique id for ${type} after ${attempts} attempts`);
}

export { ENTITY_TYPES };

const LEDGER_KEYS = [
  'allies',
  'rivals',
  'debts_owed_to_npc',
  'debts_owed_by_npc',
];

let relationshipLookupOverride = null;
let indexCachePromise = null;
let invokeLoader;
let fsReadLoader;

function normalizeName(value) {
  if (!value && value !== 0) return '';
  return String(value).trim().toLowerCase();
}

function inferTypeFromId(id) {
  if (!id) return null;
  const parts = String(id).split('_');
  if (!parts.length) return null;
  const type = parts[0]?.toLowerCase();
  if (ENTITY_TYPES.has(type)) {
    return type;
  }
  return null;
}

function addEntry(map, key, entry) {
  if (!key) return;
  const normalizedKey = String(key).toLowerCase();
  if (!normalizedKey) return;
  let list = map.get(normalizedKey);
  if (!list) {
    list = [];
    map.set(normalizedKey, list);
  }
  if (!list.some((item) => item.id === entry.id)) {
    list.push(entry);
  }
}

function parseLegacyReference(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { type: null, name: '' };
  }
  const bracketMatch = raw.match(/^\[(?<type>[a-z]+)]\s*(?<name>.+)$/i);
  if (bracketMatch?.groups) {
    const type = normalizeName(bracketMatch.groups.type);
    const name = bracketMatch.groups.name?.trim() ?? '';
    return { type, name };
  }
  const colonIndex = raw.indexOf(':');
  if (colonIndex > 0 && colonIndex < raw.length - 1) {
    const prefix = normalizeName(raw.slice(0, colonIndex));
    const suffix = raw.slice(colonIndex + 1).trim();
    return { type: prefix || null, name: suffix };
  }
  return { type: null, name: raw };
}

async function loadInvoke() {
  if (!invokeLoader) {
    invokeLoader = import('@tauri-apps/api/core')
      .then((mod) => mod?.invoke)
      .catch(() => null);
  }
  const invoke = await invokeLoader;
  return typeof invoke === 'function' ? invoke : null;
}

async function loadReadTextFile() {
  if (!fsReadLoader) {
    fsReadLoader = import('@tauri-apps/plugin-fs')
      .then((mod) => mod?.readTextFile || mod?.default?.readTextFile || null)
      .catch(() => null);
  }
  const readTextFile = await fsReadLoader;
  return typeof readTextFile === 'function' ? readTextFile : null;
}

function selectEntry(entries, preferredType) {
  if (!entries || entries.length === 0) return null;
  if (preferredType) {
    const lower = preferredType.toLowerCase();
    const match = entries.find((item) => item.type === lower);
    if (match) {
      return match;
    }
  }
  return entries[0];
}

async function getIndexSnapshot() {
  if (!indexCachePromise) {
    indexCachePromise = (async () => {
      const empty = {
        byId: new Map(),
        byName: new Map(),
        bySlug: new Map(),
        byPrefix: new Map(),
      };
      try {
        const invoke = await loadInvoke();
        const readTextFile = await loadReadTextFile();
        if (!invoke || !readTextFile) {
          return empty;
        }
        let root;
        try {
          root = await invoke('get_dreadhaven_root');
        } catch (err) {
          console.warn('resolveRelationshipIds: failed to resolve vault root', err);
          return empty;
        }
        const resolvedRoot = typeof root === 'string' ? root.trim() : '';
        if (!resolvedRoot) {
          return empty;
        }
        const needsSlash = !resolvedRoot.endsWith('/') && !resolvedRoot.endsWith('\\');
        const indexPath = `${resolvedRoot}${needsSlash ? '/' : ''}.blossom_index.json`;
        let raw;
        try {
          raw = await readTextFile(indexPath);
        } catch (err) {
          console.warn('resolveRelationshipIds: failed to read vault index', err);
          return empty;
        }
        if (!raw) {
          return empty;
        }
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          console.warn('resolveRelationshipIds: invalid index JSON', err);
          return empty;
        }
        const entities = parsed?.entities;
        if (!entities || typeof entities !== 'object') {
          return empty;
        }
        const byId = new Map();
        const byName = new Map();
        const bySlug = new Map();
        const byPrefix = new Map();
        for (const [id, rawEntity] of Object.entries(entities)) {
          if (typeof id !== 'string' || !id) continue;
          const type = inferTypeFromId(id) || normalizeName(rawEntity?.type) || null;
          const entry = Object.freeze({ id, type });
          const lowerId = id.toLowerCase();
          if (!byId.has(lowerId)) {
            byId.set(lowerId, entry);
          }
          const names = new Set();
          if (rawEntity && typeof rawEntity === 'object') {
            if (typeof rawEntity.name === 'string') {
              const normalized = normalizeName(rawEntity.name);
              if (normalized) names.add(normalized);
            }
            if (Array.isArray(rawEntity.aliases)) {
              for (const alias of rawEntity.aliases) {
                const normalized = normalizeName(alias);
                if (normalized) names.add(normalized);
              }
            }
            if (Array.isArray(rawEntity.titles)) {
              for (const title of rawEntity.titles) {
                const normalized = normalizeName(title);
                if (normalized) names.add(normalized);
              }
            }
          }
          for (const name of names) {
            addEntry(byName, name, entry);
            const slug = toSlug(name);
            if (slug && slug !== 'entity') {
              addEntry(bySlug, slug, entry);
            }
          }
          if (rawEntity && typeof rawEntity.slug === 'string') {
            const slug = toSlug(rawEntity.slug);
            if (slug && slug !== 'entity') {
              addEntry(bySlug, slug, entry);
            }
          }
          const prefix = id.replace(/_[a-z0-9]{4,6}$/i, '');
          if (prefix) {
            const lowerPrefix = prefix.toLowerCase();
            addEntry(byPrefix, lowerPrefix, entry);
            const prefixParts = lowerPrefix.split('_');
            if (prefixParts.length === 2) {
              addEntry(byPrefix, prefixParts[1], entry);
            }
          }
        }
        return { byId, byName, bySlug, byPrefix };
      } catch (err) {
        console.warn('resolveRelationshipIds: unexpected index load failure', err);
        return empty;
      }
    })();
  }
  return indexCachePromise;
}

async function defaultLookup(reference, context = {}) {
  const candidate = String(reference ?? '').trim();
  if (!candidate) return null;
  if (ENTITY_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  const snapshot = await getIndexSnapshot();
  const { byId, byName, bySlug, byPrefix } = snapshot;
  const lowerCandidate = candidate.toLowerCase();

  const directId = byId.get(lowerCandidate);
  if (directId) {
    return directId.id;
  }

  const { type: explicitType, name: parsedName } = parseLegacyReference(candidate);
  const preferredType = ENTITY_TYPES.has(explicitType || '')
    ? explicitType
    : ENTITY_TYPES.has(context?.type || '')
    ? context.type
    : null;

  const normalizedName = normalizeName(parsedName);
  if (normalizedName) {
    const entries = byName.get(normalizedName);
    const match = selectEntry(entries, preferredType);
    if (match) {
      return match.id;
    }
  }

  const slug = toSlug(parsedName || candidate);
  if (slug && slug !== 'entity') {
    const slugEntries = bySlug.get(slug);
    const slugMatch = selectEntry(slugEntries, preferredType);
    if (slugMatch) {
      return slugMatch.id;
    }

    const typesToCheck = preferredType ? [preferredType] : Array.from(ENTITY_TYPES);
    for (const type of typesToCheck) {
      const prefixKey = `${type}_${slug}`.toLowerCase();
      const entries = byPrefix.get(prefixKey);
      const match = selectEntry(entries, type);
      if (match) {
        return match.id;
      }
    }

    const bare = byPrefix.get(slug);
    const bareMatch = selectEntry(bare, preferredType);
    if (bareMatch) {
      return bareMatch.id;
    }
  }

  const normalizedPrefix = lowerCandidate.replace(/\s+/g, '-');
  const prefixEntries = byPrefix.get(normalizedPrefix);
  const prefixMatch = selectEntry(prefixEntries, preferredType);
  if (prefixMatch) {
    return prefixMatch.id;
  }

  return null;
}

async function lookupEntityId(reference, context) {
  const candidate = String(reference ?? '').trim();
  if (!candidate) return null;
  if (ENTITY_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  if (relationshipLookupOverride) {
    try {
      const result = await relationshipLookupOverride(candidate, context);
      if (result) {
        const resolved = String(result).trim();
        if (resolved && ENTITY_ID_PATTERN.test(resolved)) {
          return resolved;
        }
      }
    } catch (err) {
      console.warn('resolveRelationshipIds: custom lookup failed', err);
    }
  }
  const resolved = await defaultLookup(candidate, context);
  if (resolved && ENTITY_ID_PATTERN.test(resolved)) {
    return resolved;
  }
  return null;
}

async function resolveLedgerEntry(entry, context) {
  if (entry == null) {
    return { value: null };
  }
  const entryNotes =
    entry && typeof entry === 'object' && entry.notes != null ? String(entry.notes) : undefined;

  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    if (typeof entry.id === 'string') {
      const trimmed = entry.id.trim();
      if (ENTITY_ID_PATTERN.test(trimmed)) {
        return { value: entryNotes ? { id: trimmed, notes: entryNotes } : { id: trimmed } };
      }
      const lookedUp = await lookupEntityId(trimmed, context);
      if (lookedUp) {
        return { value: entryNotes ? { id: lookedUp, notes: entryNotes } : { id: lookedUp } };
      }
      return { unresolved: trimmed };
    }
    const candidateKeys = ['entityId', 'entity_id', 'target', 'name', 'title'];
    for (const key of candidateKeys) {
      const value = entry[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) continue;
        const lookedUp = await lookupEntityId(trimmed, context);
        if (lookedUp) {
          return { value: entryNotes ? { id: lookedUp, notes: entryNotes } : { id: lookedUp } };
        }
        return { unresolved: trimmed };
      }
    }
    return { value: null };
  }

  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) {
      return { value: null };
    }
    if (ENTITY_ID_PATTERN.test(trimmed)) {
      return { value: { id: trimmed } };
    }
    const lookedUp = await lookupEntityId(trimmed, context);
    if (lookedUp) {
      return { value: { id: lookedUp } };
    }
    return { unresolved: trimmed };
  }

  return { value: null };
}

export async function resolveRelationshipIds(entity, options = {}) {
  if (!entity || typeof entity !== 'object') {
    return entity;
  }
  const ledger = entity.relationship_ledger;
  if (!ledger || typeof ledger !== 'object') {
    return entity;
  }
  const preferredType = ENTITY_TYPES.has(options.type || '') ? options.type : 'npc';
  const normalizedLedger = {};
  const unresolved = new Set();
  let changed = false;

  for (const key of LEDGER_KEYS) {
    const source = ledger[key];
    if (!Array.isArray(source)) {
      if (key in ledger && ledger[key] !== undefined && ledger[key] !== null) {
        normalizedLedger[key] = Array.isArray(source) ? source : [];
        changed = true;
      }
      continue;
    }
    const normalizedEntries = [];
    for (let index = 0; index < source.length; index += 1) {
      const item = source[index];
      const { value, unresolved: unresolvedValue } = await resolveLedgerEntry(item, {
        ...options,
        type: preferredType,
        ledgerKey: key,
        index,
        entity,
      });
      if (unresolvedValue) {
        unresolved.add(unresolvedValue);
        continue;
      }
      if (value) {
        normalizedEntries.push(value);
        if (!changed) {
          const original = item && typeof item === 'object' ? item : null;
          const originalId = original && typeof original.id === 'string' ? original.id.trim() : null;
          const originalNotes =
            original && original.notes != null ? String(original.notes) : undefined;
          if (originalId !== value.id || (originalNotes ?? undefined) !== (value.notes ?? undefined)) {
            changed = true;
          }
        }
      } else if (item !== undefined && item !== null) {
        changed = true;
      }
    }
    normalizedLedger[key] = normalizedEntries;
    if (!changed && source.length !== normalizedEntries.length) {
      changed = true;
    }
  }

  if (unresolved.size > 0) {
    const error = new Error(
      `Unable to resolve relationship references: ${Array.from(unresolved).join(', ')}`
    );
    error.unresolved = Array.from(unresolved);
    throw error;
  }

  if (!changed) {
    return entity;
  }

  return {
    ...entity,
    relationship_ledger: {
      ...ledger,
      ...normalizedLedger,
    },
  };
}

export function configureRelationshipIdLookup(resolver) {
  relationshipLookupOverride = typeof resolver === 'function' ? resolver : null;
}

export function resetRelationshipIdLookup() {
  relationshipLookupOverride = null;
  indexCachePromise = null;
}
