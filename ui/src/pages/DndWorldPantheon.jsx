import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig } from '../api/config';
import { listInbox, readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

const DEFAULT_PANTHEON = 'D:\\Documents\\DreadHaven\\10_World\\Gods of the Realm';

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

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getConfig('vaultPath');
      const base = (typeof vault === 'string' && vault) ? `${vault}\\10_World\\Gods of the Realm` : '';
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
  }, [fetchItems]);

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

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Pantheon</h1>
      <main className="dashboard dnd-detail-layout">
        <section className="dnd-surface">
          <div className="dnd-toolbar">
            <button type="button" onClick={fetchItems} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            {usingPath && <span className="muted">Folder: {usingPath}</span>}
            {error && <span className="error">{error}</span>}
          </div>
          <div className="dnd-card-collection">
            {items.map((item) => (
              <button
                type="button"
                key={item.path}
                className={`dnd-card-button${item.path === activePath ? ' is-active' : ''}`}
                onClick={() => setActivePath(item.path)}
                title={item.path}
              >
                <span className="dnd-card-button-title">{item.title || item.name}</span>
                <span className="dnd-card-button-meta">
                  <time title={formatDate(item.modified_ms)}>{formatRelative(item.modified_ms)}</time>
                </span>
              </button>
            ))}
            {!loading && items.length === 0 && (
              <div className="muted dnd-card-empty">No gods found in this folder.</div>
            )}
          </div>
        </section>
        <section className="dnd-reader">
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
                {/\.(md|mdx|markdown)$/i.test(selected.name || '') ? (
                  renderMarkdown(activeContent)
                ) : (
                  <pre className="inbox-reader-content">{activeContent}</pre>
                )}
              </article>
            </>
          ) : (
            <div className="muted">Select a god to view details.</div>
          )}
        </section>
      </main>
    </>
  );
}

