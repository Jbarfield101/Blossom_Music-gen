const ENTITY_TYPES = new Set(['npc', 'quest', 'loc', 'faction', 'monster', 'encounter', 'session']);
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const ENTITY_ID_PATTERN =
  /^(npc|quest|loc|faction|monster|encounter|session)_[a-z0-9-]{1,24}_[a-z0-9]{4,6}$/;

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
