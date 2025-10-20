import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import { getDreadhavenRoot } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';
import { useVaultVersion } from '../lib/vaultEvents.jsx';
import matter from 'gray-matter';
import { ENTITY_ID_PATTERN } from '../lib/dndIds.js';

const DEFAULT_FACTIONS = 'D\\\\Documents\\\\DreadHaven\\\\10_World\\\\Factions'.replace(/\\\\/g, '\\\\');

function joinPath(base, seg) {
  if (!base) return seg;
  if (/\\$/.test(base)) return `${base}${seg}`;
  return `${base}\\\\${seg}`;
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

const FACTION_TYPE_ICONS = {
  faction: { icon: 'Shield', label: 'Faction' },
  guild: { icon: 'BadgeCheck', label: 'Guild' },
  order: { icon: 'Scroll', label: 'Order' },
  cult: { icon: 'Flame', label: 'Cult' },
  cabal: { icon: 'Sparkles', label: 'Cabal' },
  alliance: { icon: 'Users', label: 'Alliance' },
  company: { icon: 'Briefcase', label: 'Company' },
  council: { icon: 'Gavel', label: 'Council' },
  clan: { icon: 'Swords', label: 'Clan' },
  tribe: { icon: 'Tent', label: 'Tribe' },
  syndicate: { icon: 'Gem', label: 'Syndicate' },
  church: { icon: 'Church', label: 'Church' },
  order_of_knights: { icon: 'ShieldHalf', label: 'Knighthood' },
  militia: { icon: 'ShieldPlus', label: 'Militia' },
  house: { icon: 'Castle', label: 'House' },
  circle: { icon: 'Circle', label: 'Circle' },
  league: { icon: 'Trophy', label: 'League' },
};

function getEntityRoute(entityId) {
  const match = String(entityId || '').match(/^([a-z]+)/i);
  if (!match) return '';
  const type = match[1].toLowerCase();
  const builder = ENTITY_ROUTE_BUILDERS[type];
  return builder ? builder(entityId) : '';
}

function getFactionTypeInfo(type) {
  if (!type) return null;
  const normalized = String(type).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return FACTION_TYPE_ICONS[normalized] || FACTION_TYPE_ICONS[type?.toLowerCase()] || null;
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
      // ignore JSON parse errors
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
      // ignore
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

function extractFactionMetadata(text, fallback = {}) {
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
  const typeValue = firstNonEmpty(lookup, ['type', 'faction_type', 'classification', 'category', 'tier']);
  const parentName = firstNonEmpty(lookup, ['parent', 'region', 'territory', 'sphere', 'parent_faction']);
  const parentId = firstNonEmpty(lookup, ['parent_id', 'parentId', 'region_id', 'territory_id', 'parent_entity']);
  const parentPath = firstNonEmpty(lookup, ['parent_path', 'parent_note', 'parent_file']);
  const summary = firstNonEmpty(lookup, ['summary', 'description', 'mission', 'overview', 'synopsis']) || deriveSummaryFromContent(body);
  const tags = normalizeList(
    lookup.tags || lookup.key_tags || lookup.keywords || lookup.themes || lookup.focus || lookup.traits || [],
  );
  const leaders = normalizeList(
    lookup.leaders ||
      lookup.leadership ||
      lookup.commanders ||
      lookup.figureheads ||
      lookup.captains ||
      lookup.patrons ||
      lookup.champions ||
      lookup.leader ||
      [],
  );
  const allegiance = firstNonEmpty(
    lookup,
    ['allegiance', 'loyalty', 'alignment', 'affiliation', 'sponsor', 'alliance', 'allegiance_to'],
  );
  const headquarters = firstNonEmpty(
    lookup,
    ['headquarters', 'hq', 'base', 'base_of_operations', 'lair', 'home', 'seat'],
  );
  const influence = firstNonEmpty(lookup, ['influence', 'reach', 'power', 'presence']);
  const size = firstNonEmpty(lookup, ['size', 'membership', 'members', 'population']);
  const resources = normalizeList(lookup.resources || lookup.assets || lookup.capabilities || []);
  const goals = normalizeList(lookup.goals || lookup.objectives || lookup.agenda || lookup.mission || []);
  const operations = normalizeList(lookup.operations || lookup.activities || lookup.specialties || []);
  const rivals = normalizeList(lookup.rivals || lookup.enemies || lookup.adversaries || []);
  const allies = normalizeList(lookup.allies || lookup.partners || lookup.friends || []);
  const entityId = firstNonEmpty(lookup, ['id', 'entity_id', 'entityId', 'faction_id']);
  const linkedEntityIds = Array.from(
    new Set(
      normalizeList(
        lookup.linked_entities ||
          lookup.linked_entity_ids ||
          lookup.linkedIds ||
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
  const displayName =
    firstNonEmpty(lookup, ['name', 'title', 'display_name', 'faction_name']) ||
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
    leaders,
    allegiance: allegiance ? String(allegiance).trim() : '',
    headquarters: headquarters ? String(headquarters).trim() : '',
    influence: influence ? String(influence).trim() : '',
    size: size ? String(size).trim() : '',
    resources,
    goals,
    operations,
    rivals,
    allies,
    entityId: entityId ? String(entityId).trim() : '',
    linkedEntityIds,
    hierarchy,
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

export default function DndWorldFactions() {
  const [basePath, setBasePath] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [metadataMap, setMetadataMap] = useState({});
  const metadataRef = useRef({});
  const factionsVersion = useVaultVersion(['10_world/factions']);

  const initBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getDreadhavenRoot();
      const base = (typeof vault === 'string' && vault.trim())
        ? `${vault.trim()}\\\\10_World\\\\Factions`.replace(/\\\\/g, '\\\\')
        : DEFAULT_FACTIONS;
      setBasePath(base);
      setCurrentPath(base);
    } catch (e) {
      setBasePath(DEFAULT_FACTIONS);
      setCurrentPath(DEFAULT_FACTIONS);
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
  useEffect(() => { if (currentPath) fetchList(currentPath); }, [currentPath, fetchList, factionsVersion]);

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
          const meta = extractFactionMetadata(text || '', {
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
          const meta = extractFactionMetadata(text || '', {
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
            leaders: [],
            allegiance: '',
            headquarters: '',
            influence: '',
            size: '',
            resources: [],
            goals: [],
            operations: [],
            rivals: [],
            allies: [],
            entityId: '',
            linkedEntityIds: [],
            hierarchy: [],
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
    const base = basePath.replace(/\\\\+$/, '');
    const rel = currentPath.startsWith(base) ? currentPath.slice(base.length).replace(/^\\\\+/, '') : '';
    const segs = rel ? rel.split('\\\\') : [];
    const acc = [base];
    const out = [{ label: 'Factions', path: base }];
    for (const s of segs) {
      const next = joinPath(acc[acc.length - 1], s);
      out.push({ label: s, path: next });
      acc.push(next);
    }
    return out;
  }, [basePath, currentPath]);

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
          'Current Faction',
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

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Factions</h1>
      <div className="regions-controls">
        <button type="button" onClick={() => fetchList(currentPath)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <nav className="regions-breadcrumbs">
          {crumbs.map((c, idx) => (
            <>
              {idx > 0 && <span className="crumb-sep">/</span>}
              <button key={c.path} className="crumb" onClick={() => setCurrentPath(c.path)}>{c.label}</button>
            </>
          ))}
        </nav>
        {error && <span className="error">{error}</span>}
      </div>
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
            const typeInfo = meta ? getFactionTypeInfo(meta.type) : null;
            const typeLabel = typeInfo?.label || (meta?.rawType ? String(meta.rawType) : 'Faction');
            const typeIcon = typeInfo?.icon || 'Shield';
            let parentLabel = meta?.parentName || '';
            if (!parentLabel && meta?.parentId) {
              parentLabel = formatEntityIdLabel(meta.parentId);
            }
            if (!parentLabel && Array.isArray(meta?.hierarchy) && meta.hierarchy.length) {
              const last = meta.hierarchy[meta.hierarchy.length - 1];
              parentLabel = last?.label || (last?.entityId ? formatEntityIdLabel(last.entityId) : '');
            }
            const headquarters = meta?.headquarters || '';
            const allegiance = meta?.allegiance || '';
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
                  {!parentLabel && headquarters && (
                    <div className="regions-card-parent">
                      <Icon name="Building2" size={14} />
                      <span>{headquarters}</span>
                    </div>
                  )}
                  {allegiance && (
                    <div className="regions-card-parent regions-card-allegiance">
                      <Icon name="Flag" size={14} />
                      <span>{allegiance}</span>
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
            <div className="muted">This folder is empty.</div>
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
                        const typeInfo = getFactionTypeInfo(activeMetadata.type);
                        const badgeLabel = typeInfo?.label || (activeMetadata.rawType ? String(activeMetadata.rawType) : 'Faction');
                        const badgeIcon = typeInfo?.icon || 'Shield';
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
                        rows.push({ key: 'parent', label: 'Parent Region', value: content });
                      }
                      if (activeMetadata.headquarters) {
                        rows.push({ key: 'hq', label: 'Headquarters', value: activeMetadata.headquarters });
                      }
                      if (activeMetadata.allegiance) {
                        rows.push({ key: 'allegiance', label: 'Allegiance', value: activeMetadata.allegiance });
                      }
                      if (Array.isArray(activeMetadata.leaders) && activeMetadata.leaders.length) {
                        rows.push({
                          key: 'leaders',
                          label: 'Leadership',
                          value: activeMetadata.leaders.join(', '),
                        });
                      }
                      if (activeMetadata.size) {
                        rows.push({ key: 'size', label: 'Size', value: activeMetadata.size });
                      }
                      if (activeMetadata.influence) {
                        rows.push({ key: 'influence', label: 'Influence', value: activeMetadata.influence });
                      }
                      if (Array.isArray(activeMetadata.resources) && activeMetadata.resources.length) {
                        rows.push({
                          key: 'resources',
                          label: 'Resources',
                          value: activeMetadata.resources.join(', '),
                        });
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
                    {(Array.isArray(activeMetadata.goals) && activeMetadata.goals.length > 0) ||
                    (Array.isArray(activeMetadata.operations) && activeMetadata.operations.length > 0) ||
                    (Array.isArray(activeMetadata.allies) && activeMetadata.allies.length > 0) ||
                    (Array.isArray(activeMetadata.rivals) && activeMetadata.rivals.length > 0) ? (
                      <div className="world-detail-lists">
                        {Array.isArray(activeMetadata.goals) && activeMetadata.goals.length > 0 && (
                          <div className="world-detail-list">
                            <h3>Goals</h3>
                            <ul>
                              {activeMetadata.goals.map((goal, idx) => (
                                <li key={`goal-${idx}`}>{goal}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(activeMetadata.operations) && activeMetadata.operations.length > 0 && (
                          <div className="world-detail-list">
                            <h3>Operations</h3>
                            <ul>
                              {activeMetadata.operations.map((op, idx) => (
                                <li key={`op-${idx}`}>{op}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(activeMetadata.allies) && activeMetadata.allies.length > 0 && (
                          <div className="world-detail-list">
                            <h3>Allies</h3>
                            <ul>
                              {activeMetadata.allies.map((ally, idx) => (
                                <li key={`ally-${idx}`}>{ally}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(activeMetadata.rivals) && activeMetadata.rivals.length > 0 && (
                          <div className="world-detail-list">
                            <h3>Rivals</h3>
                            <ul>
                              {activeMetadata.rivals.map((rival, idx) => (
                                <li key={`rival-${idx}`}>{rival}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : null}
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
              {(/\.(md|mdx|markdown)$/i.test(activePath)) ? (
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

