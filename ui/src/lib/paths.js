import { convertFileSrc } from '@tauri-apps/api/core';

function resolveHttpFsUrl(norm) {
  if (
    typeof window !== 'undefined' &&
    typeof window.location === 'object' &&
    typeof window.location.origin === 'string'
  ) {
    return new URL(`/@fs/${encodeURI(norm)}`, window.location.origin).href;
  }
  return '';
}

export function fileSrc(path) {
  if (!path || typeof path !== 'string') return '';
  const norm = path.replaceAll('\\', '/');

  try {
    const url = convertFileSrc(path);
    if (typeof url === 'string' && url) {
<<<<<<< HEAD
=======
      if (
        typeof window !== 'undefined' &&
        typeof window.location === 'object' &&
        typeof window.location.protocol === 'string' &&
        window.location.protocol === 'http:'
      ) {
        return new URL(`/@fs/${encodeURI(norm)}`, window.location.origin).href;
      }
>>>>>>> 2b68167ac3e1523b226da87eaabf5909ccd79cf8
      return url;
    }
  } catch {
<<<<<<< HEAD
    // Fall through to non-Tauri handling below.
=======
    if (
      typeof window !== 'undefined' &&
      typeof window.location === 'object' &&
      typeof window.location.protocol === 'string' &&
      window.location.protocol === 'http:'
    ) {
      return new URL(`/@fs/${encodeURI(norm)}`, window.location.origin).href;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.location === 'object' &&
      typeof window.location.protocol === 'string' &&
      window.location.protocol.startsWith('tauri')
    ) {
      return `tauri://localhost/${encodeURI(norm)}`;
    }
    if (/^[A-Za-z]:/.test(path)) {
      return `file:///${norm}`;
    }
    return 'asset://localhost/' + encodeURI(norm);
>>>>>>> 2b68167ac3e1523b226da87eaabf5909ccd79cf8
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.location === 'object' &&
    typeof window.location.protocol === 'string' &&
    window.location.protocol.startsWith('http')
  ) {
    const httpUrl = resolveHttpFsUrl(norm);
    if (httpUrl) {
      return httpUrl;
    }
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.location === 'object' &&
    typeof window.location.protocol === 'string' &&
    window.location.protocol.startsWith('tauri')
  ) {
    return `tauri://localhost/${encodeURI(norm)}`;
  }

  if (/^[A-Za-z]:/.test(path)) {
    return `file:///${norm}`;
  }

  return `asset://localhost/${encodeURI(norm)}`;
}
