import { invoke } from '@tauri-apps/api/core';

export const listDir = (path) => invoke('dir_list', { path });

