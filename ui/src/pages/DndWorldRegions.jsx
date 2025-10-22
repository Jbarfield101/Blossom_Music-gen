import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import Icon from '../components/Icon.jsx';
import { getDreadhavenRoot } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';
import { useVaultVersion } from '../lib/vaultEvents.jsx';
import matter from 'gray-matter';
import { ENTITY_ID_PATTERN } from '../lib/dndIds.js';
import { saveEntity } from '../lib/vaultAdapter.js';
import DomainSmithModal from '../components/DomainSmithModal.jsx';
import CountySmithModal from '../components/CountySmithModal.jsx';
import {
  DEFAULT_DOMAIN_CATEGORY,
  DOMAIN_CATEGORY_SUGGESTIONS,
} from '../constants/domainOptions.js';
import { DOMAIN_TEMPLATE } from '../templates/domainTemplate.js';
import { COUNTY_TEMPLATE } from '../templates/countyTemplate.js';
import { createDomain, createCounty } from '../api/entities.js';
import { listEntitiesByType } from '../lib/vaultIndex.js';

const DEFAULT_REGIONS = 'D:\\Documents\\DreadHaven\\10_World\\Regions';

function joinPath(base, seg) {
  if (!base) return seg;
  if (/\\$/.test(base)) return `${base}${seg}`;
  return `${base}\\${seg}`;
}

function deriveVaultRootFromRegionsPath(path) {
  if (!path) return '';
  const normalized = String(path)
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (!normalized) return '';
  const suffix = '/10_World/Regions';
  const lower = normalized.toLowerCase();
  if (lower.endsWith(suffix.toLowerCase())) {
    const candidate = normalized.slice(0, normalized.length - suffix.length);
    return candidate;
  }
  return '';
}

function toRelativeVaultPath(rootPath, absolutePath) {
  const root = typeof rootPath === 'string' ? rootPath.trim() : '';
  const absolute = typeof absolutePath === 'string' ? absolutePath.trim() : '';
  if (!root || !absolute) return '';
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedAbsolute = absolute.replace(/\\/g, '/');
  const rootLower = normalizedRoot.toLowerCase();
  const absoluteLower = normalizedAbsolute.toLowerCase();
  if (!absoluteLower.startsWith(rootLower)) {
    return '';
  }
  return normalizedAbsolute.slice(normalizedRoot.length).replace(/^\/+/, '');
}

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

const ENTITY_ROUTE_BUILDERS = {
  npc: (id) => `/dnd/npc/${encodeURIComponent(id)}`,
  quest: (id) => `/dnd/quest/${encodeURIComponent(id)}`,
  loc: (id) => `/dnd/location/${encodeURIComponent(id)}`,
  faction: (id) => `/dnd/faction/${encodeURIComponent(id)}`,
  encounter: (id) => `/dnd/encounter/${encodeURIComponent(id)}`,
  session: (id) => `/dnd/session/${encodeURIComponent(id)}`,
  monster: (id) => `/dnd/monster/${encodeURIComponent(id)}`,
};

const REGION_TYPE_ICONS = {
  continent: { icon: 'Globe2', label: 'Continent' },
  empire: { icon: 'Shield', label: 'Empire' },
  kingdom: { icon: 'Crown', label: 'Kingdom' },
  nation: { icon: 'Landmark', label: 'Nation' },
  republic: { icon: 'ScrollText', label: 'Republic' },
  province: { icon: 'MapPinned', label: 'Province' },
  duchy: { icon: 'Gem', label: 'Duchy' },
  region: { icon: 'Map', label: 'Region' },
  territory: { icon: 'MapPinned', label: 'Territory' },
  city: { icon: 'Building2', label: 'City' },
  town: { icon: 'Home', label: 'Town' },
  village: { icon: 'TreePine', label: 'Village' },
  district: { icon: 'MapPin', label: 'District' },
  settlement: { icon: 'Tent', label: 'Settlement' },
  outpost: { icon: 'Castle', label: 'Outpost' },
  enclave: { icon: 'DoorOpen', label: 'Enclave' },
  stronghold: { icon: 'ShieldHalf', label: 'Stronghold' },
};

function getEntityRoute(entityId) {
  const match = String(entityId || '').match(/^([a-z]+)/i);
  if (!match) return '';
  const type = match[1].toLowerCase();
  const builder = ENTITY_ROUTE_BUILDERS[type];
  return builder ? builder(entityId) : '';
}

function getRegionTypeInfo(type) {
  if (!type) return null;
  const normalized = String(type).toLowerCase();
  return REGION_TYPE_ICONS[normalized] || null;
}

function buildLookup(data = {}) {
  const lookup = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!key) continue;
    lookup[key] = value;
    const lower = key.toLowerCase();
    if (!(lower in lookup)) lookup[lower] = value;
    const normalized = lower.replace(/[^a-z0-9]+/g, '_');
    if (!(normalized in lookup)) lookup[normalized] = value;
  }
  return lookup;
}

function firstNonEmpty(lookup, keys = []) {
  for (const key of keys) {
    if (!key) continue;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (lookup[key] != null && String(lookup[key]).trim()) {
      return lookup[key];
    }
    if (lookup[normalized] != null && String(lookup[normalized]).trim()) {
      return lookup[normalized];
    }
  }
  return '';
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        if (item && typeof item === 'object') {
          const label = item.label || item.name || item.title || item.text;
          if (label != null) return String(label).trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeList(parsed);
      }
    } catch {
      // not JSON, fall through
    }
    return trimmed
      .replace(/^\[|]$/g, '')
      .split(/[;,|]/)
      .map((part) => part.replace(/^[-*\s]+/, '').replace(/^['"]|['"]$/g, '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return [];
}

function deriveSummaryFromContent(content) {
  const text = String(content || '');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\s*#/.test(trimmed)) continue;
    if (/^>\s*/.test(trimmed)) continue;
    return trimmed.length > 220 ? `${trimmed.slice(0, 217).trimEnd()}…` : trimmed;
  }
  return '';
}

function normalizeHierarchy(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          const [labelPart, extra] = entry.split('|').map((part) => part.trim());
          const label = labelPart || extra || '';
          if (!label) return null;
          const entityId = extra && ENTITY_ID_PATTERN.test(extra) ? extra : '';
          const path = extra && !entityId ? extra : '';
          return { label, entityId, path };
        }
        if (typeof entry === 'object') {
          const label = String(entry.label || entry.name || entry.title || entry.text || '').trim();
          const entityId = String(entry.entityId || entry.entity_id || entry.id || '').trim();
          const path = String(entry.path || entry.note || entry.file || entry.filepath || '').trim();
          if (!label && !entityId && !path) return null;
          return { label: label || entityId || path, entityId, path };
        }
        return null;
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeHierarchy(parsed);
      }
    } catch {
      // ignore JSON parse errors
    }
    const delimiter = trimmed.includes('>') ? '>' : trimmed.includes('»') ? '»' : trimmed.includes('/') ? '/' : ',';
    return trimmed
      .split(delimiter)
      .map((segment) => {
        const part = segment.trim();
        if (!part) return null;
        const [labelPart, extra] = part.split('|').map((v) => v.trim());
        const label = labelPart || extra || '';
        const entityId = extra && ENTITY_ID_PATTERN.test(extra) ? extra : '';
        const path = extra && !entityId ? extra : '';
        return { label, entityId, path };
      })
      .filter(Boolean);
  }
  return [];
}

