import { convertFileSrc } from '@tauri-apps/api/core';

export function fileSrc(path) {
  if (!path || typeof path !== 'string') return '';
  const norm = path.replaceAll('\\', '/');
  try {
    const url = convertFileSrc(path);
    if (typeof url === 'string' && url) {
      if (
        typeof window !== 'undefined' &&
        typeof window.location === 'object' &&
        typeof window.location.protocol === 'string' &&
        window.location.protocol === 'http:'
      ) {
        return new URL(`/@fs/${encodeURI(norm)}`, window.location.origin).href;
      }
      return url;
    }
    return 'asset://localhost/' + encodeURI(norm);
  } catch {
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
  }
}
