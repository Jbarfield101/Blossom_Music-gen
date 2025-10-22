import { mkdir, exists, readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { resolveResource } from '@tauri-apps/api/path';
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

const TEMPLATE_ROOT = 'assets/dnd_templates';

async function loadTemplateBody(templateName) {
  if (!templateName) {
    return '';
  }

  const normalized = templateName.endsWith('.md') ? templateName : `${templateName}.md`;
  const resourcePath = `${TEMPLATE_ROOT}/${normalized}`;

  try {
    const content = await readTextFile(resourcePath, { dir: BaseDirectory.Resource });
    if (typeof content === 'string') {
      return content;
    }
  } catch (err) {
    console.warn('createSimpleEntity: failed to load template from resource dir', resourcePath, err);
  }

  try {
    const resolvedPath = await resolveResource(resourcePath);
    const content = await readTextFile(resolvedPath);
    if (typeof content === 'string') {
      return content;
    }
  } catch (err) {
    console.warn('createSimpleEntity: failed to resolve template resource', resourcePath, err);
  }

  return '';
}

const DOMAIN_CONFIG = {
  dir: '10_World/Domains',
  defaultName: 'New Domain',
  filenamePrefix: 'Domain - ',
  template: 'Domain_Template.md',
  entityType: 'loc',
  listType: 'loc',
  resultType: 'loc',
};

const ENTITY_CONFIG = {
  quest: {
    dir: '20_DM/Quests',
    defaultName: 'New Quest',
    filenamePrefix: 'Quest - ',
    body: (name) => `# ${name}\n\n## Summary\n- ...\n\n## Milestones\n- [ ] ...\n\n## Rewards\n- ...\n`,
  },
  domain: DOMAIN_CONFIG,
  faction: {
    dir: '10_World/Factions',
    defaultName: 'New Faction',
    filenamePrefix: 'Faction - ',
    template: 'Faction_Template.md',
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

ENTITY_CONFIG.loc = DOMAIN_CONFIG;

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

async function createSimpleEntity(type, name, options = {}) {
  const config = ENTITY_CONFIG[type];
  if (!config) {
    throw new Error(`Unsupported entity type: ${type}`);
  }

  const normalizedOptions = options && typeof options === 'object' ? options : {};
  const overrideDirRaw = typeof normalizedOptions.targetDir === 'string' ? normalizedOptions.targetDir : '';
  const overrideDir = overrideDirRaw.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/');

  const displayName = normalizeName(name, config.defaultName);

  const entityType = config.entityType || type;
  const listType = config.listType || entityType;
  const resultType = config.resultType || entityType;

  const { root = await resolveVaultRoot(), entries = [] } = await listEntitiesByType(listType, { force: false }).catch(
    () => ({ root: undefined, entries: [] }),
  );

  const vaultRoot = root && root.trim() ? root.trim() : await resolveVaultRoot();
  const existingIds = new Set(entries.map((entry) => entry.id || entry.index?.id).filter(Boolean));
  const entityId = makeId(entityType, displayName, existingIds);

  const relDir = overrideDir || config.dir;
  const dirPath = resolveVaultPath(vaultRoot, relDir);
  await ensureDir(dirPath);

  const stem = `${config.filenamePrefix}${displayName}`;
  const { relPath, absPath } = await generateUniqueFilePath(vaultRoot, relDir, stem);

  const frontmatter = { id: entityId, type: entityType, name: displayName };

  let body = '';
  if (config.template) {
    body = await loadTemplateBody(config.template);
  }
  if (!body && typeof config.body === 'function') {
    body = config.body(displayName, entityId);
  }

  await saveEntity({ entity: frontmatter, body, path: absPath, format: 'markdown' });
  resetVaultIndexCache();
  return { id: entityId, path: absPath, relPath, type: resultType, name: displayName };
}

export function createQuest(name) {
  return createSimpleEntity('quest', name);
}

export function createLocation(name, options) {
  return createSimpleEntity('domain', name, options);
}

/**
 * Create a new domain entity within the DreadHaven vault.
 *
 * @param {string} name - Display name for the new domain.
 * @param {object} [options]
 * @param {string} [options.targetDir] - Relative directory (e.g., "10_World/Regions/Nir")
 *   where the domain file should be created. Defaults to the standard domains folder.
 */
export function createDomain(name, options) {
  return createSimpleEntity('domain', name, options);
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

