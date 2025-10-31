import { convertFileSrc } from '@tauri-apps/api/core';

export function fileSrc(path) {
  if (!path || typeof path !== 'string') return '';
  try {
    const url = convertFileSrc(path);
    if (typeof url === 'string' && url) return url;
    // Fallback: build asset URL manually (Windows-safe)
    const norm = path.replaceAll('\\', '/');
    return 'asset://localhost/' + encodeURI(norm);
  } catch {
    // convertFileSrc not available (non-Tauri context)
    const norm = path.replaceAll('\\', '/');
    if (
      typeof window !== 'undefined' &&
      typeof window.location === 'object' &&
      typeof window.location.protocol === 'string' &&
      window.location.protocol.startsWith('http')
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
