import { mkdir, exists } from '@tauri-apps/plugin-fs';
import { getDreadhavenRoot } from './config.js';
import { makeId } from '../lib/dndIds.js';
import { saveEntity } from '../lib/vaultAdapter.js';
import { listEntitiesByType, resolveVaultPath, resetVaultIndexCache } from '../lib/vaultIndex.js';

function normalizeName(name, fallback) {
  const raw = String(name ?? '').trim();
  if (raw) {
    return raw;
  }
  return fallback;
}

function sanitizeFileStem(source, fallback) {
  const raw = String(source ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const trimmed = raw.replace(/[^A-Za-z0-9 _\-]/g, '').trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 80);
}

async function ensureDir(path) {
  if (!path) return;
  await mkdir(path, { recursive: true }).catch((error) => {
    if (!/exists/i.test(String(error?.message || error))) {
      throw error;
    }
  });
}

async function resolveVaultRoot() {
  try {
    const root = await getDreadhavenRoot();
    if (typeof root === 'string' && root.trim()) {
      return root.trim();
    }
  } catch (_) {
    // Fall through to default fallback below.
  }
  return 'D:/Documents/DreadHaven';
}

const ENTITY_CONFIG = {
  quest: {
    dir: '20_DM/Quests',
    defaultName: 'New Quest',
    filenamePrefix: 'Quest - ',
    body: (name) => `# ${name}\n\n## Summary\n- ...\n\n## Milestones\n- [ ] ...\n\n## Rewards\n- ...\n`,
  },
  loc: {
    dir: '10_World/Regions',
    defaultName: 'New Location',
    filenamePrefix: 'Location - ',
    body: (name) => `# ${name}\n\n## Overview\n- ...\n\n## Points of Interest\n- ...\n`,
  },
  faction: {
    dir: '10_World/Factions',
    defaultName: 'New Faction',
    filenamePrefix: 'Faction - ',
    body: (name) => `# ${name}\n\n## Goals\n- ...\n\n## Assets\n- ...\n`,
  },
  encounter: {
    dir: '20_DM/Events',
    defaultName: 'New Encounter',
    filenamePrefix: 'Encounter - ',
    body: (name) => `# ${name}\n\n## Setup\n- ...\n\n## Beats\n- ...\n`,
  },
  session: {
    dir: '20_DM/Sessions',
    defaultName: 'Session Notes',
    filenamePrefix: 'Session - ',
    body: (name) => `# ${name}\n\n## Agenda\n- ...\n\n## Highlights\n- ...\n`,
  },
};

async function generateUniqueFilePath(root, relDir, stem) {
  const baseStem = sanitizeFileStem(stem, 'Entity');
  let attempt = 0;
  while (attempt < 50) {
    const suffix = attempt === 0 ? '' : ` ${attempt + 1}`;
    const filename = `${baseStem}${suffix}.md`;
    const relPath = `${relDir}/${filename}`;
    const absPath = resolveVaultPath(root, relPath);
    // eslint-disable-next-line no-await-in-loop
    const alreadyExists = await exists(absPath).catch(() => false);
    if (!alreadyExists) {
      return { relPath, absPath };
    }
    attempt += 1;
  }
  throw new Error('Unable to choose a unique filename for new entity');
}

async function createSimpleEntity(type, name) {
  const config = ENTITY_CONFIG[type];
  if (!config) {
    throw new Error(`Unsupported entity type: ${type}`);
  }

  const displayName = normalizeName(name, config.defaultName);

  const { root = await resolveVaultRoot(), entries = [] } = await listEntitiesByType(type, { force: false }).catch(
    () => ({ root: undefined, entries: [] }),
  );

  const vaultRoot = root && root.trim() ? root.trim() : await resolveVaultRoot();
  const existingIds = new Set(entries.map((entry) => entry.id || entry.index?.id).filter(Boolean));
  const entityId = makeId(type, displayName, existingIds);

  const relDir = config.dir;
  const dirPath = resolveVaultPath(vaultRoot, relDir);
  await ensureDir(dirPath);

  const stem = `${config.filenamePrefix}${displayName}`;
  const { relPath, absPath } = await generateUniqueFilePath(vaultRoot, relDir, stem);

  const frontmatter = { id: entityId, type, name: displayName };
  const body = typeof config.body === 'function' ? config.body(displayName, entityId) : '';

  await saveEntity({ entity: frontmatter, body, path: absPath, format: 'markdown' });
  resetVaultIndexCache();
  return { id: entityId, path: absPath, relPath, type, name: displayName };
}

export function createQuest(name) {
  return createSimpleEntity('quest', name);
}

export function createLocation(name) {
  return createSimpleEntity('loc', name);
}

export function createFaction(name) {
  return createSimpleEntity('faction', name);
}

export function createEncounter(name) {
  return createSimpleEntity('encounter', name);
}

export function createSession(name) {
  return createSimpleEntity('session', name);
}

