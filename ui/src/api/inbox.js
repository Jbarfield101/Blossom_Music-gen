import { invoke } from '@tauri-apps/api/core';

export const listInbox = (path) => invoke('inbox_list', { path });
export const readInbox = (path) => invoke('inbox_read', { path });

