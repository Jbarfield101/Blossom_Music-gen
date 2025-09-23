import { invoke } from '@tauri-apps/api/core';

export const createGod = (name, template) => invoke('god_create', { name, template });
