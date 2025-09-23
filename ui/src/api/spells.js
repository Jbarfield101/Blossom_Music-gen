import { invoke } from '@tauri-apps/api/core';

export const createSpell = (name) => invoke('spell_create', { name });
