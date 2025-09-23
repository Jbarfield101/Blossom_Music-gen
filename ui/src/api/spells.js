import { invoke } from '@tauri-apps/api/core';

export const createSpell = (name, template) => {
  const payload = { name };
  if (typeof template === 'string' && template.trim()) {
    payload.template = template;
  }
  return invoke('spell_create', payload);
};
