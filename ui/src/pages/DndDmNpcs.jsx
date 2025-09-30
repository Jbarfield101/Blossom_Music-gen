import { listPiperVoices } from '../lib/piperVoices';
import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox, deleteInbox } from '../api/inbox';
import { readFileBytes } from '../api/files';
import { createNpc, saveNpc, listNpcs } from '../api/npcs';
import { loadEstablishments } from '../api/establishments';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';
import { invoke } from '@tauri-apps/api/core';

const DEFAULT_NPC = 'D\\\\Documents\\\\DreadHaven\\\\20_DM\\\\NPC'.replace(/\\\\/g, '\\\\');
const DEFAULT_PORTRAITS = 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\NPC_Portraits'.replace(/\\\\/g, '\\\\');
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function titleFromName(name) {
  try { return String(name || '').replace(/\.[^.]+$/, ''); } catch { return String(name || ''); }
}

function relLocation(base, fullPath) {
  const b = String(base || '').replace(/\\/g, '/');
  const f = String(fullPath || '').replace(/\\/g, '/');
  const parent = f.substring(0, f.lastIndexOf('/'));
  if (!b || !parent.startsWith(b)) return '';
  let rel = parent.substring(b.length).replace(/^\/+/, '');
  return rel || '';
}

function sanitizeChip(s) {
  s = String(s || '').trim();
  if (!s) return '';
  s = s.replace(/[\*_`]+/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

export default function DndDmNpcs() {
  const [items, setItems] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [sortOrder, setSortOrder] = useState('az');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [activeMeta, setActiveMeta] = useState({});
  const [activeBody, setActiveBody] = useState('');
  const [metaNotice, setMetaNotice] = useState('');
  const [metaDismissed, setMetaDismissed] = useState(false);
  const [locations, setLocations] = useState({});
  const [typeMap, setTypeMap] = useState({});
  const [portraitIndex, setPortraitIndex] = useState({});
  const [portraitUrls, setPortraitUrls] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [randName, setRandName] = useState(false);
  const [nameSuggesting, setNameSuggesting] = useState(false);
  const [selRegion, setSelRegion] = useState('');
  const [selPurpose, setSelPurpose] = useState('');
  const [customPurpose, setCustomPurpose] = useState('');
  const [createError, setCreateError] = useState('');
  const [regionOptions, setRegionOptions] = useState([]);
  const [establishmentName, setEstablishmentName] = useState('');
  const [establishmentRecord, setEstablishmentRecord] = useState('');
  const [establishments, setEstablishments] = useState([]);
  const [establishmentsLoading, setEstablishmentsLoading] = useState(false);
  const [establishmentsError, setEstablishmentsError] = useState('');
  const [establishmentsLoaded, setEstablishmentsLoaded] = useState(false);

  const [voiceProvider, setVoiceProvider] = useState('piper');
  const [voiceValue, setVoiceValue] = useState('');
  const [voiceOptions, setVoiceOptions] = useState({ piper: [], elevenlabs: [] });
  const [voiceLoading, setVoiceLoading] = useState({ piper: false, elevenlabs: false });
  // Voice selection for the NPC details popup
  const [npcList, setNpcList] = useState([]);
  const [cardVoiceProvider, setCardVoiceProvider] = useState('piper');
  const [cardVoiceValue, setCardVoiceValue] = useState('');
  const [cardVoiceSaving, setCardVoiceSaving] = useState(false);
  const [cardVoiceStatus, setCardVoiceStatus] = useState('');
const establishmentOptions = useMemo(() => {
    if (!Array.isArray(establishments) || establishments.length === 0) return [];
    return establishments.map((entry) => {
      const rawGroup = String(entry.group || '').split('/').map((part) => part.trim()).filter(Boolean);
      const region = entry.region || rawGroup[0] || '';
      const location = entry.location || rawGroup.slice(1).join(' · ');
      const title = entry.title || entry.name || entry.path || '';
      const parts = [];
      if (region) parts.push(region);
      if (location) parts.push(location);
      if (title) parts.push(title);
      const label = parts.filter(Boolean).join(' · ') || title || entry.path || '';
      return {
        value: entry.path || '',
        label,
        title,
        group: entry.group || '',
      };
    }).filter((entry) => entry.value);
  }, [establishments]);

  const selectedEstablishment = useMemo(
    () => establishmentOptions.find((entry) => entry.value === establishmentRecord) || null,
    [establishmentOptions, establishmentRecord],
  );

  const parseNpcFrontmatter = useCallback((src) => {
    const text = typeof src === 'string' ? src : '';
    const trimmed = text.trim();
    if (!trimmed || /^failed to load file/i.test(trimmed)) {
      return [{}, text, ''];
    }
    const hasOpening = /^---/.test(trimmed);
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!match) {
      const message = hasOpening
        ? 'The NPC metadata block could not be parsed. Chips may be incomplete.'
        : 'No NPC metadata frontmatter was found. Chips may be incomplete.';
      return [{}, text, message];
    }
    const lines = match[1].split(/\r?\n/);
    const meta = {};
    const stray = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const mm = rawLine.match(/^\s*([A-Za-z0-9_][A-Za-z0-9_ \-]*)\s*:\s*(.*)$/);
      if (mm) {
        const key = mm[1].trim().toLowerCase().replace(/\s+/g, '_');
        const rawVal = mm[2].trim();
        const value = rawVal.replace(/^['"]|['"]$/g, '').trim();
        if (value) meta[key] = value;
      } else {
        stray.push(line);
      }
    }
    const body = (match[2] || '').replace(/^\s*[\r\n]+/, '');
    let issue = '';
    if (Object.keys(meta).length === 0) {
      issue = 'The NPC metadata block was empty. Chips may be incomplete.';
    } else if (stray.length) {
      issue = 'Some NPC metadata entries could not be parsed. Chips may be incomplete.';
    }
    return [meta, body, issue];
  }, []);

  const crawl = useCallback(async (root) => {
    const out = [];
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const dir = stack.pop();
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      try {
        const entries = await listDir(dir);
        for (const e of entries) {
          if (e.is_dir) {
            stack.push(e.path);
          } else {
            // Only include Markdown-like files
            const isMd = /\.(md|mdx|markdown)$/i.test(e.name || '');
            if (!isMd) continue;
            out.push({
              path: e.path,
              name: e.name,
              title: titleFromName(e.name),
              modified_ms: e.modified_ms,
            });
          }
        }
      } catch (e) {
        // ignore directories that fail to read
      }
    }
    // basic sort by name
    out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return out;
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getConfig('vaultPath');
      const base = (typeof vault === 'string' && vault)
        ? `${vault}\\\\20_DM\\\\NPC`.replace(/\\\\/g, '\\\\')
        : '';
      if (base) {
        const list = await crawl(base);
        setUsingPath(base);
        setItems(Array.isArray(list) ? list : []);
        return;
      }
      throw new Error('no vault');
    } catch (e1) {
      try {
        const fallback = 'D:\\Documents\\DreadHaven\\20_DM\\NPC';
        const list = await crawl(fallback);
        setUsingPath(fallback);
        setItems(Array.isArray(list) ? list : []);
      } catch (e2) {
        console.error(e2);
        setError(e2?.message || String(e2));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [crawl]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Build region options by crawling directories under Regions (exclude Establishments)
  useEffect(() => {
    (async () => {
      try {
        const vault = await getConfig('vaultPath');
        const base = (typeof vault === 'string' && vault)
          ? `${vault}\\\\10_World\\\\Regions`.replace(/\\\\/g, '\\\\')
          : 'D:\\Documents\\DreadHaven\\10_World\\Regions';
        const stack = [base];
        const seen = new Set();
        const dirs = new Set();
        while (stack.length) {
          const dir = stack.pop();
          if (!dir || seen.has(dir)) continue;
          seen.add(dir);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (e.is_dir) {
              if ((e.name || '').toLowerCase() === 'establishments') continue;
              stack.push(e.path);
              const rel = relLocation(base, `${e.path}/dummy`);
              if (rel) dirs.add(rel);
            }
          }
        }
        const arr = Array.from(dirs).sort((a,b)=>a.localeCompare(b));
        setRegionOptions(['', ...arr]);
      } catch {
        setRegionOptions(['']);
      }
    })();
  }, []);

  // Load establishments scoped to the selected region (faster, clearer)
  useEffect(() => {
    if (!showCreate) return;
    // Only load when creating a Shopkeeper
    if (selPurpose !== 'Shopkeeper') return;
    let cancelled = false;
    setEstablishmentsLoading(true);
    setEstablishmentsError('');
    (async () => {
      try {
        // Determine Regions root
        const vault = await getConfig('vaultPath');
        const regionsRoot = (typeof vault === 'string' && vault)
          ? `${vault}\\10_World\\Regions`
          : 'D:\\Documents\\DreadHaven\\10_World\\Regions';
        // Resolve region path
        const regionPath = selRegion
          ? `${regionsRoot}\\${selRegion.replace(/\\/g,'/').replace(/\/+/, '').replace(/\//g,'\\')}`
          : regionsRoot;
        const estPath = `${regionPath}\\Establishments`;
        setEstablishmentsRoot(estPath);

        // Crawl Establishments folder recursively for markdown files
        const stack = [estPath];
        const seen = new Set();
        const acc = [];
        while (stack.length) {
          const dir = stack.pop();
          if (!dir) continue;
          const key = dir.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (!e) continue;
            if (e.is_dir) { stack.push(e.path); continue; }
            if (!/\.(md|mdx|markdown)$/i.test(e.name || '')) continue;
            const title = String(e.name || '').replace(/\.[^.]+$/, '');
            acc.push({ path: e.path, title, name: e.name, group: selRegion || '', region: selRegion || '', location: '' });
          }
        }
        if (!cancelled) {
          // Sort by title
          acc.sort((a,b)=> String(a.title).localeCompare(String(b.title)));
          setEstablishments(acc);
          setEstablishmentsLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setEstablishments([]);
          setEstablishmentsError(err?.message || String(err));
        }
      } finally {
        if (!cancelled) setEstablishmentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showCreate, selPurpose, selRegion]);

  useEffect(() => {
    if (selPurpose !== 'Shopkeeper') {
      setEstablishmentName('');
      setEstablishmentRecord('');
    }
  }, [selPurpose]);

  useEffect(() => {
    if (!establishmentRecord) return;
    const match = establishments.find((entry) => entry.path === establishmentRecord);
    if (!match) return;
    const defaultName = match.title || match.name || '';
    if (!defaultName) return;
    setEstablishmentName((prev) => (prev ? prev : defaultName));
  }, [establishmentRecord, establishments]);

  // Build portrait index from Assets folder (optional)
  useEffect(() => {
    (async () => {
      try {
        const vault = await getConfig('vaultPath');
        const base = (typeof vault === 'string' && vault)
          ? `${vault}\\\\30_Assets\\\\Images\\\\NPC_Portraits`.replace(/\\\\/g, '\\\\')
          : DEFAULT_PORTRAITS;

        // Recursively crawl portrait folders (images may be nested)
        const stack = [base];
        const idx = {};
        const seen = new Set();
        const normalize = (s) => String(s || '')
          .replace(/\.[^.]+$/, '')
          .replace(/^portrait[_\-\s]+/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        while (stack.length) {
          const dir = stack.pop();
          if (!dir || seen.has(dir)) continue;
          seen.add(dir);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (e.is_dir) {
              stack.push(e.path);
            } else if (IMG_RE.test(e.name)) {
              const key = normalize(e.name);
              if (key && !idx[key]) idx[key] = e.path;
            }
          }
        }
        setPortraitIndex(idx);
      } catch (e) {
        setPortraitIndex({});
      }
    })();
  }, []);

  // Load portraits on demand
  useEffect(() => {
    let cancelled = false;
    const normalize = (s) => String(s || '')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    (async () => {
      for (const it of items) {
        if (portraitUrls[it.path]) continue;
        const key = normalize((it.title || it.name || ''));
        const imgPath = portraitIndex[key];
        if (!imgPath) continue;
        try {
          const bytes = await readFileBytes(imgPath);
          if (cancelled) return;
          const ext = imgPath.split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png'
            : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : ext === 'bmp' ? 'image/bmp'
            : ext === 'svg' ? 'image/svg+xml'
            : 'application/octet-stream';
          const blob = new Blob([new Uint8Array(bytes)], { type: mime });
          const url = URL.createObjectURL(blob);
          if (!cancelled) {
            setPortraitUrls((prev) => ({ ...prev, [it.path]: url }));
          }
        } catch (e) {/* ignore */}
      }
    })();
    return () => { cancelled = true; };
  }, [items, portraitIndex]);

  // Extract optional location from frontmatter or KV; fallback to relative folder path
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (locations[it.path] !== undefined) continue;
        try {
          const text = await readInbox(it.path);
          if (cancelled) return;
          const src = String(text || '');
          const fm = src.match(/^---\n([\s\S]*?)\n---/);
          let loc = '';
          let typ = '';
          if (fm) {
            const body = fm[1];
            const line = body.split(/\r?\n/).find((l) => /^\s*location\s*:/i.test(l));
            if (line) loc = line.split(':').slice(1).join(':').trim();
            const tline = body.split(/\r?\n/).find((l) => /^(purpose|occupation|role|job|profession|type)\s*:/i.test(l));
            if (tline) typ = tline.split(':').slice(1).join(':').trim();
          }
          if (!loc) {
            const m = src.match(/\bLocation\s*:\s*([^\n\r]+)/i);
            if (m) loc = m[1].trim();
          }
          if (!typ) {
            const m2 = src.match(/\b(Purpose|Occupation|Role|Job|Profession|Type)\s*:\s*([^\n\r]+)/i);
            if (m2) typ = m2[2].trim();
          }
          if (!loc) {
            loc = relLocation(usingPath, it.path);
          }
          setLocations((prev) => ({ ...prev, [it.path]: sanitizeChip(loc) }));
          if (typ) setTypeMap((prev) => ({ ...prev, [it.path]: sanitizeChip(typ) }));
        } catch {/* ignore */}
      }
    })();
    return () => { cancelled = true; };
  }, [items, usingPath]);

  const selected = useMemo(() => items.find((i) => i.path === activePath), [items, activePath]);

  const derivedTitle = useMemo(() => {
    const meta = activeMeta || {};
    if (meta.title) return sanitizeChip(meta.title);
    if (meta.name) return sanitizeChip(meta.name);
    const src = String(activeContent || '');
    // First markdown H1 heading
    const h1 = src.match(/^\s*#\s+([^\r\n]+)$/m);
    if (h1 && h1[1]) return sanitizeChip(h1[1]);
    const nm = src.match(/\b(?:NPC\s+Name|Name)\s*:\s*([^\r\n]+)/i);
    if (nm && nm[1]) return sanitizeChip(nm[1]);
    return String(selected?.title || selected?.name || '');
  }, [activeMeta, activeContent, selected]);

  const typeOptions = useMemo(() => {
    const vals = Object.values(typeMap).map((v) => sanitizeChip(v)).filter(Boolean);
    return Array.from(new Set(vals)).sort((a,b)=>a.localeCompare(b));
  }, [typeMap]);

  const locationOptions = useMemo(() => {
    const vals = Object.values(locations).map((v) => sanitizeChip(v)).filter(Boolean);
    return Array.from(new Set(vals)).sort((a,b)=>a.localeCompare(b));
  }, [locations]);

  const visibleItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    let arr = items.filter((it) => {
      const title = String(it.title || it.name || '').toLowerCase();
      const loc = String(locations[it.path] || '').toLowerCase();
      const textHit = !q || title.includes(q) || loc.includes(q);
      if (!textHit) return false;
      if (filterType) {
        const t = String(typeMap[it.path] || '').toLowerCase();
        if (t !== filterType.toLowerCase()) return false;
      }
      if (filterLocation) {
        const l = String(loc || '').toLowerCase();
        if (l !== filterLocation.toLowerCase()) return false;
      }
      return true;
    });
    const out = arr.slice();
    if (sortOrder === 'recent') {
      out.sort((a, b) => Number(b.modified_ms || 0) - Number(a.modified_ms || 0));
    } else if (sortOrder === 'za') {
      out.sort((a, b) => String(b.title || b.name || '').localeCompare(String(a.title || a.name || '')));
    } else {
      out.sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
    }
    return out;
  }, [items, filterText, filterType, filterLocation, sortOrder, locations, typeMap]);

  // Back-compat alias to avoid any lingering references during hot reloads
  const filteredItems = visibleItems;

  const metadataChips = useMemo(() => {
    const meta = activeMeta || {};
    const chips = [];
    const usedKeys = new Set();
    const seen = new Set();
    const plan = [
      { keys: ['aliases', 'alias'], split: /[,;|]/, prefix: '' },
      { keys: ['pronouns', 'pronoun'], prefix: 'Pronouns: ' },
      { keys: ['tags', 'tag', 'keywords', 'keyword'], split: /[,;|]/, prefix: '' },
      { keys: ['occupation', 'occupations', 'job', 'jobs', 'role', 'roles', 'profession', 'professions', 'position'], split: /[,;|]/, prefix: '' },
      { keys: ['faction', 'factions', 'affiliation', 'affiliations', 'organization', 'organizations', 'group', 'groups', 'clan', 'guild'], split: /[,;|]/, prefix: '' },
      { keys: ['race', 'ancestry', 'species', 'heritage', 'lineage'], prefix: '' },
      { keys: ['demeanor', 'attitude', 'mood', 'vibe'], prefix: '' },
      { keys: ['quirks', 'quirk', 'traits', 'trait'], split: /[,;|]/, prefix: '' },
      { keys: ['status'], prefix: 'Status: ' },
      { keys: ['rank'], prefix: 'Rank: ' },
      { keys: ['age'], prefix: 'Age: ' },
      { keys: ['gender'], prefix: 'Gender: ' },
    ];
    const ignore = new Set(['title', 'name', 'location', 'summary', 'description', 'notes', 'body', 'portrait', 'image', 'img', 'thumbnail']);
    const formatKey = (key) => key
      .split('_')
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .trim();
    const addValues = (rawValue, key, { prefix, split }) => {
      if (rawValue === undefined || rawValue === null) return;
      const str = String(rawValue);
      if (!str.trim()) return;
      const parts = split ? str.split(split) : [str];
      let added = false;
      for (const part of parts) {
        const clean = sanitizeChip(part);
        if (!clean) continue;
        const label = prefix === undefined
          ? `${formatKey(key)}: ${clean}`
          : prefix === '' ? clean : `${prefix}${clean}`;
        const dedupeKey = `${key}:${label.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        chips.push({ id: dedupeKey, label });
        added = true;
      }
      if (added) usedKeys.add(key);
    };

    plan.forEach((entry) => {
      entry.keys.forEach((key) => {
        if (meta[key] === undefined) return;
        addValues(meta[key], key, entry);
      });
    });

    Object.entries(meta).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (usedKeys.has(key)) return;
      if (ignore.has(key)) return;
      const clean = sanitizeChip(value);
      if (!clean) return;
      const label = `${formatKey(key)}: ${clean}`;
      const dedupeKey = `${key}:${label.toLowerCase()}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      chips.push({ id: dedupeKey, label });
    });

    return chips;
  }, [activeMeta]);

  const locationLabel = useMemo(() => {
    if (!selected) return '';
    const metaLoc = sanitizeChip(activeMeta.location);
    if (metaLoc) return metaLoc;
    return locations[selected.path] || relLocation(usingPath, selected.path) || '';
  }, [selected, activeMeta.location, locations, usingPath]);

  const markdownSource = useMemo(() => {
    const fallback = typeof activeContent === 'string' ? activeContent : '';
    return activeBody || fallback;
  }, [activeBody, activeContent]);

  useEffect(() => {
    let cancelled = false;
    if (!activePath) {
      setActiveContent('');
      setActiveMeta({});
      setActiveBody('');
      setMetaNotice('');
      setMetaDismissed(false);
      return () => { cancelled = true; };
    }
    setActiveContent('');
    setActiveMeta({});
    setActiveBody('');
    setMetaNotice('');
    setMetaDismissed(false);
    (async () => {
      try {
        const text = await readInbox(activePath);
        if (!cancelled) setActiveContent(text || '');
      } catch (e) {
        if (!cancelled) setActiveContent('Failed to load file.');
      }
    })();
    return () => { cancelled = true; };
  }, [activePath]);

  useEffect(() => {
    if (!selected) {
      setActiveMeta({});
      setActiveBody('');
      if (metaNotice) setMetaNotice('');
      return;
    }
    const text = typeof activeContent === 'string' ? activeContent : '';
    if (!text.trim()) {
      setActiveMeta({});
      setActiveBody('');
      if (metaNotice) setMetaNotice('');
      return;
    }
    const [meta, body, issue] = parseNpcFrontmatter(text);
    setActiveMeta(meta);
    setActiveBody(body);
    setMetaNotice(issue);
  }, [selected, activeContent, parseNpcFrontmatter]);

  useEffect(() => {
    if (!metaNotice) {
      setMetaDismissed(false);
    }
  }, [metaNotice]);

  // Load NPCs for existing voice mappings
  useEffect(() => {
    (async () => {
      try {
        const list = await listNpcs();
        setNpcList(Array.isArray(list) ? list : []);
      } catch {
        setNpcList([]);
      }
    })();
  }, []);

  // Helper: decode provider from stored voice string
  const decodeVoiceValue = useCallback((value) => {
    if (typeof value !== 'string') return { provider: 'piper', voice: '' };
    const trimmed = value.trim();
    if (!trimmed) return { provider: 'piper', voice: '' };
    const m = trimmed.match(/^(elevenlabs|piper):(.+)$/i);
    if (m) return { provider: m[1].toLowerCase(), voice: m[2].trim() };
    return { provider: 'piper', voice: trimmed };
  }, []);

  // When selecting an NPC, prefill its voice selection
  useEffect(() => {
    if (!selected) {
      setCardVoiceProvider('piper');
      setCardVoiceValue('');
      setCardVoiceStatus('');
      return;
    }
    const baseName = titleFromName(selected?.name || selected?.title || '');
    const record = npcList.find((n) => (n?.name || '').toLowerCase() === (baseName || '').toLowerCase());
    const decoded = decodeVoiceValue(record?.voice || activeMeta?.voice || '');
    setCardVoiceProvider(decoded.provider || 'piper');
    setCardVoiceValue(decoded.voice || '');
    setCardVoiceStatus('');
    // Heuristic: if value is unprefixed and matches a saved ElevenLabs profile name, switch provider
    (async () => {
      const val = (decoded.voice || '').trim();
      if (!val) return;
      const [piperOpts, elevenOpts] = await Promise.all([
        ensureVoiceOptions('piper'),
        ensureVoiceOptions('elevenlabs'),
      ]);
      const inPiper = piperOpts.some((o) => o.value === val);
      const inEleven = elevenOpts.some((o) => o.value === val);
      if (!inPiper && inEleven) {
        setCardVoiceProvider('elevenlabs');
      }
    })();
  }, [selected, npcList, activeMeta?.voice, decodeVoiceValue]);

  const ensureVoiceOptions = useCallback(async (provider) => {
    if (provider === 'piper') {
      if (voiceOptions.piper.length > 0) return voiceOptions.piper;
      setVoiceLoading((prev) => ({ ...prev, piper: true }));
      try {
        const list = await listPiperVoices();
        const options = Array.isArray(list)
          ? list.map((voice) => ({ value: voice.id, label: voice.label || voice.id }))
          : [];
        setVoiceOptions((prev) => ({ ...prev, piper: options }));
        return options;
      } finally {
        setVoiceLoading((prev) => ({ ...prev, piper: false }));
      }
    } else if (provider === 'elevenlabs') {
      if (voiceOptions.elevenlabs.length > 0) return voiceOptions.elevenlabs;
      setVoiceLoading((prev) => ({ ...prev, elevenlabs: true }));
      try {
        const list = await invoke('list_piper_profiles');
        const items = Array.isArray(list) ? list : [];
        const options = items
          .map((it) => ({ value: it?.name || '', label: it?.voice_id ? `${it.name} (${it.voice_id})` : (it?.name || '') }))
          .filter((o) => o.value);
        setVoiceOptions((prev) => ({ ...prev, elevenlabs: options }));
        return options;
      } finally {
        setVoiceLoading((prev) => ({ ...prev, elevenlabs: false }));
      }
    }
    return [];
  }, [voiceOptions.elevenlabs.length, voiceOptions.piper.length]);

  const persistCardVoice = useCallback(async (provider, value) => {
    if (!selected) return;
    const npcName = titleFromName(selected?.name || selected?.title || '');
    let voice = String(value || '').trim();
    setCardVoiceSaving(true);
    setCardVoiceStatus('');
    try {
      await saveNpc({ name: npcName, description: '', prompt: '', voice });
      setCardVoiceStatus(voice ? 'Saved' : 'Cleared');
      // reflect in local cache
      setNpcList((prev) => {
        const idx = prev.findIndex((n) => (n?.name || '').toLowerCase() === npcName.toLowerCase());
        const next = [...prev];
        if (idx >= 0) next[idx] = { ...next[idx], voice };
        else next.push({ name: npcName, description: '', prompt: '', voice });
        return next;
      });
      setTimeout(() => setCardVoiceStatus(''), 1500);
    } catch (err) {
      setCardVoiceStatus(err?.message || 'Failed to save');
    } finally {
      setCardVoiceSaving(false);
    }
  }, [selected]);

  return (
    <div>
      <BackButton />
      <h1>Dungeons & Dragons · NPCs</h1>
      <div className="pantheon-controls">
      <div className="inbox-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search NPCs or location..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ width: '280px' }}
        />
        <label>
          Sort
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="az">A - Z</option>
            <option value="za">Z - A</option>
            <option value="recent">Recents</option>
          </select>
        </label>
        <label>
          Type
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">(all types)</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
            <option value="">(all locations)</option>
            {locationOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading.' : 'Refresh'}
        </button>
        <button type="button" onClick={() => { if (!creating) { setShowCreate(true); setNewName(''); setCreateError(''); } }} disabled={creating}>
          Add NPC
        </button>
        {usingPath && <span className="muted">Folder: {usingPath}</span>}
        {error && <span className="error">{error}</span>}
      </div>

      <section className="pantheon-grid">
        {visibleItems.map((item) => (
          <button
            key={item.path}
            className="pantheon-card"
            onClick={() => {
              setActivePath(item.path);
              setModalOpen(true);
              setMetaDismissed(false);
              setMetaNotice('');
            }}
            title={item.path}
          >
            {portraitUrls[item.path] ? (
              <img src={portraitUrls[item.path]} alt={item.title || item.name} className="monster-portrait" />
            ) : (
              <div className="monster-portrait placeholder">?</div>
            )}
            <div className="pantheon-card-title">{item.title || item.name}</div>
            <div className="pantheon-card-meta">Location: {locations[item.path] || relLocation(usingPath, item.path) || '-'}</div>
          </button>
        ))}
        {!loading && visibleItems.length === 0 && (
          <div className="muted">No NPC files found.</div>
        )}
      </section>

      {modalOpen && (
        <div className="lightbox" onClick={() => { setModalOpen(false); }}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <header className="inbox-reader-header npc-header">
                  {portraitUrls[selected.path] ? (
                    <img
                      src={portraitUrls[selected.path]}
                      alt={selected.title || selected.name}
                      className="npc-portrait"
                    />
                  ) : (
                    <div className="npc-portrait placeholder">?</div>
                  )}
                  <div className="npc-header-main">
                    <h2 className="npc-name">{derivedTitle}</h2>
                    <div className="inbox-reader-meta" style={{ gap: "0.5rem" }}>
                      <span>{selected.name}</span>
                      {locationLabel && (
                        <>
                          <span>·</span>
                          <span>{locationLabel}</span>
                        </>
                      )}
                    <span style={{ marginLeft: "auto" }} /><button type="button" className="danger" onClick={async () => { if (!selected?.path) return; const ok = confirm(`Delete NPC file?\n\n${selected.path}`); if (!ok) return; try { await deleteInbox(selected.path); setModalOpen(false); setActivePath(""); await fetchItems(); } catch (err) { alert(err?.message || String(err)); } }}>Delete</button></div>
                    {metadataChips.length > 0 && (
                      <div className="npc-chips">
                        {metadataChips.map((chip) => (
                          <span key={chip.id} className="chip">{chip.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </header>
                <section className="npc-voice-config" style={{ marginTop: '0.5rem' }}>
                  <fieldset className="npc-voice-selector" style={{ display: 'grid', gap: '0.5rem' }}>
                    <legend>Voice</legend>
                    <label>
                      Provider
                      <select
                        value={cardVoiceProvider}
                        onChange={async (e) => {
                          const provider = e.target.value;
                          setCardVoiceProvider(provider);
                          // load options and reset voice if current not in new set
                          const options = await ensureVoiceOptions(provider);
                          setCardVoiceValue((prev) => (options.some((o) => o.value === prev) ? prev : ''));
                        }}
                        disabled={cardVoiceSaving}
                      >
                        <option value="piper">Piper (local)</option>
                        <option value="elevenlabs">ElevenLabs</option>
                      </select>
                    </label>
                    <label>
                      Voice
                      <select
                        value={cardVoiceValue}
                        onChange={async (e) => {
                          const value = e.target.value;
                          setCardVoiceValue(value);
                          await persistCardVoice(cardVoiceProvider, value);
                        }}
                        onFocus={() => ensureVoiceOptions(cardVoiceProvider)}
                        disabled={cardVoiceSaving || (cardVoiceProvider === 'piper' ? voiceLoading.piper : voiceLoading.elevenlabs)}
                      >
                        <option value="">(none)</option>
                        {(cardVoiceProvider === 'piper' ? voiceOptions.piper : voiceOptions.elevenlabs).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {cardVoiceStatus && (
                        <span className={/failed|error/i.test(cardVoiceStatus) ? 'error' : 'muted'} style={{ marginLeft: '0.5rem' }}>
                          {cardVoiceStatus}
                        </span>
                      )}
                    </label>
                  </fieldset>
                </section>
                {metaNotice && !metaDismissed && (
                  <div className="npc-banner">
                    <span>{metaNotice}</span>
                    <button type="button" onClick={() => setMetaDismissed(true)}>Dismiss</button>
                  </div>
                )}
                <article className="inbox-reader-body">
                  {/\.(md|mdx|markdown)$/i.test(selected.name || '') ? (
                    renderMarkdown(markdownSource || 'Loading.')
                  ) : (
                    <pre className="inbox-reader-content">{markdownSource || 'Loading.'}</pre>
                  )}
                </article>
              </>
            ) : (
              <div className="muted">Loading.</div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="lightbox" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="lightbox-panel monster-create-panel" onClick={(e) => e.stopPropagation()}>
            <h2>New NPC</h2>
            <form className="monster-create-form" onSubmit={async (e) => {
              e.preventDefault();
              if (creating) return;
              const name = newName.trim();
              if (!randName && !name) { setCreateError('Please enter a name or enable random.'); return; }
              const purpose = selPurpose === '__custom__' ? (customPurpose.trim()) : selPurpose;
              const estPath = selPurpose === 'Shopkeeper' ? establishmentRecord : '';
              const estDisplay = selPurpose === 'Shopkeeper' ? establishmentName.trim() : '';
              try {
                setCreating(true);
                setCreateError('');
                const createdPath = await createNpc(
                  randName ? '' : name,
                  selRegion || '',
                  purpose || '',
                  null,
                  false,
                  estPath || null,
                  estDisplay || null,
                );
                // Persist selected voice mapping for this NPC if provided
                try {
                  const fullPath = String(createdPath || '');
                  const base = fullPath.replace(/\\/g, '/');
                  const file = base.substring(base.lastIndexOf('/') + 1);
                  const npcName = titleFromName(file);
                  let vv = String(voiceValue || '').trim();
                  if (vv) {
                    // Save ElevenLabs by profile name (managed in profiles list)
                    await saveNpc({ name: npcName, description: '', prompt: '', voice: vv });
                  }
                } catch (_) {}
                setShowCreate(false);
                setNewName('');
                setRandName(false);
                setSelRegion('');
                setSelPurpose('');
                setCustomPurpose('');
                setEstablishmentName('');
                setEstablishmentRecord('');
                await fetchItems();
              } catch (err) {
                setCreateError(err?.message || String(err));
              } finally {
                setCreating(false);
              }
            }}>
              <label>
                Name
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(''); }}
                  autoFocus
                  disabled={creating || nameSuggesting}
                  placeholder={nameSuggesting ? 'Generating name…' : ''}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={randName}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setRandName(checked);
                    if (checked) {
                      try {
                        setNameSuggesting(true);
                        setCreateError('');
                        const region = (selRegion || '').trim();
                        const purpose = (selPurpose === '__custom__' ? customPurpose : selPurpose || '').trim();
                        const prompt = `Suggest a single evocative NPC name for a fantasy setting.\nRequirements:\n- Region/Location: ${region || 'generic'}\n- Role/Purpose: ${purpose || 'NPC'}\n- Return ONLY the name, title case, without quotes or extra text.\n- 1–3 words max.`;
                        const system = 'You only output a name. No punctuation except spaces and hyphens. No prefixes/suffixes.';
                        const result = await invoke('generate_llm', { prompt, system });
                        let suggested = String(result || '').split(/\r?\n/)[0].trim();
                        suggested = suggested.replace(/^[-–•\s]+/, '').replace(/^["'“”]+|["'“”]+$/g, '');
                        if (!suggested) throw new Error('Empty name');
                        setNewName(suggested);
                        setRandName(false);
                      } catch (err) {
                        setCreateError(err?.message || 'Failed to generate a name');
                      } finally {
                        setNameSuggesting(false);
                      }
                    }
                  }}
                  disabled={creating || nameSuggesting}
                />
                Let Ollama pick the name
              </label>
              <label>
                Region/Location
                <select value={selRegion} onChange={(e) => setSelRegion(e.target.value)} disabled={creating}>
                  {regionOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt || '(root)'}</option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <select value={selPurpose} onChange={(e) => setSelPurpose(e.target.value)} disabled={creating}>
                  <option value="">(optional)</option>
                  {['Shopkeeper','Innkeeper','Guard','Noble','Priest','Blacksmith','Wizard','Thief','Soldier','Farmer','Mayor','Merchant','Guide','Bard','Captain','Healer','Alchemist','Sage','Craftsman','Hunter']
                    .map((p) => (<option key={p} value={p}>{p}</option>))}
                  <option value="__custom__">Custom…</option>
                </select>
              </label>
              <fieldset className="npc-voice-selector" style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                <legend>Voice (optional)</legend>
                <label>
                  Provider
                  <select
                    value={voiceProvider}
                    onChange={async (e) => {
                      const provider = e.target.value;
                      setVoiceProvider(provider);
                      setVoiceValue('');
                      if (provider === 'piper' && voiceOptions.piper.length === 0) {
                        setVoiceLoading((prev) => ({ ...prev, piper: true }));
                        try {
                          const list = await listPiperVoices();
                          const options = (list || []).map((v) => ({ value: v.id, label: v.label || v.id }));
                          setVoiceOptions((prev) => ({ ...prev, piper: options }));
                        } catch {}
                        setVoiceLoading((prev) => ({ ...prev, piper: false }));
                      } else if (provider === 'elevenlabs' && voiceOptions.elevenlabs.length === 0) {
                        setVoiceLoading((prev) => ({ ...prev, elevenlabs: true }));
                        try {
                          const list = await invoke('list_piper_profiles');
                          const items = Array.isArray(list) ? list : [];
                          const options = items.map((it) => ({ value: it?.name || '', label: it?.voice_id ? `${it.name} (${it.voice_id})` : (it?.name || '') })).filter((o) => o.value);
                          setVoiceOptions((prev) => ({ ...prev, elevenlabs: options }));
                        } catch {}
                        setVoiceLoading((prev) => ({ ...prev, elevenlabs: false }));
                      }
                    }}
                    disabled={creating}
                  >
                    <option value="piper">Piper (local)</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </select>
                </label>
                <label>
                  Voice
                  <select
                    value={voiceValue}
                    onChange={(e) => setVoiceValue(e.target.value)}
                    disabled={creating || (voiceProvider === 'piper' ? voiceLoading.piper : voiceLoading.elevenlabs)}
                  >
                    <option value="">(none)</option>
                    {(voiceProvider === 'piper' ? voiceOptions.piper : voiceOptions.elevenlabs).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              </fieldset>
              {selPurpose === 'Shopkeeper' && (
                <div className="monster-create-shopkeeper">
                  <div className="monster-create-shopkeeper-title">Establishment Link</div>
                  <p className="muted">
                    Connect this shopkeeper to the storefront they manage. Select an existing establishment to
                    embed its reference in the new NPC note.
                  </p>
                  {establishmentsRoot && (
                    <p className="muted">Scanning: {establishmentsRoot}</p>
                  )}
                  <label>
                    Establishment Name
                    <input
                      type="text"
                      value={establishmentName}
                      onChange={(e) => setEstablishmentName(e.target.value)}
                      disabled={creating}
                      placeholder="e.g. The Gilded Griffin General Store"
                    />
                  </label>
                  <label>
                    Existing Shop Record
                    <select
                      value={establishmentRecord}
                      onChange={(e) => {
                        const { value } = e.target;
                        setEstablishmentRecord(value);
                        if (!value) {
                          setEstablishmentName('');
                          return;
                        }
                        const match = establishments.find((entry) => entry.path === value);
                        if (match) {
                          const autoName = match.title || match.name || '';
                          setEstablishmentName(autoName);
                        }
                      }}
                      disabled={creating || establishmentsLoading}
                    >
                      <option value="">Select an establishment</option>
                      {establishmentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedEstablishment && (
                    <div className="muted">
                      Linking to: {selectedEstablishment.label}
                    </div>
                  )}
                  {establishmentsError && <div className="error">{establishmentsError}</div>}
                  {!establishmentsLoading && !establishmentsError && establishmentsLoaded && establishmentOptions.length === 0 && (
                    <div className="muted">No establishments found. Create a storefront note first.</div>
                  )}
                </div>
              )}
              {selPurpose === '__custom__' && (
                <label>
                  Custom purpose
                  <input type="text" value={customPurpose} onChange={(e) => setCustomPurpose(e.target.value)} disabled={creating} />
                </label>
              )}
              {createError && <div className="error">{createError}</div>}
              <div className="monster-create-actions">
                <button type="button" onClick={() => { if (!creating) setShowCreate(false); }} disabled={creating}>Cancel</button>
                <button type="submit" disabled={creating}>{creating ? 'Creating.' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}












