import { getDreadhavenRoot } from '../api/config.js';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

const UTF8_DECODER =
  typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
const GLOBAL_ESCAPE =
  typeof globalThis !== 'undefined' ? globalThis.escape : undefined;

function decodeUtf8Bytes(bytes) {
  if (!bytes) return '';
  if (bytes instanceof Uint8Array) {
    if (UTF8_DECODER) {
      return UTF8_DECODER.decode(bytes);
    }
    let fallback = '';
    for (let i = 0; i < bytes.length; i += 1) {
      fallback += String.fromCharCode(bytes[i]);
    }
    if (typeof GLOBAL_ESCAPE === 'function') {
      try {
        return decodeURIComponent(GLOBAL_ESCAPE(fallback));
      } catch (err) {
        // Ignore decoding errors and fall back to the binary string.
      }
    }
    return fallback;
  }
  if (Array.isArray(bytes)) {
    const array = Uint8Array.from(bytes);
    if (UTF8_DECODER) {
      return UTF8_DECODER.decode(array);
    }
    let fallback = '';
    for (let i = 0; i < array.length; i += 1) {
      fallback += String.fromCharCode(array[i]);
    }
    if (typeof GLOBAL_ESCAPE === 'function') {
      try {
        return decodeURIComponent(GLOBAL_ESCAPE(fallback));
      } catch (err) {
        // Ignore decoding errors and fall back to the binary string.
      }
    }
    return fallback;
  }
  return '';
}

function normalizeRoot(root) {
  if (typeof root !== 'string') return '';
  const trimmed = root.trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\/]+$/, '');
}

function joinVaultPath(root, relPath) {
  const base = normalizeRoot(root);
  const rel = typeof relPath === 'string' ? relPath.replace(/^[/\\]+/, '') : '';
  if (!base) return rel;
  if (!rel) return base;
  const useBackslash = /\\/.test(base) && !/\//.test(base);
  const separator = useBackslash ? '\\' : '/';
  const normalizedRel = useBackslash ? rel.replace(/\//g, '\\') : rel.replace(/\\/g, '/');
  return `${base}${separator}${normalizedRel}`;
}

let cachedIndex = null;

let providerOverrides = {
  readIndexFile: null,
  invokeCommand: null,
};

export function configureVaultIndex(overrides = {}) {
  providerOverrides = {
    readIndexFile: overrides.readIndexFile || null,
    invokeCommand: overrides.invokeCommand || null,
  };
  resetVaultIndexCache();
}

export function resetVaultIndexCache() {
  cachedIndex = null;
}

async function defaultReadIndexFile() {
  let root;
  try {
    root = await getDreadhavenRoot();
  } catch (err) {
    root = null;
  }
  const candidates = [];
  if (typeof root === 'string' && root.trim()) {
    candidates.push(root.trim());
  }
  candidates.push('D:/Documents/DreadHaven');
  candidates.push('D:\\Documents\\DreadHaven');

  let lastError = null;
  for (const candidate of candidates) {
    const normalized = normalizeRoot(candidate);
    if (!normalized) continue;
    let canonicalRoot = normalized;
    try {
      const canonicalized = await invokeCommand('canonicalize_path', { path: normalized });
      if (typeof canonicalized === 'string') {
        const trimmed = canonicalized.trim();
        if (trimmed) {
          canonicalRoot = trimmed;
        }
      }
    } catch (err) {
      // Ignore canonicalization errors and fall back to the normalized path.
    }
    const indexPath = joinVaultPath(canonicalRoot, '.blossom_index.json');
    try {
      const raw = await readTextFile(indexPath);
      return { root: canonicalRoot, raw: raw ?? '', path: indexPath };
    } catch (err) {
      lastError = err;
      try {
        const bytes = await invokeCommand('read_file_bytes', { path: indexPath });
        const decoded = decodeUtf8Bytes(bytes);
        if (decoded != null) {
          return { root: canonicalRoot, raw: decoded, path: indexPath };
        }
      } catch (fallbackErr) {
        lastError = fallbackErr;
      }
    }
  }
  const error = new Error('Vault index not found');
  if (lastError) {
    error.cause = lastError;
  }
  throw error;
}

async function readIndexFile() {
  if (typeof providerOverrides.readIndexFile === 'function') {
    const result = await providerOverrides.readIndexFile();
    if (result) {
      const root = normalizeRoot(result.root || '');
      return {
        root,
        raw: result.raw ?? '',
        path: result.path || joinVaultPath(root, '.blossom_index.json'),
      };
    }
  }
  return defaultReadIndexFile();
}

async function defaultInvokeCommand(command, payload) {
  return invoke(command, payload);
}

async function invokeCommand(command, payload) {
  if (typeof providerOverrides.invokeCommand === 'function') {
    return providerOverrides.invokeCommand(command, payload);
  }
  return defaultInvokeCommand(command, payload);
}

function normalizeIndexData(raw, root) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const entities = data.entities && typeof data.entities === 'object' ? data.entities : {};
  const normalized = {};
  for (const [key, value] of Object.entries(entities)) {
    if (!key || typeof value !== 'object' || value == null) continue;
    normalized[key] = { ...value };
  }
  return { root, entities: normalized };
}

export async function loadVaultIndex({ force = false } = {}) {
  if (!cachedIndex || force) {
    const file = await readIndexFile();
    let parsed;
    try {
      parsed = file.raw ? JSON.parse(file.raw) : {};
    } catch (err) {
      const error = new Error('Failed to parse vault index JSON');
      error.cause = err;
      throw error;
    }
    cachedIndex = normalizeIndexData(parsed, file.root);
  }
  return cachedIndex;
}

export function resolveVaultPath(root, relPath) {
  return joinVaultPath(root, relPath);
}

export async function listEntitiesByType(type, { force = false } = {}) {
  const snapshot = await loadVaultIndex({ force });
  const target = typeof type === 'string' ? type.trim().toLowerCase() : '';
  const entries = [];
  for (const value of Object.values(snapshot.entities)) {
    if (!value || typeof value !== 'object') continue;
    const entityType = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
    if (target && entityType !== target) continue;
    const relPath = typeof value.path === 'string' ? value.path : '';
    const mtime = typeof value.mtime === 'number' ? value.mtime : null;
    const entry = {
      id: value.id || '',
      name: value.name || '',
      title: value.name || value.title || '',
      type: entityType,
      relPath,
      path: resolveVaultPath(snapshot.root, relPath),
      modified_ms: mtime != null ? Math.round(mtime * 1000) : null,
      index: value,
    };
    entries.push(entry);
  }
  return { root: snapshot.root, entries };
}

export async function getIndexEntityById(entityId, { force = false } = {}) {
  const id = typeof entityId === 'string' ? entityId.trim() : '';
  if (!id) return null;
  try {
    const result = await invokeCommand('vault_index_get_by_id', { entityId: id });
    if (result && typeof result === 'object') {
      return { ...result };
    }
  } catch (err) {
    console.warn('vault_index_get_by_id failed', err);
  }
  const snapshot = await loadVaultIndex({ force });
  const entity = snapshot.entities[id];
  return entity ? { ...entity } : null;
}

