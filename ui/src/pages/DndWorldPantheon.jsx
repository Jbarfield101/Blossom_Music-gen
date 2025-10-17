import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getDreadhavenRoot } from '../api/config';
import { listInbox, readInbox, deleteInbox } from '../api/inbox';
import { listDir } from '../api/dir';
import { readFileBytes } from '../api/files';
import { createGod } from '../api/gods';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';
import { useVaultVersion } from '../lib/vaultEvents.jsx';

const DEFAULT_PANTHEON = 'D\\\\Documents\\\\DreadHaven\\\\10_World\\\\Gods of the Realm'.replace(/\\\\/g, '\\\\');
const DEFAULT_GOD_PORTRAITS = 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\God_Portraits'.replace(/\\\\/g, '\\\\');
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const GOD_TEMPLATE = 'D:\\Documents\\DreadHaven\\_Templates\\God_Template.md';

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch (e) {
    return '';
  }
}

function formatRelative(ms) {
  const now = Date.now();
  const diff = Math.max(0, now - Number(ms || 0));
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export default function DndWorldPantheon() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [godMeta, setGodMeta] = useState({});
  const [portraitIndex, setPortraitIndex] = useState({});
  const [portraitUrls, setPortraitUrls] = useState({});
  const pantheonVersion = useVaultVersion(['10_world/gods of the realm']);
  const godPortraitsVersion = useVaultVersion(['30_assets/images']);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getDreadhavenRoot();
      const base = (typeof vault === 'string' && vault.trim()) ? `${vault.trim()}\\10_World\\Gods of the Realm` : '';
      if (base) {
        const list = await listInbox(base);
        setUsingPath(base);
        setItems(Array.isArray(list) ? list : []);
        if (list && list.length > 0 && !activePath) setActivePath(list[0].path);
        return;
      }
      throw new Error('no vault');
    } catch (e1) {
      try {
        const fallback = DEFAULT_PANTHEON;
        const list = await listInbox(fallback);
        setUsingPath(fallback);
        setItems(Array.isArray(list) ? list : []);
        if (list && list.length > 0 && !activePath) setActivePath(list[0].path);
      } catch (e2) {
        console.error(e2);
        setError(e2?.message || String(e2));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [activePath]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems, pantheonVersion]);

  useEffect(() => {
    if (!activePath) {
      setActiveContent('');
      return;
    }
    (async () => {
      try {
        const text = await readInbox(activePath);
        setActiveContent(text || '');
      } catch (e) {
        setActiveContent('Failed to load file.');
      }
    })();
  }, [activePath]);

  // Build portrait index from Assets folder (God_Portraits)
  useEffect(() => {
    (async () => {
      try {
        const vault = await getDreadhavenRoot();
        const base = (typeof vault === 'string' && vault.trim())
          ? `${vault.trim()}\\\\30_Assets\\\\Images\\\\God_Portraits`.replace(/\\\\/g, '\\\\')
          : DEFAULT_GOD_PORTRAITS;
        // Recursively crawl portrait folders
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
  }, [godPortraitsVersion]);

  // Load portrait thumbnails for listed gods
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
          setPortraitUrls((prev) => ({ ...prev, [it.path]: url }));
        } catch (e) {
          // ignore
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items, portraitIndex]);

  // Load lightweight metadata (domain and aliases) for cards
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (cancelled) return;
        if (godMeta[it.path]) continue;
        try {
          const text = await readInbox(it.path);
          if (cancelled) return;
          const domain = extractGodSubtitle(text);
          const aliases = extractGodAliases(text);
          setGodMeta((prev) => ({ ...prev, [it.path]: { domain, aliases } }));
        } catch {
          // ignore
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items]);

  const selected = useMemo(() => items.find((i) => i.path === activePath), [items, activePath]);

  const extractGodSubtitle = (text) => {
    const src = String(text || '');
    // Try frontmatter block first
    const fm = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const body = fm[1];
      const lines = body.split(/\r?\n/);
      const kv = {};
      for (const raw of lines) {
        const m = raw.match(/^\s*([A-Za-z0-9_][A-Za-z0-9_\s-]*)\s*:\s*(.+)\s*$/);
        if (m) {
          const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
          const val = m[2].trim();
          if (val) kv[key] = val;
        }
      }
      const keys = ['god_of', 'domain', 'domains', 'portfolio', 'aspects', 'sphere'];
      for (const k of keys) {
        if (kv[k]) return kv[k];
      }
    }
    // Fallback: scan body text
    const m1 = src.match(/\b(God|Goddess|Deity|Patron)\s+of\s+([^\n\r]+)/i);
    if (m1) return m1[2].trim();
    const m2 = src.match(/\bDomains?\s*:\s*([^\n\r]+)/i);
    if (m2) return m2[1].trim();
    const m3 = src.match(/\bPortfolio\s*:\s*([^\n\r]+)/i);
    if (m3) return m3[1].trim();
    return '';
  };

  const extractGodAliases = (text) => {
    try {
      const out = [];
      const src = String(text || '');
      const fm = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        const body = fm[1];
        const lines = body.split(/\r?\n/);
        const kv = {};
        for (const raw of lines) {
          const m = raw.match(/^\s*([A-Za-z0-9_][A-Za-z0-9_\s-]*)\s*:\s*(.+)\s*$/);
          if (m) {
            const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
            const val = m[2].trim();
            if (val) kv[key] = val;
          }
        }
        const keys = ['aliases', 'alias', 'epithets', 'aka', 'also_known_as'];
        for (const k of keys) {
          const val = kv[k];
          if (!val) continue;
          let s = String(val);
          s = s.replace(/^\[|\]$/g, '');
          for (const part of s.split(/[,;|]/)) {
            const t = part.replace(/^['"]|['"]$/g, '').trim();
            if (t) out.push(t);
          }
          if (out.length) return Array.from(new Set(out));
        }
        const aliasIndex = lines.findIndex((l) => /^\s*(aliases|alias|epithets|aka|also_known_as)\s*:\s*$/i.test(l));
        if (aliasIndex >= 0) {
          for (let i = aliasIndex + 1; i < lines.length; i += 1) {
            const l = lines[i];
            if (!/^\s*-\s+/.test(l)) break;
            const t = l.replace(/^\s*-\s+/, '').trim();
            if (t) out.push(t);
          }
          if (out.length) return Array.from(new Set(out));
        }
      }
      const m1 = src.match(/\bAliases?\s*:\s*([^\n\r]+)/i);
      if (m1) {
        const s = m1[1].trim().replace(/^\[|\]$/g, '');
        const arr = s.split(/[,;|]/).map((t) => t.replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
        if (arr.length) return Array.from(new Set(arr));
      }
    } catch {
      // ignore
    }
    return [];
  };

  const openCreateModal = () => {
    if (creating) return;
    setNewName('');
    setCreateError('');
    setShowCreate(true);
  };

  const dismissCreateModal = () => {
    setShowCreate(false);
    setNewName('');
    setCreateError('');
  };

  const handleCreateSubmit = async (event) => {
    event.preventDefault();
    if (creating) return;
    const name = newName.trim();
    if (!name) {
      setCreateError('Please enter a god name.');
      return;
    }
    try {
      setCreating(true);
      setCreateError('');
      await createGod(name, GOD_TEMPLATE);
      dismissCreateModal();
      await fetchItems();
    } catch (e) {
      setCreateError(e?.message || 'Failed to create god.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Pantheon</h1>
      <div className="pantheon-controls">
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" onClick={openCreateModal} disabled={creating}>
          Add God
        </button>
        {usingPath && <span className="muted">Folder: {usingPath}</span>}
        {error && <span className="error">{error}</span>}
      </div>
      <section className="pantheon-grid">
        {items.map((item) => {
          const portraitSrc =
            portraitUrls[item.path] ||
            item?.portraitUrl ||
            item?.portrait ||
            item?.imageUrl ||
            item?.image ||
            item?.thumbnail ||
            item?.cover;

          const meta = godMeta[item.path] || { domain: '', aliases: [] };
          return (
            <button
              type="button"
              key={item.path}
              className="pantheon-card"
              onClick={() => {
                setActivePath(item.path);
                setError('');
                setCreateError('');
                setModalOpen(true);
              }}
              title={item.path}
            >
              {portraitSrc ? (
                <img src={portraitSrc} alt={item.title || item.name} className="monster-portrait" />
              ) : (
                <div className="monster-portrait placeholder">?</div>
              )}
              <div className="pantheon-card-title">{item.title || item.name}</div>
              {(() => {
                const raw = String((godMeta[item.path] || {}).domain || '')
                  .replace(/^God\s+of\s+/i, '')
                  .trim();
                if (!raw) return null;
                const words = raw.split(/\s+/).filter(Boolean).slice(0, 3);
                const compact = words.join(' ');
                if (!compact) return null;
                return (
                  <div className="pantheon-card-subtitle">{`God of ${compact}`}</div>
                );
              })()}
            </button>
          );
        })}
        {!loading && items.length === 0 && (
          <div className="muted">No gods found in this folder.</div>
        )}
      </section>

      {modalOpen && (
        <div
          className="lightbox"
          onClick={() => {
            setModalOpen(false);
          }}
        >
          <div
            className="lightbox-panel"
            onClick={(e) => e.stopPropagation()}
          >
            {selected ? (
              <>
                <header className="inbox-reader-header">
                  <h2 className="inbox-reader-title">{
                    (() => {
                      const base = selected.title || selected.name || '';
                      const sub = extractGodSubtitle(activeContent);
                      return sub ? `${base} — God of ${sub.replace(/^God\s+of\s+/i,'')}` : base;
                    })()
                  }</h2>
                  <div className="inbox-reader-meta"><span>{selected.name}</span><span>·</span><time>{formatDate(selected.modified_ms)}</time>{(() => { const sub = extractGodSubtitle(activeContent); return sub ? (<><span>·</span><span>God of {sub.replace(/^God\s+of\s+/i, "")}</span></>) : null; })()}</div>
                </header>
                <div className="inbox-reader-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      if (!selected?.path) return;
                      const ok = confirm(`Delete God file?\n\n${selected.path}`);
                      if (!ok) return;
                      try {
                        await deleteInbox(selected.path);
                        setModalOpen(false);
                        setActivePath('');
                        await fetchItems();
                      } catch (err) {
                        alert(err?.message || String(err));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
                <article className="inbox-reader-body">
                  {renderMarkdown(activeContent || 'Loading…')}
                </article>
              </>
            ) : (
              <div className="muted">Loading…</div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="lightbox"
          onClick={() => {
            if (!creating) dismissCreateModal();
          }}
        >
          <div
            className="lightbox-panel monster-create-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>New God</h2>
            <form className="monster-create-form" onSubmit={handleCreateSubmit}>
              <label htmlFor="god-name">
                God Name
                <input
                  id="god-name"
                  type="text"
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    if (createError) setCreateError('');
                  }}
                  disabled={creating}
                  autoFocus
                />
              </label>
              {createError && <div className="error">{createError}</div>}
              <div className="monster-create-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (!creating) dismissCreateModal();
                  }}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}









