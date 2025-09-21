import { invoke } from '@tauri-apps/api/core';

export const createMonster = (name, template) => invoke('monster_create', { name, template });

