import { invoke } from '@tauri-apps/api/core';

export const readFileBytes = (path) => invoke('read_file_bytes', { path });
export const openPath = (path) => invoke('open_path', { path });

