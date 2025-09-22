import { getConfig } from '../api/config.js';
import { readFileBytes } from '../api/files.js';

const attachmentUrlCache = new Map();
const attachmentPromiseCache = new Map();
let customResolver = null;
let vaultPathPromise = null;

const COMMON_ATTACHMENT_DIRS = [
  'Attachments',
  'attachments',
  '30_Assets',
  '30_Assets/Images',
  '30_Assets/Images/NPC_Portraits',
  '30_Assets/Images/Monster_Portraits',
];

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function sanitizeResource(resource) {
  return String(resource || '').trim();
}

function normalizeResourceKey(resource) {
  const cleaned = sanitizeResource(resource);
  return cleaned ? cleaned.toLowerCase() : '';
}

function isAbsolutePath(path) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path);
}

function getPreferredSeparator(base) {
  if (!base) return '/';
  if (base.includes('\\') && !base.includes('/')) return '\\';
  return '/';
}

function normalizeRelativePath(relative) {
  return relative.replace(/^[\\/]+/, '');
}

function joinPath(base, relative) {
  if (!base) return relative;
  const sep = getPreferredSeparator(base);
  const normalizedBase = base.replace(/[\\/]+$/, '');
  const normalizedRelative = normalizeRelativePath(relative).replace(/[\\/]+/g, sep);
  if (!normalizedRelative) return normalizedBase;
  return `${normalizedBase}${sep}${normalizedRelative}`;
}

function guessMime(pathOrName) {
  const name = String(pathOrName || '').toLowerCase();
  const idx = name.lastIndexOf('.');
  if (idx === -1 || idx === name.length - 1) {
    return 'application/octet-stream';
  }
  const ext = name.slice(idx + 1);
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function ensureUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  if (bytes && typeof bytes === 'object' && typeof bytes.length === 'number') {
    return new Uint8Array(Array.from(bytes));
  }
  return new Uint8Array();
}

function base64FromBytes(byteArray) {
  const arr = ensureUint8Array(byteArray);
  if (!arr.length) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(arr).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    const slice = arr.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  try {
    return Buffer.from(binary, 'binary').toString('base64');
  } catch (err) {
    console.warn('Failed to encode attachment bytes to base64', err);
    return '';
  }
}

function bytesToUrl(bytes, mime) {
  const arr = ensureUint8Array(bytes);
  if (!arr.length) return '';
  try {
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([arr], { type: mime });
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn('Failed to create object URL for vault attachment', err);
  }
  try {
    const base64 = base64FromBytes(arr);
    if (base64) {
      return `data:${mime};base64,${base64}`;
    }
  } catch (err) {
    console.warn('Failed to create data URL for vault attachment', err);
  }
  return '';
}

function getVaultPath() {
  if (!vaultPathPromise) {
    try {
      const promise = Promise.resolve(getConfig('vaultPath'))
        .then((value) => (typeof value === 'string' ? value : ''))
        .catch(() => '');
      vaultPathPromise = promise;
    } catch (err) {
      vaultPathPromise = Promise.resolve('');
    }
  }
  return vaultPathPromise;
}

async function runCustomResolver(resource) {
  if (!customResolver) return '';
  try {
    const result = await customResolver(resource);
    if (!result) return '';
    if (typeof result === 'string') {
      return result;
    }
    if (typeof result === 'object') {
      if (typeof result.url === 'string' && result.url) {
        return result.url;
      }
      if (result.bytes) {
        const mime = typeof result.mime === 'string' && result.mime
          ? result.mime
          : guessMime(result.path || resource);
        const url = bytesToUrl(result.bytes, mime);
        if (url) return url;
      }
      if (typeof result.path === 'string' && result.path) {
        const url = await loadFromPath(result.path, resource);
        if (url) return url;
      }
    }
  } catch (err) {
    console.warn('Custom vault attachment resolver failed', err);
  }
  return '';
}

async function loadFromPath(path, fallbackName) {
  if (!path) return '';
  try {
    const bytes = await readFileBytes(path);
    const arr = ensureUint8Array(bytes);
    if (!arr.length) return '';
    const mime = guessMime(path || fallbackName);
    return bytesToUrl(arr, mime);
  } catch (err) {
    return '';
  }
}

async function buildCandidates(resource) {
  const sanitized = sanitizeResource(resource);
  const candidates = new Set();
  if (!sanitized) {
    return candidates;
  }
  if (isAbsolutePath(sanitized)) {
    candidates.add(sanitized);
    return candidates;
  }
  const vault = await getVaultPath();
  if (vault) {
    candidates.add(joinPath(vault, sanitized));
    if (!sanitized.includes('/') && !sanitized.includes('\\')) {
      COMMON_ATTACHMENT_DIRS.forEach((dir) => {
        candidates.add(joinPath(vault, `${dir}/${sanitized}`));
      });
    }
  }
  candidates.add(sanitized);
  return candidates;
}

export function setVaultAttachmentResolver(resolver) {
  customResolver = typeof resolver === 'function' ? resolver : null;
}

export function clearVaultAttachmentCache() {
  attachmentUrlCache.clear();
  attachmentPromiseCache.clear();
}

export function getCachedVaultAttachment(resource) {
  const key = normalizeResourceKey(resource);
  if (!key) return '';
  const cached = attachmentUrlCache.get(key);
  return typeof cached === 'string' ? cached : '';
}

export async function resolveVaultAttachment(resource) {
  const key = normalizeResourceKey(resource);
  if (!key) {
    throw new Error('Invalid vault attachment reference');
  }
  const cached = attachmentUrlCache.get(key);
  if (typeof cached === 'string' && cached) {
    return cached;
  }
  const pending = attachmentPromiseCache.get(key);
  if (pending) {
    return pending;
  }
  const promise = (async () => {
    try {
      const resolved = await runCustomResolver(resource);
      if (resolved) {
        attachmentUrlCache.set(key, resolved);
        return resolved;
      }
      const candidates = await buildCandidates(resource);
      for (const candidate of candidates) {
        const url = await loadFromPath(candidate, resource);
        if (url) {
          attachmentUrlCache.set(key, url);
          return url;
        }
      }
      throw new Error(`Unable to resolve vault attachment: ${resource}`);
    } catch (err) {
      attachmentUrlCache.delete(key);
      throw err;
    } finally {
      attachmentPromiseCache.delete(key);
    }
  })();
  attachmentPromiseCache.set(key, promise);
  return promise;
}

export function primeVaultAttachment(resource, url) {
  const key = normalizeResourceKey(resource);
  if (!key) return;
  if (url) {
    attachmentUrlCache.set(key, url);
  } else {
    attachmentUrlCache.delete(key);
  }
}
