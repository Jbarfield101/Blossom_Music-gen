import { getDreadhavenRoot } from './config';
import { listDir } from './dir';
import { invoke } from '@tauri-apps/api/core';

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;
const DEFAULT_TEMPLATE_ABS = 'D\\\\Documents\\\\DreadHaven\\\\_Templates\\\\Race_Template.md';

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

const DEFAULT_ROOT = 'D:\\Documents\\DreadHaven';

export async function loadRaces() {
  let base = DEFAULT_ROOT;
  try {
    const vault = await getDreadhavenRoot();
    if (typeof vault === 'string' && vault.trim()) base = vault.trim();
  } catch {}
  const folder = joinSegments(base, '10_World', 'Races');
  const results = [];
  const stack = [folder];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    let entries = [];
    try { entries = await listDir(dir); } catch { entries = []; }
    for (const e of entries) {
      if (!e) continue;
      if (e.is_dir) {
        stack.push(e.path);
        continue;
      }
      if (!MARKDOWN_RE.test(e.name || '')) continue;
      const title = String(e.name || '').replace(/\.[^.]+$/, '');
      results.push({ path: e.path, name: e.name, title, modified_ms: e.modified_ms || 0 });
    }
  }
  results.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  return { root: folder, items: results };
}

export function createRace({ name, templatePath, directory, parentName = null, useLLM = true }) {
  const payload = {
    name,
    template: templatePath || DEFAULT_TEMPLATE_ABS,
    // do not set a default here; backend uses vault/10_World/Races
    directory: directory || null,
    parent: parentName || null,
    use_llm: !!useLLM,
  };
  return invoke('race_create', payload);
}

export async function saveRacePortrait({ race, subrace = '', file }) {
  if (!file) throw new Error('No file provided');
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(arrayBuffer));
  const payload = {
    race,
    subrace: subrace || null,
    filename: file.name || 'portrait.png',
    bytes,
  };
  return invoke('race_save_portrait', payload);
}
