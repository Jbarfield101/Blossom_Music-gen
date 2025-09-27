import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { loadEstablishments } from '../api/establishments';
import { listNpcs } from '../api/npcs';
import { readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

function formatRelative(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const now = Date.now();
  const diff = Math.max(0, now - value);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

export default function DndDmEstablishments() {
  const [items, setItems] = useState([]);
  const [usingPath, setUsingPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [npcOptions, setNpcOptions] = useState([]);
  const [repMap, setRepMap] = useState({});

  const fetchEstablishments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadEstablishments();
      const list = Array.isArray(result?.items) ? result.items : [];
      setUsingPath(result?.root || '');
      setItems(list);
      setActivePath((prev) => {
        if (prev && list.some((entry) => entry.path === prev)) {
          return prev;
        }
        setModalOpen(false);
        return '';
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || String(err));
      setItems([]);
      setUsingPath('');
      setActivePath('');
      setModalOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEstablishments();
  }, [fetchEstablishments]);

  // Load representative map from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('dnd.establishmentReps');
      if (raw) setRepMap(JSON.parse(raw) || {});
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activePath) {
      setActiveContent('');
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setActiveContent('');
    (async () => {
      try {
        const text = await readInbox(activePath);
        if (!cancelled) {
          setActiveContent(text || '');
          setPreviewLoading(false);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setActiveContent('Failed to load file.');
          setPreviewLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // Preload NPCs for representative selection
  useEffect(() => {
    (async () => {
      try {
        const list = await listNpcs();
        const opts = Array.isArray(list)
          ? list
              .map((n) => ({ value: n.name || '', label: n.name || '' }))
              .filter((o) => o.value)
          : [];
        opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        setNpcOptions(opts);
      } catch (err) {
        console.warn('Failed to load NPC list', err);
        setNpcOptions([]);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    if (!items.length) return [];
    const map = new Map();
    for (const item of items) {
      const key = Array.isArray(item.groupSegments) && item.groupSegments.length
        ? item.groupSegments.join('||')
        : '__ungrouped__';
      const label = (item.group && item.group.trim()) || 'Ungrouped';
      if (!map.has(key)) {
        map.set(key, { key, label, items: [] });
      }
      map.get(key).items.push(item);
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    for (const group of groups) {
      group.items.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
    }
    return groups;
  }, [items]);

  const selected = useMemo(
    () => items.find((entry) => entry.path === activePath) || null,
    [items, activePath],
  );

  const showGroupHeadings = grouped.length > 1 || grouped.some((group) => group.label !== 'Ungrouped');

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Establishments</h1>
      <div className="pantheon-controls">
        <button type="button" onClick={fetchEstablishments} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {usingPath && <span className="muted">Root: {usingPath}</span>}
        {error && <span className="error">{error}</span>}
      </div>
      <section className="pantheon-grid establishments-grid">
        {grouped.length > 0 ? (
          grouped.map((group) => (
            <Fragment key={group.key}>
              {(showGroupHeadings || group.label !== 'Ungrouped') && (
                <div className="establishments-grid-heading">{group.label}</div>
              )}
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.path}
                  className="pantheon-card establishment-card"
                  onClick={() => {
                    setActivePath(item.path);
                    setModalOpen(true);
                  }}
                  title={item.relative || item.path}
                >
                  <div className="establishment-card-head">
                    <div className="pantheon-card-title">{item.title || item.name}</div>
                    <time title={formatDate(item.modified_ms)}>{formatRelative(item.modified_ms)}</time>
                  </div>
                  {(item.relative || item.category) && (
                    <div className="establishment-meta">
                      {item.relative && <span className="establishment-meta-item">{item.relative}</span>}
                      {item.category && <span className="establishment-meta-item">{item.category}</span>}
                    </div>
                  )}
                  {(item.location || item.region) && (
                    <div className="establishment-tags">
                      {item.region && <span className="chip">Region: {item.region}</span>}
                      {item.location && <span className="chip">Town: {item.location}</span>}
                    </div>
                  )}
                </button>
              ))}
            </Fragment>
          ))
        ) : (
          <div className="muted">{loading ? 'Searching for establishments…' : 'No establishments found.'}</div>
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
            onClick={(event) => event.stopPropagation()}
          >
            {selected ? (
              <>
                <header className="inbox-reader-header establishment-header">
                  <h2 className="inbox-reader-title">{selected.title || selected.name}</h2>
                  <div className="inbox-reader-meta">
                    {selected.group && <span>{selected.group}</span>}
                    {selected.group && <span>·</span>}
                    <time title={formatDate(selected.modified_ms)}>{formatDate(selected.modified_ms)}</time>
                  </div>
                  {(selected.category || selected.location || selected.region) && (
                    <div className="establishment-tags">
                      {selected.region && <span className="chip">Region: {selected.region}</span>}
                      {selected.location && <span className="chip">Town: {selected.location}</span>}
                      {selected.category && <span className="chip">{selected.category}</span>}
                    </div>
                  )}
                </header>
                {previewLoading ? (
                  <div className="muted">Loading…</div>
                ) : (
                  <article className="inbox-reader-body">
                    <div className="dnd-surface" style={{ marginBottom: 'var(--space-md)' }}>
                      <div className="section-head">
                        <h3>Representative</h3>
                        <p className="muted">Attach an NPC who represents this location.</p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label>
                          <span>NPC</span>
                          <select
                            value={repMap[activePath] || ''}
                            onChange={(e) => {
                              const next = { ...repMap, [activePath]: e.target.value };
                              setRepMap(next);
                              try { localStorage.setItem('dnd.establishmentReps', JSON.stringify(next)); } catch {}
                            }}
                          >
                            <option value="">(none)</option>
                            {npcOptions.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </label>
                        {repMap[activePath] && (
                          <span className="muted">Linked: {repMap[activePath]}</span>
                        )}
                      </div>
                    </div>
                    {renderMarkdown(activeContent || '')}
                  </article>
                )}
              </>
            ) : (
              <div className="muted">Loading…</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