function truncate(text, limit = 140) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function formatEntityIdLabel(entityId) {
  const raw = String(entityId || '');
  const withoutPrefix = raw.replace(/^[a-z]+_/, '').replace(/_[a-z0-9]{4,6}$/i, '');
  if (!withoutPrefix) return raw;
  return withoutPrefix
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractRegionMetadata(text, fallback = {}) {
  let fm = {};
  let body = text || '';
  try {
    const parsed = matter(text || '');
    fm = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};
    body = parsed?.content ?? body;
  } catch {
    fm = {};
  }
  const lookup = buildLookup(fm);
  const typeValue = firstNonEmpty(lookup, ['type', 'region_type', 'classification', 'category', 'tier']);
  const parentName = firstNonEmpty(lookup, ['parent', 'parent_region', 'parent_location', 'region_parent', 'parent_name']);
  const parentId = firstNonEmpty(lookup, ['parent_id', 'parentId', 'parent_entity_id', 'parent_entity']);
  const parentPath = firstNonEmpty(lookup, ['parent_path', 'parentPath', 'parent_note', 'parent_file', 'parent_note_path']);
  const summary = firstNonEmpty(lookup, ['summary', 'description', 'overview', 'synopsis', 'blurb']) || deriveSummaryFromContent(body);
  const tags = normalizeList(
    lookup.tags ||
    lookup.key_tags ||
    lookup.keywords ||
    lookup.traits ||
    lookup.themes ||
    lookup.topics ||
    lookup.focus ||
    [],
  );
  const population = firstNonEmpty(lookup, ['population', 'population_estimate', 'inhabitants', 'population_total']);
  const capital = firstNonEmpty(lookup, ['capital', 'capital_city', 'seat', 'seat_of_power']);
  const leaders = normalizeList(
    lookup.leaders ||
    lookup.rulers ||
    lookup.leadership ||
    lookup.government ||
    lookup.council ||
    lookup.stewards ||
    lookup.leader ||
    [],
  );
  const allegiance = firstNonEmpty(
    lookup,
    ['allegiance', 'loyalty', 'alignment', 'affiliation', 'allegiance_to', 'political_alignment'],
  );
  const terrain = firstNonEmpty(lookup, ['terrain', 'biome', 'environment']);
  const wealth = firstNonEmpty(lookup, ['wealth', 'economy', 'economic_status']);
  const entityId = firstNonEmpty(lookup, ['id', 'entity_id', 'entityId', 'region_id']);
  const linkedEntityIds = Array.from(
    new Set(
      normalizeList(
        lookup.linked_entities ||
          lookup.linked_entity_ids ||
          lookup.linkedIds ||
          lookup.entity_links ||
          lookup.links ||
          lookup.entities ||
          lookup.references ||
          lookup.relations ||
          lookup.associations ||
          [],
      )
        .map((value) => value.replace(/\s+/g, ''))
        .filter((value) => ENTITY_ID_PATTERN.test(value)),
    ),
  );
  const hierarchy = normalizeHierarchy(
    lookup.ancestry || lookup.hierarchy || lookup.parent_chain || lookup.lineage || lookup.breadcrumbs,
  );
  const childEntries = normalizeList(
    lookup.children ||
      lookup.subregions ||
      lookup.districts ||
      lookup.settlements ||
      lookup.locales ||
      lookup.outposts ||
      lookup.child_notes ||
      lookup.child_paths ||
      [],
  );
  const displayName =
    firstNonEmpty(lookup, ['name', 'title', 'display_name', 'region_name']) ||
    fallback.displayName ||
    fallback.name ||
    '';

  return {
    type: typeValue ? String(typeValue).toLowerCase() : '',
    rawType: typeValue || '',
    parentName: parentName || '',
    parentId: parentId || '',
    parentPath: parentPath || '',
    summary: String(summary || '').trim(),
    tags,
    population: population ? String(population).trim() : '',
    capital: capital ? String(capital).trim() : '',
    leaders,
    allegiance: allegiance ? String(allegiance).trim() : '',
    terrain: terrain ? String(terrain).trim() : '',
    wealth: wealth ? String(wealth).trim() : '',
    entityId: entityId ? String(entityId).trim() : '',
    linkedEntityIds,
    hierarchy,
    childEntries,
    displayName: displayName || fallback.displayName || fallback.name || '',
    raw: fm,
  };
}

function extractNameFromPath(path) {
  if (!path) return '';
  const parts = String(path).split(/[/\\]/);
  const last = parts[parts.length - 1] || '';
  return last.replace(/\.[^.]+$/, '');
}

function slugify(value, fallback = 'domain') {
  const base = value ?? fallback ?? '';
  return String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/--+/g, '-')
    || String(fallback ?? 'domain');
}

function randomHash(length = 6) {
  let hash = '';
  while (hash.length < length) {
    hash += Math.random().toString(36).slice(2);
  }
  return hash.slice(0, length);
}

const DEFAULT_DOMAIN_FORM = {
  name: '',
  category: DEFAULT_DOMAIN_CATEGORY,
  capital: '',
  populationMin: 0,
  populationMax: 0,
  rulerId: null,
  regionPath: '',
};

const DEFAULT_COUNTY_FORM = {
  name: '',
  category: '',
  seatOfPower: '',
  capital: '',
  governanceType: '',
  rulingHouse: '',
  population: '',
  allegiance: '',
  targetDir: '',
  notes: '',
  domainId: '',
  domainName: '',
  primarySpecies: '',
};

const POPULATION_MIN_LIMIT = 0;
const POPULATION_MAX_LIMIT = 1000000;

function clampPopulationValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < POPULATION_MIN_LIMIT) return POPULATION_MIN_LIMIT;
  if (num > POPULATION_MAX_LIMIT) return POPULATION_MAX_LIMIT;
  return Math.round(num);
}

function normalizePopulationRange(minValue, maxValue) {
  const min = clampPopulationValue(minValue);
  const max = clampPopulationValue(maxValue);
  if (min != null && max != null && min > max) {
    return [max, min];
  }
  return [min, max];
}

