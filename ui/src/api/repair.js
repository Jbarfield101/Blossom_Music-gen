import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const NPC_REPAIR_EVENT = 'npc-repair::progress';

const COMMAND_CANDIDATES = [
  { name: 'npc_repair_start', buildArgs: (npcIds) => ({ npcIds }) },
  { name: 'npc_repair', buildArgs: (npcIds) => ({ npcIds }) },
  { name: 'repair_npcs', buildArgs: (npcIds) => ({ ids: npcIds }) },
];

export const startNpcRepair = async (npcIds) => {
  const normalized = Array.isArray(npcIds)
    ? npcIds.map((id) => String(id || '').trim()).filter((id) => id)
    : [];
  if (!normalized.length) {
    throw new Error('At least one NPC must be selected to start repair.');
  }

  let lastError = null;
  for (const candidate of COMMAND_CANDIDATES) {
    try {
      const args = candidate.buildArgs(normalized);
      const result = await invoke(candidate.name, args);
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error('NPC repair command is not available in this build.');
};

export const listenToNpcRepair = (handler) => listen(NPC_REPAIR_EVENT, handler);

export default {
  startNpcRepair,
  listenToNpcRepair,
};
