import matter from '../../vendor/gray-matter/index.js';
import * as fsPlugin from '@tauri-apps/plugin-fs';
import {
  npcSchema,
  questSchema,
  locationSchema,
  factionSchema,
  monsterSchema,
  encounterSchema,
  sessionSchema,
  domainSchema,
} from './dndSchemas.js';
import { resolveRelationshipIds } from './dndIds.js';
import { loadVaultIndex } from './vaultIndex.js';

export const ENTITY_ERROR_CODES = Object.freeze({
  UNKNOWN_TYPE: 'entity/unknown-type',
  SCHEMA_MISSING: 'entity/schema-missing',
  RELATIONSHIP_NORMALIZATION_FAILED: 'entity/relationship-normalization-failed',
  VALIDATION_FAILED: 'entity/validation-failed',
  JSON_PARSE_FAILED: 'entity/json-parse-failed',
});

const SCHEMA_MAP = new Map([
  ['npc', npcSchema],
  ['quest', questSchema],
  ['location', locationSchema],
  ['domain', domainSchema],
  ['faction', factionSchema],
  ['monster', monsterSchema],
  ['encounter', encounterSchema],
  ['session', sessionSchema],
]);

const TYPE_ALIASES = new Map([
  ['npc', 'npc'],
  ['npcs', 'npc'],
  ['quest', 'quest'],
  ['quests', 'quest'],
  ['loc', 'location'],
  ['location', 'location'],
  ['locations', 'location'],
  ['domain', 'domain'],
  ['domains', 'domain'],
  ['domain-smith', 'domain'],
  ['faction', 'faction'],
  ['factions', 'faction'],
  ['monster', 'monster'],
  ['monsters', 'monster'],
  ['encounter', 'encounter'],
  ['encounters', 'encounter'],
  ['session', 'session'],
  ['sessions', 'session'],
]);

const defaultFs = {
  readTextFile: (...args) => fsPlugin.readTextFile(...args),
  writeTextFile: (...args) => fsPlugin.writeTextFile(...args),
};

let activeFs = { ...defaultFs };

export function configureVaultFileSystem(overrides) {
  if (!overrides) {
    activeFs = { ...defaultFs };
    return;
  }
  activeFs = {
    readTextFile: overrides.readTextFile || defaultFs.readTextFile,
    writeTextFile: overrides.writeTextFile || defaultFs.writeTextFile,
  };
}

export class EntityValidationError extends Error {
  constructor(
    message,
    { issues = [], path = '', entityType = '', cause, code = ENTITY_ERROR_CODES.VALIDATION_FAILED } = {}
  ) {
    super(message);
    this.name = 'EntityValidationError';
    this.issues = issues;
    this.path = path;
    this.entityType = entityType;
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
  }
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

function detectFormat(path, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat.toLowerCase();
  }
  const lowerPath = String(path || '').toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) {
      return 'markdown';
    }
  }
  if (lowerPath.endsWith('.json')) {
    return 'json';
  }
  return 'json';
}

function normalizeType(value) {
  if (!value) return null;
  const key = String(value).toLowerCase().trim();
  return TYPE_ALIASES.get(key) || null;
}

function inferTypeFromPath(path) {
  const segments = String(path || '')
    .split(/[\\/]+/)
    .map((segment) => normalizeType(segment))
    .filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function resolveSchema(data, path) {
  const typeFromData = normalizeType(data?.type);
  const typeFromPath = inferTypeFromPath(path);
  const entityType = typeFromData || typeFromPath;
  if (!entityType) {
    throw new EntityValidationError('Unknown entity type', {
      path,
      entityType: data?.type || typeFromPath || '',
      code: ENTITY_ERROR_CODES.UNKNOWN_TYPE,
    });
  }
  const schema = SCHEMA_MAP.get(entityType);
  if (!schema) {
    throw new EntityValidationError('Unknown entity type', {
      path,
      entityType,
      code: ENTITY_ERROR_CODES.SCHEMA_MISSING,
    });
  }
  return { schema, entityType };
}

function valueContainsEntityId(value, targetId) {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() === targetId;
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueContainsEntityId(item, targetId));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => valueContainsEntityId(item, targetId));
  }
  return false;
}

