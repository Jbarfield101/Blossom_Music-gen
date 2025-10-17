import matter from 'gray-matter';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import {
  npcSchema,
  questSchema,
  locationSchema,
  factionSchema,
  monsterSchema,
  encounterSchema,
  sessionSchema,
} from './dndSchemas.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

const TYPE_ALIASES = {
  location: 'loc',
  locations: 'loc',
};

const SCHEMA_BY_TYPE = {
  npc: npcSchema,
  quest: questSchema,
  loc: locationSchema,
  faction: factionSchema,
  monster: monsterSchema,
  encounter: encounterSchema,
  session: sessionSchema,
};

function detectFormat(path) {
  const lowered = String(path || '').toLowerCase();
  const dot = lowered.lastIndexOf('.');
  if (dot === -1) return 'markdown';
  const ext = lowered.slice(dot);
  return MARKDOWN_EXTENSIONS.has(ext) ? 'markdown' : 'json';
}

function normalizeType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (SCHEMA_BY_TYPE[raw]) return raw;
  if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];
  return '';
}

function inferTypeFromEntity(entity, fallbackType) {
  if (entity && typeof entity.type === 'string') {
    const normalized = normalizeType(entity.type);
    if (normalized && SCHEMA_BY_TYPE[normalized]) {
      return normalized;
    }
  }
  const fallback = normalizeType(fallbackType);
  if (fallback && SCHEMA_BY_TYPE[fallback]) {
    return fallback;
  }
  return null;
}

function normalizePath(path) {
  return String(path || '');
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, sortObject(value[key])]);
    return Object.fromEntries(entries);
  }
  return value;
}

export class VaultEntityError extends Error {
  constructor(message, { cause, path, issues } = {}) {
    super(message);
    this.name = 'VaultEntityError';
    if (cause) this.cause = cause;
    if (path) this.path = path;
    if (issues) this.issues = issues;
  }
}

function createFs(overrides = {}) {
  const fs = {
    readTextFile,
    writeTextFile,
    ...overrides,
  };
  if (typeof fs.readTextFile !== 'function' || typeof fs.writeTextFile !== 'function') {
    throw new Error('vaultAdapter requires readTextFile and writeTextFile implementations');
  }
  return fs;
}

function errorResult(message, extras = {}) {
  return { ok: false, error: { message, ...extras } };
}

export async function loadEntity(path, options = {}) {
  const fs = createFs(options.fs);
  const targetPath = normalizePath(path);
  let raw;
  try {
    raw = await fs.readTextFile(targetPath);
  } catch (cause) {
    return errorResult('Failed to read entity file', { cause, path: targetPath });
  }

  const format = options.format || detectFormat(targetPath);
  let data;
  let body = '';

  try {
    if (format === 'markdown') {
      const parsed = matter(raw ?? '');
      data = parsed.data || {};
      body = parsed.content || '';
    } else {
      data = JSON.parse(raw ?? '{}');
      body = JSON.stringify(sortObject(data), null, 2);
    }
  } catch (cause) {
    return errorResult('Failed to parse entity file', { cause, path: targetPath });
  }

  const entityType = inferTypeFromEntity(data, options.type);
  if (!entityType) {
    return errorResult('Unable to determine entity type', { path: targetPath });
  }

  const schema = SCHEMA_BY_TYPE[entityType];
  if (!schema) {
    return errorResult(`Unsupported entity type: ${entityType}`, { path: targetPath });
  }

  const parsed = schema.safeParse({ ...data, type: entityType });
  if (!parsed.success) {
    return errorResult('Entity validation failed', {
      path: targetPath,
      issues: parsed.error.issues,
    });
  }

  return {
    ok: true,
    entity: parsed.data,
    body,
    path: targetPath,
    format,
  };
}

export async function saveEntity(payload, options = {}) {
  const fs = createFs(options.fs);
  if (!payload || typeof payload !== 'object') {
    return errorResult('Invalid save payload supplied');
  }
  const {
    entity,
    body = '',
    path,
    format: payloadFormat,
  } = payload;

  if (!entity || typeof entity !== 'object') {
    return errorResult('Entity payload must be an object');
  }

  const entityType = inferTypeFromEntity(entity, entity?.type);
  if (!entityType) {
    return errorResult('Unable to determine entity type for save operation');
  }

  const schema = SCHEMA_BY_TYPE[entityType];
  if (!schema) {
    return errorResult(`Unsupported entity type: ${entityType}`);
  }

  const parsed = schema.safeParse({ ...entity, type: entityType });
  if (!parsed.success) {
    return errorResult('Entity validation failed', { issues: parsed.error.issues });
  }

  const targetPath = normalizePath(path);
  const format = payloadFormat || options.format || detectFormat(targetPath);
  let output;
  if (format === 'markdown') {
    output = matter.stringify(typeof body === 'string' ? body : '', parsed.data);
  } else {
    output = `${JSON.stringify(sortObject(parsed.data), null, 2)}\n`;
  }

  try {
    await fs.writeTextFile(targetPath, output);
  } catch (cause) {
    return errorResult('Failed to write entity file', { cause, path: targetPath });
  }

  return {
    ok: true,
    entity: parsed.data,
    path: targetPath,
    format,
  };
}
