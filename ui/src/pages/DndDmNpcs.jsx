import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox } from '../api/inbox';
import { readFileBytes } from '../api/files';
import { createNpc } from '../api/npcs';
import { loadEstablishments } from '../api/establishments';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

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
  const [portraitIndex, setPortraitIndex] = useState({});
  const [portraitUrls, setPortraitUrls] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [randName, setRandName] = useState(false);
  const [selRegion, setSelRegion] = useState('');
  const [selPurpose, setSelPurpose] = useState('');
  const [customPurpose, setCustomPurpose] = useState('');
  const [createError, setCreateError] = useState('');
  const [regionOptions, setRegionOptions] = useState([]);
  const [establishmentName, setEstablishmentName] = useState('');
  const [establishmentRecord, setEstablishmentRecord] = useState('');
  const [establishmentOptions, setEstablishmentOptions] = useState([]);
  const [establishmentsLoading, setEstablishmentsLoading] = useState(false);
  const [establishmentsError, setEstablishmentsError] = useState('');
  const [establishmentsAttempted, setEstablishmentsAttempted] = useState(false);

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

  // Build region options by crawling directories under NPC root
  useEffect(() => {
    (async () => {
      try {
        const vault = await getConfig('vaultPath');
        const base = (typeof vault === 'string' && vault)
          ? `${vault}\\\\20_DM\\\\NPC`.replace(/\\\\/g, '\\\\')
          : 'D:\\Documents\\DreadHaven\\20_DM\\NPC';
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
              stack.push(e.path);
              // add relative path as option
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

  useEffect(() => {
    if (selPurpose !== 'Shopkeeper') {
      setEstablishmentName('');
      setEstablishmentRecord('');
    }
  }, [selPurpose]);

  const fetchEstablishments = useCallback(async () => {
    if (establishmentsLoading) return;
    setEstablishmentsLoading(true);
    setEstablishmentsError('');
    try {
      const result = await loadEstablishments();
      const items = Array.isArray(result?.items) ? result.items : [];
      const simplified = items
        .map((item) => ({
          path: item?.path || '',
          title: item?.title || item?.name || '',
          group: item?.group || '',
          region: item?.region || '',
          location: item?.location || '',
        }))
        .filter((item) => item.path);
      setEstablishmentOptions(simplified);
    } catch (err) {
      setEstablishmentsError(err?.message || String(err));
    } finally {
      setEstablishmentsAttempted(true);
      setEstablishmentsLoading(false);
    }
  }, [establishmentsLoading]);

  useEffect(() => {
    if (!showCreate) {
      setEstablishmentsAttempted(false);
      return;
    }
    if (selPurpose !== 'Shopkeeper') return;
    if (establishmentOptions.length > 0) return;
    if (establishmentsLoading || establishmentsAttempted) return;
    fetchEstablishments();
  }, [showCreate, selPurpose, establishmentOptions.length, establishmentsLoading, establishmentsAttempted, fetchEstablishments]);

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
          if (fm) {
            const body = fm[1];
            const line = body.split(/\r?\n/).find((l) => /^\s*location\s*:/i.test(l));
            if (line) loc = line.split(':').slice(1).join(':').trim();
          }
          if (!loc) {
            const m = src.match(/\bLocation\s*:\s*([^\n\r]+)/i);
            if (m) loc = m[1].trim();
          }
          if (!loc) {
            loc = relLocation(usingPath, it.path);
          }
          setLocations((prev) => ({ ...prev, [it.path]: sanitizeChip(loc) }));
        } catch {/* ignore */}
      }
    })();
    return () => { cancelled = true; };
  }, [items, usingPath]);

  const selected = useMemo(() => items.find((i) => i.path === activePath), [items, activePath]);

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

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · NPCs</h1>
      <div className="pantheon-controls">
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
        {items.map((item) => (
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
        {!loading && items.length === 0 && (
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
                    <h2 className="npc-name">{selected.title || selected.name}</h2>
                    <div className="inbox-reader-meta">
                      <span>{selected.name}</span>
                      {locationLabel && (
                        <>
                          <span>·</span>
                          <span>{locationLabel}</span>
                        </>
                      )}
                    </div>
                    {metadataChips.length > 0 && (
                      <div className="npc-chips">
                        {metadataChips.map((chip) => (
                          <span key={chip.id} className="chip">{chip.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </header>
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
              const estPath = selPurpose === 'Shopkeeper'
                ? (establishmentRecord || '').trim()
                : '';
              const estDisplay = selPurpose === 'Shopkeeper'
                ? (establishmentName || '').trim()
                : '';
              try {
                setCreating(true);
                setCreateError('');
                await createNpc(
                  randName ? '' : name,
                  selRegion || '',
                  purpose || '',
                  null,
                  randName,
                  estPath || null,
                  estDisplay || null,
                );
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
                <input type="text" value={newName} onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(''); }} autoFocus disabled={creating || randName} placeholder={randName ? 'Ollama will choose a name' : ''} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={randName} onChange={(e) => setRandName(e.target.checked)} disabled={creating} />
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
              {selPurpose === 'Shopkeeper' && (
                <div className="monster-create-shopkeeper">
                  <div className="monster-create-shopkeeper-title">Establishment Link</div>
                  <p className="muted">
                    Connect this shopkeeper to the storefront they manage. Choose from an existing establishment
                    note or enter the display name manually.
                  </p>
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
                        const value = e.target.value;
                        setEstablishmentRecord(value);
                        if (value) {
                          const found = establishmentOptions.find((item) => item.path === value);
                          if (found) {
                            setEstablishmentName(found.title || found.group || found.path || '');
                          }
                        } else {
                          setEstablishmentName('');
                        }
                      }}
                      disabled={creating || (establishmentsLoading && establishmentOptions.length === 0)}
                    >
                      <option value="">(no linked establishment)</option>
                      {establishmentsLoading && establishmentOptions.length === 0 && (
                        <option value="" disabled>Loading establishments…</option>
                      )}
                      {establishmentRecord && !establishmentOptions.some((item) => item.path === establishmentRecord) && (
                        <option value={establishmentRecord}>
                          {establishmentName || `Previously selected (${establishmentRecord})`}
                        </option>
                      )}
                      {establishmentOptions.map((item) => {
                        const seen = new Set();
                        const gather = (value) => String(value || '')
                          .split('/')
                          .map((segment) => segment.trim())
                          .filter(Boolean);
                        const parts = [];
                        const pushSeg = (seg) => {
                          if (!seg) return;
                          const key = seg.toLowerCase();
                          if (seen.has(key)) return;
                          seen.add(key);
                          parts.push(seg);
                        };
                        gather(item.region).forEach(pushSeg);
                        gather(item.location).forEach(pushSeg);
                        if (!parts.length) {
                          gather(item.group).forEach(pushSeg);
                        }
                        const prefix = parts.join(' · ');
                        const title = String(item.title || item.group || item.path || '').trim() || 'Untitled Establishment';
                        const label = prefix ? `${prefix} · ${title}` : title;
                        return (
                          <option key={item.path} value={item.path}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  {!establishmentsLoading && establishmentsAttempted && establishmentOptions.length === 0 && !establishmentsError && (
                    <div className="muted">No establishment notes were found.</div>
                  )}
                  {establishmentsError && (
                    <div className="error" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{establishmentsError}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEstablishmentsAttempted(false);
                          fetchEstablishments();
                        }}
                        disabled={establishmentsLoading}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEstablishmentsAttempted(false);
                      fetchEstablishments();
                    }}
                    disabled={establishmentsLoading}
                  >
                    {establishmentsLoading ? 'Loading establishments…' : 'Refresh Establishments'}
                  </button>
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
    </>
  );
}
