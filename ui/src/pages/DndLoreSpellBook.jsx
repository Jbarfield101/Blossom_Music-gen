import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listInbox, readInbox } from '../api/inbox';
import { createSpell } from '../api/spells';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

const DEFAULT_SPELL_BOOK = 'D\\\\Documents\\\\DreadHaven\\\\10_World\\\\SpellBook';
const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
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

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export default function DndLoreSpellBook() {
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

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getConfig('vaultPath');
      const base = (typeof vault === 'string' && vault)
        ? `${vault}\\10_World\\SpellBook`
        : '';
      if (base) {
        const list = await listInbox(base);
        const filtered = Array.isArray(list)
          ? list.filter((item) => MARKDOWN_RE.test(item?.name || ''))
          : [];
        setUsingPath(base);
        setItems(filtered);
        if (filtered.length > 0 && !activePath) setActivePath(filtered[0].path);
        return;
      }
      throw new Error('no vault');
    } catch (e1) {
      try {
        const fallback = DEFAULT_SPELL_BOOK;
        const list = await listInbox(fallback);
        const filtered = Array.isArray(list)
          ? list.filter((item) => MARKDOWN_RE.test(item?.name || ''))
          : [];
        setUsingPath(fallback);
        setItems(filtered);
        if (filtered.length > 0 && !activePath) setActivePath(filtered[0].path);
      } catch (e2) {
        console.error(e2);
        setError(e2?.message || String(e2));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [activePath]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

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

  const selected = useMemo(() => items.find((i) => i.path === activePath), [items, activePath]);

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
      setCreateError('Please enter a spell name.');
      return;
    }
    try {
      setCreating(true);
      setCreateError('');
      const createdPath = await createSpell(name);
      dismissCreateModal();
      await fetchItems();
      if (createdPath) {
        setActivePath(createdPath);
        setModalOpen(true);
      }
    } catch (e) {
      setCreateError(e?.message || 'Failed to create spell.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Spell Book</h1>
      <div className="pantheon-controls">
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button type="button" onClick={openCreateModal} disabled={creating}>
          Add Spell
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
            <div className="pantheon-card-title">{item.title || item.name}</div>
            <div className="pantheon-card-meta">
              <time title={formatDate(item.modified_ms)}>{formatRelative(item.modified_ms)}</time>
              {item.size ? <span>&nbsp;·&nbsp;{formatSize(item.size)}</span> : null}
            </div>
            {item.preview && (
              <div
                className="pantheon-card-meta"
                style={{
                  fontSize: '0.8rem',
                  lineHeight: 1.35,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item.preview}
              </div>
            )}
          </button>
        ))}
        {!loading && items.length === 0 && (
          <div className="muted">No spells found in this folder.</div>
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
                    <time>{formatDate(selected.modified_ms)}</time>
                  </div>
                </header>
                <article className="inbox-reader-body">
                  {MARKDOWN_RE.test(selected.name || '') ? (
                    renderMarkdown(activeContent || 'Loading…')
                  ) : (
                    <pre className="inbox-reader-content">{activeContent || 'Loading…'}</pre>
                  )}
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
            <h2>New Spell</h2>
            <form className="monster-create-form" onSubmit={handleCreateSubmit}>
              <label htmlFor="spell-name">
                Spell Name
                <input
                  id="spell-name"
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
