import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import { getDreadhavenRoot } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';
import { useVaultVersion } from '../lib/vaultEvents.jsx';

const DEFAULT_REGIONS = 'D:\\Documents\\DreadHaven\\10_World\\Regions';

function joinPath(base, seg) {
  if (!base) return seg;
  if (/\\$/.test(base)) return `${base}${seg}`;
  return `${base}\\${seg}`;
}

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
}

export default function DndWorldRegions() {
  const [basePath, setBasePath] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const regionsVersion = useVaultVersion(['10_world/regions']);

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
    if (!activePath) return;
    (async () => {
      try {
        const text = await readInbox(activePath);
        setActiveContent(text || '');
      } catch (e) {
        setActiveContent('Failed to load file.');
      }
    })();
  }, [activePath]);

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

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Regions</h1>
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
          {items.map((it) => (
            <button
              key={it.path}
              className={`regions-card${it.path === activePath ? ' active' : ''}`}
              onClick={() => it.is_dir ? setCurrentPath(it.path) : setActivePath(it.path)}
              title={it.path}
            >
              <div className="regions-card-head">
                <Icon name={it.is_dir ? 'Folder' : 'FileText'} size={24} className="regions-card-icon" />
                <div className="regions-card-title">{it.name.replace(/\.[^.]+$/, '')}</div>
              </div>
              {!it.is_dir && (
                <div className="regions-card-meta">
                  <time title={formatDate(it.modified_ms)}>{formatDate(it.modified_ms)}</time>
                </div>
              )}
            </button>
          ))}
          {!loading && items.length === 0 && (
            <div className="muted">This region is empty.</div>
          )}
        </section>
        <section className="regions-reader">
          {activePath ? (
            <article className="inbox-reader-body">
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

