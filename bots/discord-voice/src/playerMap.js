import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

let mapping = new Map();
let backingPath = null;

export async function loadMapping(path) {
  backingPath = path;
  try {
    const raw = await readFile(path, 'utf8');
    const arr = JSON.parse(raw);
    mapping = new Map(arr.map((e) => [e.userId, e]));
  } catch {
    mapping = new Map();
  }
}

async function persist() {
  if (!backingPath) return;
  const dir = dirname(backingPath);
  await mkdir(dir, { recursive: true });
  const arr = Array.from(mapping.values());
  await writeFile(backingPath, JSON.stringify(arr, null, 2), 'utf8');
}

export function getPlayer(userId) {
  return mapping.get(userId) || null;
}

export function listPlayers() {
  return Array.from(mapping.values());
}

export async function setPlayer(userId, playerId, ttsVoiceId = null) {
  const prev = mapping.get(userId) || {};
  const entry = {
    userId,
    playerId,
    displayName: prev.displayName || null,
    ttsVoiceId: ttsVoiceId ?? prev.ttsVoiceId ?? null,
  };
  mapping.set(userId, entry);
  await persist();
  return entry;
}

export async function setVoice(userId, ttsVoiceId) {
  const prev = mapping.get(userId) || { userId, playerId: null };
  const entry = { ...prev, ttsVoiceId };
  mapping.set(userId, entry);
  await persist();
  return entry;
}

