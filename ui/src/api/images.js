import { invoke } from '@tauri-apps/api/core';

export const saveNpcPortrait = (name, file) => new Promise(async (resolve, reject) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = await invoke('npc_save_portrait', { name, filename: file.name, bytes: Array.from(bytes) });
    resolve(path);
  } catch (e) { reject(e); }
});

export const saveGodPortrait = (name, file) => new Promise(async (resolve, reject) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = await invoke('god_save_portrait', { name, filename: file.name, bytes: Array.from(bytes) });
    resolve(path);
  } catch (e) { reject(e); }
});

