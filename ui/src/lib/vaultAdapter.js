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
} from './dndSchemas.js';
import { resolveRelationshipIds } from './dndIds.js';

const SCHEMA_MAP = new Map([
  ['npc', npcSchema],
  ['quest', questSchema],
  ['location', locationSchema],
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
  constructor(message, { issues = [], path = '', entityType = '', cause } = {}) {
    super(message);
    this.name = 'EntityValidationError';
    this.issues = issues;
    this.path = path;
    this.entityType = entityType;
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
    });
  }
  const schema = SCHEMA_MAP.get(entityType);
  if (!schema) {
    throw new EntityValidationError('Unknown entity type', {
      path,
      entityType,
    });
  }
  return { schema, entityType };
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
        });
      }
    }
    try {
      const entity = schema.parse(normalized);
      return {
        entity,
        body: parsed.content || '',
        path,
      };
    } catch (err) {
      throw new EntityValidationError('Entity validation failed', {
        path,
        entityType,
        issues: err?.issues || [],
        cause: err,
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
      });
    }
  }
  try {
    const entity = schema.parse(normalized);
    return {
      entity,
      body: raw || '',
      path,
    };
  } catch (err) {
    throw new EntityValidationError('Entity validation failed', {
      path,
      entityType,
      issues: err?.issues || [],
      cause: err,
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
