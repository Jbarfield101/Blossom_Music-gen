import { invoke } from '@tauri-apps/api/core';

export const createSpell = (name, template, provider, model) => {
  const payload = { name };
  if (typeof template === 'string' && template.trim()) {
    payload.template = template;
  }
  if (typeof provider === 'string' && provider.trim()) {
    payload.provider = provider.trim();
  }
  if (typeof model === 'string' && model.trim()) {
    payload.model = model.trim();
  }
  return invoke('spell_create', payload);
};
