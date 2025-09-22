import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox } from '../api/inbox';
import { readFileBytes } from '../api/files';
import { createNpc } from '../api/npcs';
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

  useEffect(() => {
    if (!activePath) { setActiveContent(''); return; }
    (async () => {
      try {
        const text = await readInbox(activePath);
        setActiveContent(text || '');
      } catch (e) {
        setActiveContent('Failed to load file.');
      }
    })();
  }, [activePath]);

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
            onClick={() => { setActivePath(item.path); setModalOpen(true); }}
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
                <header className="inbox-reader-header">
                  <h2 className="inbox-reader-title">{selected.title || selected.name}</h2>
                  <div className="inbox-reader-meta">
                    <span>{selected.name}</span>
                    <span>·</span>
                    <span>{locations[selected.path] || relLocation(usingPath, selected.path) || ''}</span>
                  </div>
                </header>
                <article className="inbox-reader-body">
                  {/\.(md|mdx|markdown)$/i.test(selected.name || '') ? (
                    renderMarkdown(activeContent || 'Loading.')
                  ) : (
                    <pre className="inbox-reader-content">{activeContent || 'Loading.'}</pre>
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
              try {
                setCreating(true);
                setCreateError('');
                await createNpc(randName ? '' : name, selRegion || '', purpose || '', null, randName);
                setShowCreate(false);
                setNewName('');
                setRandName(false);
                setSelRegion('');
                setSelPurpose('');
                setCustomPurpose('');
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