export default function DndWorldRegions() {
  const [basePath, setBasePath] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [metadataMap, setMetadataMap] = useState({});
  const [showDomainSmith, setShowDomainSmith] = useState(false);
  const [domainForm, setDomainForm] = useState(() => ({ ...DEFAULT_DOMAIN_FORM }));
  const [domainStatus, setDomainStatus] = useState({ stage: 'idle', error: '', message: '' });
  const [showCountySmith, setShowCountySmith] = useState(false);
  const [countyForm, setCountyForm] = useState(() => ({ ...DEFAULT_COUNTY_FORM }));
  const [countyStatus, setCountyStatus] = useState({ stage: 'idle', error: '', message: '' });
  const [activeCountyDomain, setActiveCountyDomain] = useState(null);
  const [recentDomain, setRecentDomain] = useState(null);
  const metadataRef = useRef({});
  const regionsVersion = useVaultVersion(['10_world/regions']);
  const [npcOptions, setNpcOptions] = useState([]);

  const npcLabelById = useMemo(() => {
    const lookup = {};
    npcOptions.forEach((option) => {
      if (!option || !option.value) return;
      const key = String(option.value).trim();
      if (!key) return;
      const label = option.label || formatEntityIdLabel(key);
      lookup[key] = label;
      lookup[key.toLowerCase()] = label;
    });
    return lookup;
  }, [npcOptions]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { entries = [] } = await listEntitiesByType('npc', { force: false }).catch(() => ({ entries: [] }));
        if (cancelled) return;
        const normalized = entries
          .map((entry) => {
            const value = entry?.id || entry?.index?.id || '';
            if (!value) return null;
            const label = entry?.name || entry?.title || formatEntityIdLabel(value);
            return label ? { value, label } : { value, label: formatEntityIdLabel(value) };
          })
          .filter(Boolean);
        const deduped = new Map();
        normalized.forEach((option) => {
          const key = String(option.value).toLowerCase();
          if (!key) return;
          if (!deduped.has(key) || !deduped.get(key).label) {
            deduped.set(key, option);
          }
        });
        const sorted = Array.from(deduped.values()).sort((a, b) => {
          const labelA = (a.label || a.value || '').toLowerCase();
          const labelB = (b.label || b.value || '').toLowerCase();
          if (labelA < labelB) return -1;
          if (labelA > labelB) return 1;
          return 0;
        });
        setNpcOptions(sorted);
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load NPC metadata', err);
          setNpcOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [regionsVersion]);

  const initBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getDreadhavenRoot();
      const base = (typeof vault === 'string' && vault.trim())
        ? `${vault.trim()}\\10_World\\Regions`
        : DEFAULT_REGIONS;
      setBasePath(base);
      setCurrentPath(base);
    } catch (e) {
      setBasePath(DEFAULT_REGIONS);
      setCurrentPath(DEFAULT_REGIONS);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchList = useCallback(async (path) => {
    if (!path) return;
    setLoading(true);
    setError('');
    try {
      const list = await listDir(path);
      setItems(Array.isArray(list) ? list : []);
      // If changing folder, clear active selection
      setActivePath('');
      setActiveContent('');
    } catch (e) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { initBase(); }, [initBase]);
  useEffect(() => { if (currentPath) fetchList(currentPath); }, [currentPath, fetchList, regionsVersion]);

  useEffect(() => {
    if (!activePath) {
      setActiveContent('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const text = await readInbox(activePath);
        if (cancelled) return;
        setActiveContent(text || '');
        if (/\.(md|mdx|markdown)$/i.test(activePath)) {
          const meta = extractRegionMetadata(text || '', {
            displayName: extractNameFromPath(activePath),
            name: extractNameFromPath(activePath),
            path: activePath,
          });
          metadataRef.current[activePath] = meta;
          setMetadataMap((prev) => ({ ...prev, [activePath]: meta }));
        }
      } catch (e) {
        if (!cancelled) {
          setActiveContent('Failed to load file.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of items) {
        if (cancelled) return;
        if (item.is_dir) continue;
        if (!/\.(md|mdx|markdown)$/i.test(item.name)) continue;
        if (metadataRef.current[item.path]) continue;
        try {
          const text = await readInbox(item.path);
          if (cancelled) return;
          const meta = extractRegionMetadata(text || '', {
            displayName: item.name.replace(/\.[^.]+$/, ''),
            name: item.name.replace(/\.[^.]+$/, ''),
            path: item.path,
          });
          metadataRef.current[item.path] = meta;
          setMetadataMap((prev) => ({ ...prev, [item.path]: meta }));
        } catch {
          const fallbackMeta = {
            displayName: item.name.replace(/\.[^.]+$/, ''),
            type: '',
            rawType: '',
            parentName: '',
            parentId: '',
            parentPath: '',
            summary: '',
            tags: [],
            population: '',
            capital: '',
            leaders: [],
            allegiance: '',
            terrain: '',
            wealth: '',
            entityId: '',
            linkedEntityIds: [],
            hierarchy: [],
            childEntries: [],
          };
          metadataRef.current[item.path] = fallbackMeta;
          setMetadataMap((prev) => ({ ...prev, [item.path]: prev[item.path] || fallbackMeta }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const crumbs = useMemo(() => {
    if (!basePath || !currentPath) return [];
    const base = basePath.replace(/\\+$/,'');
    const rel = currentPath.startsWith(base) ? currentPath.slice(base.length).replace(/^\\+/, '') : '';
    const segs = rel ? rel.split('\\') : [];
    const acc = [base];
    const out = [{ label: 'Regions', path: base }];
    for (const s of segs) {
      const next = joinPath(acc[acc.length - 1], s);
      out.push({ label: s, path: next });
      acc.push(next);
    }
    return out;
  }, [basePath, currentPath]);

  const regionOptions = useMemo(() => {
    const seen = new Set();
    const options = [];
    for (const crumb of crumbs) {
      if (!crumb || !crumb.path) continue;
      if (seen.has(crumb.path)) continue;
      seen.add(crumb.path);
      options.push({ value: crumb.path, label: crumb.label || crumb.path });
    }
    for (const entry of items) {
      if (!entry || !entry.is_dir || !entry.path) continue;
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      options.push({ value: entry.path, label: entry.name.replace(/\.[^.]+$/, '') || entry.path });
    }
    return options;
  }, [crumbs, items]);

  const regionOptionLookup = useMemo(() => {
    const lookup = new Map();
    for (const option of regionOptions) {
      if (!option || !option.value) continue;
      lookup.set(option.value, option.label || option.value);
    }
    return lookup;
  }, [regionOptions]);

  const countyRegionOptions = useMemo(() => {
    const basePairs = regionOptions
      .map((option) => (option && option.value ? [option.value, option] : null))
      .filter(Boolean);
    const map = new Map(basePairs);
    const domainDir = activeCountyDomain?.directory;
    if (domainDir) {
      const defaultLabel = activeCountyDomain?.name
        ? `${activeCountyDomain.name} folder`
        : domainDir;
      if (!map.has(domainDir)) {
        map.set(domainDir, { value: domainDir, label: defaultLabel });
      }
      const countiesDir = joinPath(domainDir, 'Counties');
      if (countiesDir && !map.has(countiesDir)) {
        const countiesLabel = activeCountyDomain?.name
          ? `${activeCountyDomain.name} \\ Counties`
          : `${countiesDir}`;
        map.set(countiesDir, { value: countiesDir, label: countiesLabel });
      }
    }
    const countyDir = activeCountyDomain?.countyDirectory;
    if (countyDir && !map.has(countyDir)) {
      map.set(countyDir, {
        value: countyDir,
        label: activeCountyDomain?.name
          ? `${activeCountyDomain.name} counties`
          : countyDir,
      });
    }
    return Array.from(map.values());
  }, [regionOptions, activeCountyDomain?.directory, activeCountyDomain?.name, activeCountyDomain?.countyDirectory]);

  const handleOpenDomainSmith = useCallback(() => {
    if (domainStatus.stage === 'generating' || domainStatus.stage === 'saving') return;
    const defaultRegion = (currentPath && currentPath.trim())
      ? currentPath
      : (basePath && basePath.trim())
        ? basePath
        : (regionOptions[0]?.value || '');
    setDomainForm({
      ...DEFAULT_DOMAIN_FORM,
      category: DEFAULT_DOMAIN_FORM.category,
      capital: DEFAULT_DOMAIN_FORM.capital,
      populationMin: DEFAULT_DOMAIN_FORM.populationMin,
      populationMax: DEFAULT_DOMAIN_FORM.populationMax,
      rulerId: DEFAULT_DOMAIN_FORM.rulerId,
      regionPath: defaultRegion,
    });
    setDomainStatus({ stage: 'idle', error: '', message: '' });
    setShowDomainSmith(true);
  }, [basePath, currentPath, domainStatus.stage, regionOptions]);

  const handleDomainClose = useCallback(() => {
    setShowDomainSmith(false);
    const fallbackRegion = (currentPath && currentPath.trim()) || (basePath && basePath.trim()) || '';
    setDomainForm((prev) => ({
      ...DEFAULT_DOMAIN_FORM,
      category: DEFAULT_DOMAIN_FORM.category,
      capital: DEFAULT_DOMAIN_FORM.capital,
      populationMin: DEFAULT_DOMAIN_FORM.populationMin,
      populationMax: DEFAULT_DOMAIN_FORM.populationMax,
      rulerId: DEFAULT_DOMAIN_FORM.rulerId,
      regionPath: prev.regionPath || fallbackRegion,
    }));
    setDomainStatus({ stage: 'idle', error: '', message: '' });
  }, [basePath, currentPath]);

  const handleDomainFormChange = useCallback((patch) => {
    setDomainForm((prev) => {
      const next = { ...prev, ...patch };
      if ('populationMin' in patch || 'populationMax' in patch) {
        const [normalizedMin, normalizedMax] = normalizePopulationRange(
          patch.populationMin ?? prev.populationMin,
          patch.populationMax ?? prev.populationMax,
        );
        next.populationMin = normalizedMin != null ? normalizedMin : DEFAULT_DOMAIN_FORM.populationMin;
        next.populationMax = normalizedMax != null ? normalizedMax : DEFAULT_DOMAIN_FORM.populationMax;
      }
      return next;
    });
    setDomainStatus((prev) => {
      if (prev.stage === 'idle' && !prev.error && !prev.message) return prev;
      return { stage: 'idle', error: '', message: '' };
    });
  }, []);

  const handleDomainSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmedName = String(domainForm.name || '').trim();
      const selectedRegion = String(domainForm.regionPath || '').trim();
      if (!trimmedName) {
        setDomainStatus({ stage: 'error', error: 'Please provide a domain name.', message: '' });
        return;
      }
      const targetFolder = selectedRegion || currentPath || basePath;
      if (!targetFolder) {
        setDomainStatus({ stage: 'error', error: 'Pick a folder to store the new domain.', message: '' });
        return;
      }

      const slug = slugify(trimmedName);
      const hash = randomHash(6);
      const domainId = `domain_${slug}_${hash}`;
      const crumbTrail = crumbs.map((crumb) => crumb.label).filter(Boolean).join(' > ') || 'Regions';
      const folderNames = items
        .filter((item) => item?.is_dir)
        .map((item) => item.name.replace(/\.[^.]+$/, ''))
        .filter(Boolean);
      const optionLookup = new Map(regionOptions.map((opt) => [opt.value, opt.label]));
      const regionDescriptor = optionLookup.get(targetFolder) || targetFolder;
      const trimmedCategory = String(domainForm.category || '').trim();
      const trimmedCapital = String(domainForm.capital || '').trim();
      const trimmedRulerId = domainForm.rulerId ? String(domainForm.rulerId).trim() : '';
      const categoryPrompt = trimmedCategory
        ? `Category input: ${trimmedCategory}. Use this value for the front matter category field.`
        : DOMAIN_CATEGORY_SUGGESTIONS.length
          ? `Category inspiration: consider domains such as ${DOMAIN_CATEGORY_SUGGESTIONS.join(', ')}.`
          : '';
      let [populationMin, populationMax] = normalizePopulationRange(
        domainForm.populationMin,
        domainForm.populationMax,
      );
      const formatPopulation = (value) => {
        if (value == null) return '';
        return value.toLocaleString();
      };
      let populationSentence = '';
      if ((populationMin ?? 0) > 0 || (populationMax ?? 0) > 0) {
        if (populationMin != null && populationMax != null && populationMin !== populationMax) {
          populationSentence = `Population input: between ${formatPopulation(populationMin)} and ${formatPopulation(populationMax)} residents. Use this to populate the front matter population field.`;
        } else if (populationMin != null && populationMax != null) {
          populationSentence = `Population input: approximately ${formatPopulation(populationMin)} residents. Use this to populate the front matter population field.`;
        } else if (populationMin != null) {
          populationSentence = `Population input: at least ${formatPopulation(populationMin)} residents. Use this to populate the front matter population field.`;
        } else if (populationMax != null) {
          populationSentence = `Population input: at most ${formatPopulation(populationMax)} residents. Use this to populate the front matter population field.`;
        }
      }
      const resolvedRulerLabel = trimmedRulerId
        ? npcLabelById[trimmedRulerId] || npcLabelById[trimmedRulerId.toLowerCase()] || ''
        : '';
      const rulerSentence = trimmedRulerId
        ? `Ruler input: ${resolvedRulerLabel ? `${resolvedRulerLabel} (${trimmedRulerId})` : trimmedRulerId}. Set this NPC as the front matter ruler_id.`
        : '';
      const promptSections = [
        `Fill out the Dungeons & Dragons domain template for a new domain named "${trimmedName}".`,
        categoryPrompt,
        trimmedCapital
          ? `Capital input: ${trimmedCapital}. Use this value for the front matter capital field.`
          : '',
        populationSentence,
        rulerSentence,
        `Destination folder: ${regionDescriptor} (${targetFolder}). Breadcrumb trail: ${crumbTrail}.`,
        folderNames.length ? `Nearby folders here: ${folderNames.join(', ')}.` : '',
        `Template to follow:\n${DOMAIN_TEMPLATE}`,
        [
          'Formatting requirements:',
          `- Set the YAML id to "${domainId}".`,
          '- Keep the type as "domain".',
          '- Populate every field with concise, evocative lore suitable for tabletop play.',
          '- Populate the category, capital, population, and ruler_id front matter fields using the provided inputs.',
          '- Preserve all keys and comments from the template.',
          '- Use YAML arrays for list values and provide at least two gm_secrets.',
          '- Respond with Markdown only.',
        ].join('\n'),
      ].filter(Boolean);

      const prompt = promptSections.join('\n\n');
      const systemMessage =
        'You are Blossom, an expert tabletop worldbuilding assistant. Return polished Markdown that strictly matches the provided template order, producing immersive yet practical details for a busy Dungeon Master.';

      setDomainStatus({ stage: 'generating', error: '', message: '' });

      try {
        const llmResponse = await invoke('generate_llm', { prompt, system: systemMessage });
        const generated = typeof llmResponse === 'string' ? llmResponse.trim() : '';
        if (!generated) {
          throw new Error('The language model returned an empty response.');
        }

        setDomainStatus({ stage: 'saving', error: '', message: '' });

        const parsed = matter(generated);
        const entityData = parsed?.data && typeof parsed.data === 'object' ? { ...parsed.data } : null;
        if (!entityData) {
          throw new Error('Generated markdown is missing YAML front matter.');
        }
        if (!entityData.id) entityData.id = domainId;
        if (!entityData.type) entityData.type = 'domain';
        if (!entityData.name) entityData.name = trimmedName;

        const body = parsed?.content ?? '';
        const filenameSlug = slugify(entityData.name || trimmedName, slug);

        let vaultRoot = '';
        try {
          const resolvedRoot = await getDreadhavenRoot();
          if (typeof resolvedRoot === 'string' && resolvedRoot.trim()) {
            vaultRoot = resolvedRoot.trim();
          }
        } catch (rootErr) {
          console.warn('Domain Smith: failed to resolve vault root from config', rootErr);
        }
        if (!vaultRoot) {
          vaultRoot = deriveVaultRootFromRegionsPath(basePath) || 'D:/Documents/DreadHaven';
        }

        const relativeTargetDir = toRelativeVaultPath(vaultRoot, targetFolder);

        let creation = null;
        if (relativeTargetDir) {
          try {
            creation = await createDomain(trimmedName, { targetDir: relativeTargetDir });
          } catch (creationErr) {
            console.warn('Domain Smith: falling back to manual save', creationErr);
          }
        }

        const targetPath = creation?.path || joinPath(targetFolder, `${filenameSlug}.md`);
        const targetDirectory = creation?.path
          ? creation.path.replace(/[\\/][^\\/]+$/, '')
          : targetFolder;

        const finalEntity = { ...entityData };
        if (!finalEntity.id) finalEntity.id = domainId;
        if (creation?.id) finalEntity.id = creation.id;
        if (!finalEntity.type) finalEntity.type = 'domain';
        if (creation?.type) finalEntity.type = creation.type;
        if (!finalEntity.name) finalEntity.name = trimmedName;

        await saveEntity({ entity: finalEntity, body, path: targetPath, format: 'markdown' });

        await fetchList(targetDirectory);
        setCurrentPath(targetDirectory);
        setActivePath(targetPath);
        setDomainForm({
          ...DEFAULT_DOMAIN_FORM,
          category: DEFAULT_DOMAIN_FORM.category,
          capital: DEFAULT_DOMAIN_FORM.capital,
          populationMin: DEFAULT_DOMAIN_FORM.populationMin,
          populationMax: DEFAULT_DOMAIN_FORM.populationMax,
          rulerId: DEFAULT_DOMAIN_FORM.rulerId,
          regionPath: targetDirectory,
        });
        const finalRulerId = finalEntity.ruler_id || trimmedRulerId;
        const successLabel = finalRulerId
          ? npcLabelById[finalRulerId] || npcLabelById[String(finalRulerId).toLowerCase()] || ''
          : '';
        const successParts = [`Saved ${finalEntity.name || trimmedName} to ${targetDirectory}.`];
        if (finalRulerId) {
          successParts.push(
            successLabel
              ? `Ruler: ${successLabel} (${finalRulerId}).`
              : `Ruler ID: ${finalRulerId}.`,
          );
        }
        const defaultCountyDir = targetDirectory ? joinPath(targetDirectory, 'Counties') : targetDirectory;
        const domainContext = {
          id: finalEntity.id,
          name: finalEntity.name || trimmedName,
          path: targetPath,
          directory: targetDirectory,
          relPath: creation?.relPath || '',
          regionLabel: regionDescriptor,
          crumbTrail,
          category: finalEntity.category || trimmedCategory,
          capital: finalEntity.capital || trimmedCapital,
          population: finalEntity.population,
          rulerId: finalRulerId,
          markdown: generated,
          countyDirectory: defaultCountyDir || targetDirectory,
        };
        setRecentDomain(domainContext);
        setActiveCountyDomain(domainContext);
        setCountyForm({
          ...DEFAULT_COUNTY_FORM,
          domainId: domainContext.id,
          domainName: domainContext.name,
          targetDir: domainContext.countyDirectory,
        });
        setCountyStatus({ stage: 'idle', error: '', message: '' });
        setDomainStatus({
          stage: 'success',
          error: '',
          message: successParts.join(' '),
          domain: domainContext,
        });
      } catch (err) {
        console.error('Domain Smith failed', err);
        setDomainStatus({
          stage: 'error',
          error: err?.message || 'Failed to forge the domain. Try again.',
          message: '',
        });
      }
    },
    [
      basePath,
      crumbs,
      currentPath,
      domainForm.name,
      domainForm.category,
      domainForm.capital,
      domainForm.populationMin,
      domainForm.populationMax,
      domainForm.rulerId,
      domainForm.regionPath,
      fetchList,
      items,
      npcLabelById,
      regionOptions,
    ],
  );

  const handlePromptForgeCounties = useCallback(
    (domainInfo) => {
      const resolved = domainInfo && typeof domainInfo === 'object' ? domainInfo : activeCountyDomain;
      if (!resolved) {
        return;
      }
      const merged = recentDomain && resolved.id && recentDomain.id === resolved.id
        ? { ...recentDomain, ...resolved }
        : resolved;
      const fallbackFolder = (merged.directory && merged.directory.trim())
        || (currentPath && currentPath.trim())
        || (basePath && basePath.trim())
        || '';
      const defaultTarget = merged.countyDirectory
        ? merged.countyDirectory
        : merged.directory
          ? joinPath(merged.directory, 'Counties')
          : fallbackFolder;
      const normalizedTarget = defaultTarget || fallbackFolder;
      setActiveCountyDomain(merged);
      setCountyForm({
        ...DEFAULT_COUNTY_FORM,
        domainId: merged.id || '',
        domainName: merged.name || '',
        targetDir: normalizedTarget,
      });
      setCountyStatus({ stage: 'idle', error: '', message: '' });
      setShowCountySmith(true);
    },
    [activeCountyDomain, basePath, currentPath, recentDomain],
  );

  const handleCountyClose = useCallback(() => {
    setShowCountySmith(false);
    setCountyStatus({ stage: 'idle', error: '', message: '' });
    setCountyForm((prev) => {
      const domainId = prev.domainId || activeCountyDomain?.id || '';
      const domainName = prev.domainName || activeCountyDomain?.name || '';
      const fallbackDir = activeCountyDomain?.countyDirectory
        || (activeCountyDomain?.directory ? joinPath(activeCountyDomain.directory, 'Counties') : '');
      return {
        ...DEFAULT_COUNTY_FORM,
        domainId,
        domainName,
        targetDir: fallbackDir,
      };
    });
  }, [activeCountyDomain]);

  const handleCountyFormChange = useCallback((patch) => {
    setCountyForm((prev) => ({ ...prev, ...patch }));
    setCountyStatus((prevStatus) => {
      if (prevStatus.stage === 'idle' && !prevStatus.error && !prevStatus.message) {
        return prevStatus;
      }
      return { stage: 'idle', error: '', message: '' };
    });
  }, []);

  const handleCountySubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmedName = String(countyForm.name || '').trim();
      if (!trimmedName) {
        setCountyStatus({ stage: 'error', error: 'Please provide a county name.', message: '' });
        return;
      }

      const resolvedDomainId = String(countyForm.domainId || activeCountyDomain?.id || '').trim();
      const resolvedDomainName = String(countyForm.domainName || activeCountyDomain?.name || '').trim();
      if (!resolvedDomainId) {
        setCountyStatus({ stage: 'error', error: 'Provide the parent domain ID so the county links correctly.', message: '' });
        return;
      }

      const fallbackFolder = (activeCountyDomain?.directory && activeCountyDomain.directory.trim())
        || (currentPath && currentPath.trim())
        || (basePath && basePath.trim())
        || '';
      const selectedFolder = String(countyForm.targetDir || '').trim();
      const targetFolder = selectedFolder || fallbackFolder;
      if (!targetFolder) {
        setCountyStatus({ stage: 'error', error: 'Pick a folder to store the new county.', message: '' });
        return;
      }

      const slug = slugify(trimmedName, 'county');
      const countyId = `county_${slug}_${randomHash(6)}`;
      const trimmedCategory = String(countyForm.category || '').trim();
      const trimmedSeat = String(countyForm.seatOfPower || '').trim();
      const trimmedCapital = String(countyForm.capital || '').trim();
      const trimmedGovernance = String(countyForm.governanceType || '').trim();
      const trimmedRulingHouse = String(countyForm.rulingHouse || '').trim();
      const trimmedPopulation = String(countyForm.population || '').trim();
      const trimmedAllegiance = String(countyForm.allegiance || '').trim();
      const trimmedNotes = String(countyForm.notes || '').trim();
      const trimmedPrimarySpecies = String(countyForm.primarySpecies || '').trim();
      const crumbTrail = crumbs.map((crumb) => crumb.label).filter(Boolean).join(' > ') || 'Regions';
      const regionDescriptor = regionOptionLookup.get(targetFolder) || targetFolder;

      const domainContext = activeCountyDomain && (!countyForm.domainId || activeCountyDomain.id === resolvedDomainId)
        ? activeCountyDomain
        : recentDomain && (!recentDomain.id || recentDomain.id === resolvedDomainId)
          ? recentDomain
          : activeCountyDomain || recentDomain || null;
      const domainMarkdown = domainContext?.markdown || '';
      const truncatedDomainMarkdown = domainMarkdown.length > 8000
        ? `${domainMarkdown.slice(0, 8000)}\n...`
        : domainMarkdown;

      const promptSections = [
        `Fill out the Dungeons & Dragons county template for a county named "${trimmedName}".`,
        resolvedDomainName
          ? `Parent domain: ${resolvedDomainName} (id: ${resolvedDomainId}). Set domain_id to this value.`
          : `Set domain_id to ${resolvedDomainId}.`,
        trimmedCategory
          ? `County descriptors input: ${trimmedCategory}. Convert this into the category array.`
          : '',
        trimmedSeat ? `Seat of power input: ${trimmedSeat}.` : '',
        trimmedCapital ? `Capital input: ${trimmedCapital}.` : '',
        trimmedRulingHouse ? `Ruling house input: ${trimmedRulingHouse}.` : '',
        trimmedGovernance ? `Governance type input: ${trimmedGovernance}.` : '',
        trimmedPopulation ? `Population input: ${trimmedPopulation}.` : '',
        trimmedPrimarySpecies
          ? `Primary species input: ${trimmedPrimarySpecies}. Populate the primary_species array accordingly.`
          : '',
        trimmedAllegiance ? `Allegiance input: ${trimmedAllegiance}.` : '',
        trimmedNotes ? `Creator notes: ${trimmedNotes}` : '',
        truncatedDomainMarkdown
          ? `Parent domain dossier (Markdown):\n${truncatedDomainMarkdown}`
          : '',
        `Destination folder: ${regionDescriptor} (${targetFolder}). Breadcrumb trail: ${crumbTrail}.`,
        `Template to follow:\n${COUNTY_TEMPLATE}`,
        [
          'Formatting requirements:',
          `- Set the YAML id to "${countyId}".`,
          '- Keep the type as "county".',
          `- Set domain_id to "${resolvedDomainId}".`,
          '- Populate every field with evocative lore suitable for tabletop play.',
          '- Convert descriptor inputs into YAML lists where appropriate.',
          '- Preserve all keys and comments from the template.',
          '- Respond with Markdown only.',
        ].join('\n'),
      ].filter(Boolean);

      const prompt = promptSections.join('\n\n');
      const systemMessage =
        'You are Blossom, an expert tabletop worldbuilding assistant. Return polished Markdown that strictly matches the provided template order, producing immersive yet practical details for a busy Dungeon Master.';

      setCountyStatus({ stage: 'generating', error: '', message: '' });

      try {
        const llmResponse = await invoke('generate_llm', { prompt, system: systemMessage });
        const generated = typeof llmResponse === 'string' ? llmResponse.trim() : '';
        if (!generated) {
          throw new Error('The language model returned an empty response.');
        }

        setCountyStatus({ stage: 'saving', error: '', message: '' });

        const parsed = matter(generated);
        const entityData = parsed?.data && typeof parsed.data === 'object' ? { ...parsed.data } : null;
        if (!entityData) {
          throw new Error('Generated markdown is missing YAML front matter.');
        }
        if (!entityData.id) entityData.id = countyId;
        if (!entityData.type) entityData.type = 'county';
        if (!entityData.name) entityData.name = trimmedName;
        if (!entityData.domain_id) entityData.domain_id = resolvedDomainId;

        const body = parsed?.content ?? '';
        const filenameSlug = slugify(entityData.name || trimmedName, slug);

        let vaultRoot = '';
        try {
          const resolvedRoot = await getDreadhavenRoot();
          if (typeof resolvedRoot === 'string' && resolvedRoot.trim()) {
            vaultRoot = resolvedRoot.trim();
          }
        } catch (rootErr) {
          console.warn('County Smith: failed to resolve vault root from config', rootErr);
        }
        if (!vaultRoot) {
          vaultRoot = deriveVaultRootFromRegionsPath(basePath) || 'D:/Documents/DreadHaven';
        }

        const relativeTargetDir = toRelativeVaultPath(vaultRoot, targetFolder);

        let creation = null;
        if (relativeTargetDir) {
          try {
            creation = await createCounty(trimmedName, { targetDir: relativeTargetDir });
          } catch (creationErr) {
            console.warn('County Smith: falling back to manual save', creationErr);
          }
        }

        const targetPath = creation?.path || joinPath(targetFolder, `${filenameSlug}.md`);
        const targetDirectory = creation?.path
          ? creation.path.replace(/[\\/][^\\/]+$/, '')
          : targetFolder;

        const finalEntity = { ...entityData };
        if (!finalEntity.id) finalEntity.id = countyId;
        if (creation?.id) finalEntity.id = creation.id;
        if (!finalEntity.type) finalEntity.type = 'county';
        if (creation?.type) finalEntity.type = creation.type;
        if (!finalEntity.name) finalEntity.name = trimmedName;
        if (!finalEntity.domain_id) finalEntity.domain_id = resolvedDomainId;

        await saveEntity({ entity: finalEntity, body, path: targetPath, format: 'markdown' });

        await fetchList(targetDirectory);
        setCurrentPath(targetDirectory);
        setActivePath(targetPath);
        setCountyForm({
          ...DEFAULT_COUNTY_FORM,
          domainId: resolvedDomainId,
          domainName: resolvedDomainName || domainContext?.name || '',
          targetDir: targetDirectory,
        });
        const successParts = [`Saved ${finalEntity.name || trimmedName} to ${targetDirectory}.`];
        successParts.push(
          resolvedDomainName
            ? `Linked domain: ${resolvedDomainName} (${resolvedDomainId}).`
            : `Linked domain id: ${resolvedDomainId}.`,
        );
        setCountyStatus({
          stage: 'success',
          error: '',
          message: successParts.join(' '),
        });
        if (domainContext) {
          const nextContext = { ...domainContext, countyDirectory: targetDirectory };
          setActiveCountyDomain((prev) => {
            if (!prev || prev.id !== nextContext.id) return prev;
            return nextContext;
          });
          setRecentDomain((prev) => {
            if (!prev || prev.id !== nextContext.id) return prev;
            return nextContext;
          });
        }
      } catch (err) {
        console.error('County Smith failed', err);
        setCountyStatus({
          stage: 'error',
          error: err?.message || 'Failed to forge the county. Try again.',
          message: '',
        });
      }
    },
    [
      activeCountyDomain,
      basePath,
      countyForm.allegiance,
      countyForm.capital,
      countyForm.category,
      countyForm.domainId,
      countyForm.domainName,
      countyForm.governanceType,
      countyForm.name,
      countyForm.notes,
      countyForm.population,
      countyForm.primarySpecies,
      countyForm.rulingHouse,
      countyForm.seatOfPower,
      countyForm.targetDir,
      crumbs,
      currentPath,
      fetchList,
      regionOptionLookup,
      recentDomain,
      createCounty,
    ],
  );

  const metadataByEntityId = useMemo(() => {
    const map = new Map();
    for (const [path, meta] of Object.entries(metadataMap)) {
      if (!meta) continue;
      const id = meta.entityId ? String(meta.entityId).trim().toLowerCase() : '';
      if (id) {
        map.set(id, { path, meta });
      }
    }
    return map;
  }, [metadataMap]);

  const metadataByName = useMemo(() => {
    const map = new Map();
    for (const [path, meta] of Object.entries(metadataMap)) {
      if (!meta) continue;
      const label = (meta.displayName || extractNameFromPath(path)).trim().toLowerCase();
      if (label) {
        map.set(label, { path, meta });
      }
    }
    return map;
  }, [metadataMap]);

  const activeMetadata = activePath ? metadataMap[activePath] : null;

  const detailBreadcrumbs = useMemo(() => {
    if (!activePath || !activeMetadata) return [];
    const crumbsOut = [];
    const seen = new Set();
    const addCrumb = (entry, { isCurrent = false } = {}) => {
      if (!entry) return;
      const baseLabel = entry.label || entry.name || entry.title || '';
      const entityId = entry.entityId || entry.id || '';
      let label = baseLabel || entityId || '';
      let candidatePath = entry.path || '';
      if (!candidatePath && entityId) {
        const match = metadataByEntityId.get(String(entityId).toLowerCase());
        if (match) candidatePath = match.path;
      }
      if (!candidatePath && label) {
        const match = metadataByName.get(String(label).trim().toLowerCase());
        if (match) candidatePath = match.path;
      }
      if (candidatePath && !metadataMap[candidatePath]) {
        candidatePath = '';
      }
      if (!label && candidatePath) {
        label = extractNameFromPath(candidatePath);
      }
      if (!label) return;
      const key = `${label.toLowerCase()}|${entityId || ''}|${candidatePath || ''}|${isCurrent ? 'current' : 'normal'}`;
      if (seen.has(key)) return;
      seen.add(key);
      const route = entityId ? getEntityRoute(entityId) : '';
      crumbsOut.push({
        label,
        entityId,
        path: candidatePath,
        route,
        isCurrent,
      });
    };

    if (activeMetadata.hierarchy && activeMetadata.hierarchy.length) {
      activeMetadata.hierarchy.forEach((entry) => addCrumb(entry));
    } else if (activeMetadata.parentName || activeMetadata.parentId) {
      addCrumb({
        label: activeMetadata.parentName || '',
        entityId: activeMetadata.parentId || '',
        path: activeMetadata.parentPath || '',
      });
    }

    addCrumb(
      {
        label:
          activeMetadata.displayName ||
          extractNameFromPath(activePath) ||
          activeMetadata.raw?.title ||
          activeMetadata.raw?.name ||
          'Current Region',
        path: activePath,
      },
      { isCurrent: true },
    );

    return crumbsOut;
  }, [activePath, activeMetadata, metadataByEntityId, metadataByName, metadataMap]);

  const parentCrumb = detailBreadcrumbs.length > 1
    ? detailBreadcrumbs[detailBreadcrumbs.length - 2]
    : null;

  const linkedEntities = useMemo(() => {
    if (!activeMetadata || !Array.isArray(activeMetadata.linkedEntityIds)) return [];
    return activeMetadata.linkedEntityIds.map((id) => {
      const lower = String(id).toLowerCase();
      const match = metadataByEntityId.get(lower);
      const label = match?.meta?.displayName || formatEntityIdLabel(id);
      const route = getEntityRoute(id);
      return {
        id,
        label,
        route,
        path: match?.path || '',
      };
    });
  }, [activeMetadata, metadataByEntityId]);

  const smithCards = [
    {
      key: 'domain-smith',
      title: 'Domain Smith',
      icon: 'Hammer',
      description: 'Forge bespoke divine domains and portfolios.',
      onClick: handleOpenDomainSmith,
    },
    {
      key: 'location-smith',
      title: 'Location Smith',
      icon: 'MapPin',
      description: 'Shape landmarks, settlements, and notable sites.',
      onClick: () => { /* TODO: wire Location Smith */ },
    },
    {
      key: 'adventure-smith',
      title: 'Adventure Site Smith',
      icon: 'Mountain',
      description: 'Draft dungeons, lairs, and story set pieces.',
      onClick: () => { /* TODO: wire Adventure Site Smith */ },
    },
  ];

  return (
    <>
      <DomainSmithModal
        open={showDomainSmith}
        form={domainForm}
        onChange={handleDomainFormChange}
        onClose={handleDomainClose}
        onSubmit={handleDomainSubmit}
        status={domainStatus}
        regionOptions={regionOptions}
        npcOptions={npcOptions}
        onForgeCounties={handlePromptForgeCounties}
      />
      <CountySmithModal
        open={showCountySmith}
        form={countyForm}
        onChange={handleCountyFormChange}
        onClose={handleCountyClose}
        onSubmit={handleCountySubmit}
        status={countyStatus}
        regionOptions={countyRegionOptions}
        domain={activeCountyDomain}
      />
      <BackButton />
      <h1>Dungeons & Dragons · Regions</h1>
      <div className="regions-controls">
        <button type="button" onClick={() => fetchList(currentPath)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <nav className="regions-breadcrumbs">
          {crumbs.map((c, idx) => (
            <Fragment key={c.path || idx}>
              {idx > 0 && <span className="crumb-sep">/</span>}
              <button className="crumb" onClick={() => setCurrentPath(c.path)}>{c.label}</button>
            </Fragment>
          ))}
        </nav>
        {error && <span className="error">{error}</span>}
      </div>
      <section className="dashboard dnd-card-grid regions-overview-row">
        {smithCards.map(({ key, title, icon, description, onClick }) => (
          <Card key={key} icon={icon} title={title} onClick={onClick}>
            {description}
          </Card>
        ))}
      </section>
      <div className="regions">
        <section className="regions-grid">
          {items.map((it) => {
            const baseName = it.name.replace(/\.[^.]+$/, '');
            if (it.is_dir) {
              return (
                <button
                  key={it.path}
                  className={`regions-card${it.path === currentPath ? ' active' : ''}`}
                  onClick={() => setCurrentPath(it.path)}
                  title={it.path}
                >
                  <div className="regions-card-head">
                    <div className="regions-card-title">
                      <Icon name="Folder" size={24} className="regions-card-icon" />
                      <span>{baseName}</span>
                    </div>
                    <span className="world-card-type">
                      <Icon name="FolderTree" size={16} />
                      <span>Folder</span>
                    </span>
                  </div>
                  <div className="regions-card-footer">
                    <time title={formatDate(it.modified_ms)}>{formatDate(it.modified_ms)}</time>
                  </div>
                </button>
              );
            }

            const meta = metadataMap[it.path];
            const typeInfo = meta ? getRegionTypeInfo(meta.type) : null;
            const typeLabel = typeInfo?.label || (meta?.rawType ? String(meta.rawType) : 'Region');
            const typeIcon = typeInfo?.icon || 'Map';
            let parentLabel = meta?.parentName || '';
            if (!parentLabel && meta?.parentId) {
              parentLabel = formatEntityIdLabel(meta.parentId);
            }
            if (!parentLabel && Array.isArray(meta?.hierarchy) && meta.hierarchy.length) {
              const last = meta.hierarchy[meta.hierarchy.length - 1];
              parentLabel = last?.label || (last?.entityId ? formatEntityIdLabel(last.entityId) : '');
            }
            const tags = Array.isArray(meta?.tags) ? meta.tags.filter(Boolean).slice(0, 4) : [];
            const summary = meta?.summary ? truncate(meta.summary, 160) : '';

            return (
              <button
                key={it.path}
                className={`regions-card${it.path === activePath ? ' active' : ''}`}
                onClick={() => setActivePath(it.path)}
                title={it.path}
              >
                <div className="regions-card-head">
                  <div className="regions-card-title">
                    <Icon name="FileText" size={22} className="regions-card-icon" />
                    <span>{baseName}</span>
                  </div>
                  {typeLabel && (
                    <span className="world-card-type">
                      <Icon name={typeIcon} size={16} />
                      <span>{typeLabel}</span>
                    </span>
                  )}
                </div>
                <div className="regions-card-body">
                  {parentLabel && (
                    <div className="regions-card-parent">
                      <Icon name="MapPin" size={14} />
                      <span>{parentLabel}</span>
                    </div>
                  )}
                  {summary && <p className="regions-card-summary">{summary}</p>}
                  {tags.length > 0 && (
                    <div className="regions-card-tags">
                      {tags.map((tag) => (
                        <span key={tag} className="world-tag-chip">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="regions-card-footer">
                  <time title={formatDate(it.modified_ms)}>{formatDate(it.modified_ms)}</time>
                </div>
              </button>
            );
          })}
          {!loading && items.length === 0 && (
            <div className="muted">This region is empty.</div>
          )}
        </section>
        <section className="regions-reader">
          {activePath ? (
            <article className="inbox-reader-body">
              {activeMetadata && (
                <>
                  {detailBreadcrumbs.length > 0 && (
                    <nav className="world-detail-breadcrumbs">
                      {detailBreadcrumbs.map((crumb, index) => (
                        <span key={`${crumb.label}-${index}`} className="world-detail-crumb-wrapper">
                          {index > 0 && <span className="crumb-sep">/</span>}
                          {crumb.isCurrent ? (
                            <span className="world-detail-crumb is-current">{crumb.label}</span>
                          ) : crumb.route ? (
                            <Link to={crumb.route} className="world-detail-crumb">{crumb.label}</Link>
                          ) : crumb.path ? (
                            <button
                              type="button"
                              className="world-detail-crumb"
                              onClick={() => setActivePath(crumb.path)}
                            >
                              {crumb.label}
                            </button>
                          ) : (
                            <span className="world-detail-crumb">{crumb.label}</span>
                          )}
                        </span>
                      ))}
                    </nav>
                  )}
                  <header className="world-detail-header">
                    <div className="world-detail-topline">
                      {(() => {
                        const typeInfo = getRegionTypeInfo(activeMetadata.type);
                        const badgeLabel = typeInfo?.label || (activeMetadata.rawType ? String(activeMetadata.rawType) : 'Region');
                        const badgeIcon = typeInfo?.icon || 'Map';
                        return (
                          <span className="world-detail-type">
                            <Icon name={badgeIcon} size={18} />
                            <span>{badgeLabel}</span>
                          </span>
                        );
                      })()}
                      <h2 className="world-detail-title">
                        {activeMetadata.displayName || extractNameFromPath(activePath)}
                      </h2>
                    </div>
                    {activeMetadata.summary && (
                      <p className="world-detail-summary">{activeMetadata.summary}</p>
                    )}
                    {Array.isArray(activeMetadata.tags) && activeMetadata.tags.length > 0 && (
                      <div className="world-detail-tags">
                        {activeMetadata.tags.map((tag) => (
                          <span key={tag} className="world-tag-chip">{tag}</span>
                        ))}
                      </div>
                    )}
                    {(() => {
                      const rows = [];
                      if (parentCrumb) {
                        let content;
                        if (parentCrumb.route) {
                          content = <Link to={parentCrumb.route}>{parentCrumb.label}</Link>;
                        } else if (parentCrumb.path) {
                          content = (
                            <button type="button" onClick={() => setActivePath(parentCrumb.path)}>
                              {parentCrumb.label}
                            </button>
                          );
                        } else {
                          content = parentCrumb.label;
                        }
                        rows.push({ key: 'parent', label: 'Parent', value: content });
                      }
                      if (activeMetadata.population) {
                        rows.push({ key: 'population', label: 'Population', value: activeMetadata.population });
                      }
                      if (activeMetadata.capital) {
                        rows.push({ key: 'capital', label: 'Capital', value: activeMetadata.capital });
                      }
                      if (Array.isArray(activeMetadata.leaders) && activeMetadata.leaders.length) {
                        rows.push({
                          key: 'leaders',
                          label: 'Leadership',
                          value: activeMetadata.leaders.join(', '),
                        });
                      }
                      if (activeMetadata.allegiance) {
                        rows.push({ key: 'allegiance', label: 'Allegiance', value: activeMetadata.allegiance });
                      }
                      if (activeMetadata.terrain) {
                        rows.push({ key: 'terrain', label: 'Terrain', value: activeMetadata.terrain });
                      }
                      if (activeMetadata.wealth) {
                        rows.push({ key: 'wealth', label: 'Wealth', value: activeMetadata.wealth });
                      }
                      if (!rows.length) return null;
                      return (
                        <dl className="world-detail-meta">
                          {rows.map((row) => (
                            <div key={row.key} className="world-detail-meta-row">
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      );
                    })()}
                    {linkedEntities.length > 0 && (
                      <div className="world-detail-linked">
                        <h3>Linked Entities</h3>
                        <ul>
                          {linkedEntities.map((entity) => (
                            <li key={entity.id}>
                              {entity.route ? (
                                <Link to={entity.route}>{entity.label}</Link>
                              ) : entity.path ? (
                                <button type="button" onClick={() => setActivePath(entity.path)}>
                                  {entity.label}
                                </button>
                              ) : (
                                <span>{entity.label}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </header>
                </>
              )}
              {/\.(md|mdx|markdown)$/i.test(activePath) ? (
                renderMarkdown(activeContent)
              ) : (
                <pre className="inbox-reader-content">{activeContent}</pre>
              )}
            </article>
          ) : (
            <div className="muted">Select a file to preview.</div>
          )}
        </section>
      </div>
    </>
  );
}

