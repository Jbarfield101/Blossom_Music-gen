import { getDreadhavenRoot } from './config';
import { listDir } from './dir';

const DEFAULT_REGIONS = 'D:\\Documents\\DreadHaven\\10_World\\Regions';
const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;

function joinSegments(base, ...segments) {
  const baseStr = String(base || '').replace(/[\\/]+$/, '');
  const sep = baseStr.includes('/') ? '/' : '\\';
  let result = baseStr;
  for (const raw of segments) {
    const part = String(raw || '').trim();
    if (!part) continue;
    const clean = part.replace(/[\\/]+/g, sep);
    result = result ? `${result}${sep}${clean}` : clean;
  }
  return result;
}

function normalizeSlashes(path) {
  return String(path || '').replace(/\\/g, '/');
}

function relativePath(base, target) {
  const baseNorm = normalizeSlashes(base).replace(/\/+$/, '');
  const targetNorm = normalizeSlashes(target);
  if (!baseNorm || !targetNorm.startsWith(baseNorm)) {
    return target;
  }
  return targetNorm.slice(baseNorm.length).replace(/^\/+/, '');
}

async function collectFromEstablishments(basePath, estPath, groupSegments) {
  const results = [];
  const stack = [{ dir: estPath, inner: [] }];
  const seen = new Set();
  while (stack.length) {
    const { dir, inner } = stack.pop();
    const key = normalizeSlashes(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = await listDir(dir);
    } catch (err) {
      console.warn('Failed to read establishments directory', dir, err);
      continue;
    }
    for (const entry of entries) {
      if (!entry) continue;
      const name = String(entry.name || '');
      if (entry.is_dir) {
        stack.push({ dir: entry.path, inner: [...inner, name] });
        continue;
      }
      if (!MARKDOWN_RE.test(name)) continue;
      const title = name.replace(/\.[^.]+$/, '');
      const groupSegmentsCopy = [...groupSegments];
      const categorySegments = [...inner];
      results.push({
        path: entry.path,
        name,
        title,
        groupSegments: groupSegmentsCopy,
        categorySegments,
        group: groupSegmentsCopy.join(' / '),
        region: groupSegmentsCopy[0] || '',
        location: groupSegmentsCopy.slice(1).join(' / '),
        category: categorySegments.join(' / '),
        relative: relativePath(basePath, entry.path),
        modified_ms: entry.modified_ms,
      });
    }
  }
  return results;
}

async function crawlRegions(basePath) {
  const results = [];
  const stack = [{ dir: basePath, segments: [] }];
  const seen = new Set();
  while (stack.length) {
    const { dir, segments } = stack.pop();
    const key = normalizeSlashes(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    let entries = [];
    try {
      entries = await listDir(dir);
    } catch (err) {
      console.warn('Failed to read region directory', dir, err);
      continue;
    }
    for (const entry of entries) {
      if (!entry || !entry.is_dir) continue;
      const name = String(entry.name || '');
      const nextSegments = [...segments, name];
      if (name.toLowerCase() === 'establishments') {
        const groupSegments = segments.slice();
        const collected = await collectFromEstablishments(basePath, entry.path, groupSegments);
        results.push(...collected);
      } else {
        stack.push({ dir: entry.path, segments: nextSegments });
      }
    }
  }
  return results;
}

function sortItems(items) {
  return items.sort((a, b) => {
    const groupA = (a.group || '').toLowerCase();
    const groupB = (b.group || '').toLowerCase();
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    if (titleA !== titleB) return titleA.localeCompare(titleB);
    return (a.path || '').localeCompare(b.path || '');
  });
}

export async function loadEstablishments() {
  const candidates = [];
  try {
    const vault = await getDreadhavenRoot();
    if (typeof vault === 'string' && vault.trim()) {
      candidates.push(joinSegments(vault.trim(), '10_World', 'Regions'));
    }
  } catch (err) {
    console.warn('Failed to resolve DreadHaven root for establishments', err);
  }
  if (!candidates.includes(DEFAULT_REGIONS)) {
    candidates.push(DEFAULT_REGIONS);
  }

  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await listDir(candidate);
    } catch (err) {
      lastError = err;
      continue;
    }
    try {
      const entries = await crawlRegions(candidate);
      const unique = new Map();
      for (const entry of entries) {
        if (!entry?.path) continue;
        if (!unique.has(entry.path)) {
          unique.set(entry.path, entry);
        }
      }
      return {
        root: candidate,
        items: sortItems(Array.from(unique.values())),
      };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error('Unable to load establishments.');
}

export { MARKDOWN_RE as ESTABLISHMENT_MARKDOWN_RE };