async function computeBacklinksForEntity(entityId) {
  const targetId = typeof entityId === 'string' ? entityId.trim() : '';
  if (!targetId) {
    return [];
  }
  let snapshot;
  try {
    snapshot = await loadVaultIndex({ force: false });
  } catch (err) {
    console.warn('computeBacklinksForEntity: failed to load vault index', err);
    return [];
  }
  const entities = snapshot?.entities && typeof snapshot.entities === 'object' ? snapshot.entities : {};
  const candidateKeys = ['metadata', 'fields', 'relationships', 'relationship_ledger', 'links', 'references'];
  const backlinks = [];
  const seen = new Set();

  Object.values(entities).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = typeof entry.id === 'string' ? entry.id : entry?.index?.id;
    if (!id || id === targetId) return;
    if (seen.has(id)) return;
    const hasReference = candidateKeys.some((key) => valueContainsEntityId(entry[key], targetId));
    if (!hasReference) return;
    seen.add(id);
    const type = typeof entry.type === 'string' ? entry.type : entry?.metadata?.type;
    const name = entry.name || entry.title || entry?.metadata?.name || '';
    const relPath = entry.relPath || entry.path || '';
    backlinks.push({ id, type, name, relPath });
  });

  backlinks.sort((a, b) => {
    const labelA = (a.name || a.id || '').toLowerCase();
    const labelB = (b.name || b.id || '').toLowerCase();
    if (labelA < labelB) return -1;
    if (labelA > labelB) return 1;
    return (a.id || '').localeCompare(b.id || '');
  });

  return backlinks;
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

export async function loadEntity(path) {
  if (!path) {
    throw new Error('A path is required to load an entity');
  }
  const format = detectFormat(path);
  const raw = await activeFs.readTextFile(path);
  if (format === 'markdown') {
    const parsed = matter(raw || '');
    const { schema, entityType } = resolveSchema(parsed.data || {}, path);
    let normalized = parsed.data || {};
    if (entityType === 'npc') {
      try {
        normalized = await resolveRelationshipIds(normalized);
      } catch (err) {
        throw new EntityValidationError('Failed to normalize NPC relationships', {
          path,
          entityType,
          cause: err,
          code: ENTITY_ERROR_CODES.RELATIONSHIP_NORMALIZATION_FAILED,
        });
      }
    }
    try {
      const entity = schema.parse(normalized);
      const backlinks = await computeBacklinksForEntity(entity.id);
      return {
        entity,
        body: parsed.content || '',
        path,
        backlinks,
      };
    } catch (err) {
      throw new EntityValidationError('Entity validation failed', {
        path,
        entityType,
        issues: err?.issues || [],
        cause: err,
        code: ENTITY_ERROR_CODES.VALIDATION_FAILED,
      });
    }
  }

  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (err) {
    throw new EntityValidationError('Failed to parse entity JSON', {
      path,
      entityType: inferTypeFromPath(path) || '',
      cause: err,
      code: ENTITY_ERROR_CODES.JSON_PARSE_FAILED,
    });
  }

  const { schema, entityType } = resolveSchema(data, path);
  let normalized = data;
  if (entityType === 'npc') {
    try {
      normalized = await resolveRelationshipIds(data);
    } catch (err) {
      throw new EntityValidationError('Failed to normalize NPC relationships', {
        path,
        entityType,
        cause: err,
        code: ENTITY_ERROR_CODES.RELATIONSHIP_NORMALIZATION_FAILED,
      });
    }
  }
  try {
    const entity = schema.parse(normalized);
    const backlinks = await computeBacklinksForEntity(entity.id);
    return {
      entity,
      body: raw || '',
      path,
      backlinks,
    };
  } catch (err) {
    throw new EntityValidationError('Entity validation failed', {
      path,
      entityType,
      issues: err?.issues || [],
      cause: err,
      code: ENTITY_ERROR_CODES.VALIDATION_FAILED,
    });
  }
}

export async function saveEntity({ entity, body = '', path, format }) {
  if (!path) {
    throw new Error('A path is required to save an entity');
  }
  const resolvedFormat = detectFormat(path, format);
  const { schema, entityType } = resolveSchema(entity || {}, path);
  let normalized = entity || {};
  if (entityType === 'npc') {
    try {
      normalized = await resolveRelationshipIds(normalized);
    } catch (err) {
      throw new EntityValidationError('Failed to normalize NPC relationships', {
        path,
        entityType,
        cause: err,
        code: ENTITY_ERROR_CODES.RELATIONSHIP_NORMALIZATION_FAILED,
      });
    }
  }
  let validated;
  try {
    validated = schema.parse(normalized);
  } catch (err) {
    throw new EntityValidationError('Entity validation failed', {
      path,
      entityType,
      issues: err?.issues || [],
      cause: err,
      code: ENTITY_ERROR_CODES.VALIDATION_FAILED,
    });
  }

  let payload;
  if (resolvedFormat === 'markdown') {
    const content = typeof body === 'string' ? body : '';
    payload = matter.stringify(content, validated);
  } else {
    const sorted = sortKeys(validated);
    payload = `${JSON.stringify(sorted, null, 2)}\n`;
  }

  await activeFs.writeTextFile(path, payload);
  return {
    entity: validated,
    body: resolvedFormat === 'markdown' ? (typeof body === 'string' ? body : '') : payload,
    path,
  };
}
