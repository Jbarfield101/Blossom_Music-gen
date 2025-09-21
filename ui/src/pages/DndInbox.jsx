import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { listInbox, readInbox } from '../api/inbox';
import './Dnd.css';
import { renderMarkdown } from '../lib/markdown.jsx';

const DEFAULT_INBOX = 'D:\\Documents\\DreadHaven\\00_Inbox';

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

export default function DndInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [formatMarkdown, setFormatMarkdown] = useState(true);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Try with default (vault + 00_Inbox)
      let list = await listInbox();
      setUsingPath('(vault)/00_Inbox');
      setItems(Array.isArray(list) ? list : []);
      if (list && list.length > 0 && !activePath) {
        setActivePath(list[0].path);
      }
    } catch (e1) {
      try {
        const list = await listInbox(DEFAULT_INBOX);
        setUsingPath(DEFAULT_INBOX);
        setItems(Array.isArray(list) ? list : []);
        if (list && list.length > 0 && !activePath) {
          setActivePath(list[0].path);
        }
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

  const selected = useMemo(
    () => items.find((i) => i.path === activePath),
    [items, activePath]
  );

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Inbox</h1>
      <div className="inbox-controls">
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {usingPath && (
          <span className="muted">Folder: {usingPath}</span>
        )}
        {error && <span className="error">{error}</span>}
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={formatMarkdown}
            onChange={(e) => setFormatMarkdown(e.target.checked)}
          />
          Format Markdown
        </label>
      </div>
      <div className="inbox">
        <aside className="inbox-list" role="listbox" aria-label="Inbox">
          {items.map((item) => (
            <button
              key={item.path}
              className={`inbox-item${item.path === activePath ? ' active' : ''}`}
              onClick={() => setActivePath(item.path)}
              title={item.path}
            >
              <div className="inbox-item-head">
                <div className="inbox-item-title">{item.title || item.name}</div>
                <time className="inbox-item-date" title={formatDate(item.modified_ms)}>
                  {formatRelative(item.modified_ms)}
                </time>
              </div>
            </button>
          ))}
          {!loading && items.length === 0 && (
            <div className="muted">No files found in this folder.</div>
          )}
        </aside>
        <section className="inbox-reader">
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
                  (formatMarkdown ? renderMarkdown(activeContent) : (
                    <pre className="inbox-reader-content">{activeContent}</pre>
                  ))
                ) : (
                  <pre className="inbox-reader-content">{activeContent}</pre>
                )}
              </article>
            </>
          ) : (
            <div className="muted">Select a file to read.</div>
          )}
        </section>
      </div>
    </>
  );
}
