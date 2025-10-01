import { convertFileSrc } from '@tauri-apps/api/core';

export function fileSrc(path) {
  if (!path || typeof path !== 'string') return '';
  try {
    const url = convertFileSrc(path);
    if (typeof url === 'string' && url.startsWith('asset://')) return url;
    // Fallback: build asset URL manually (Windows-safe)
    const norm = path.replaceAll('\\', '/');
    return 'asset://localhost/' + encodeURI(norm);
  } catch {
    // convertFileSrc not available (non-Tauri context)
    const norm = path.replaceAll('\\', '/');
    return 'asset://localhost/' + encodeURI(norm);
  }
}

