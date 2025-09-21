import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import { getConfig } from '../api/config';
import { listDir } from '../api/dir';
import { readFileBytes, openPath } from '../api/files';
import './Dnd.css';

const DEFAULT_ASSETS = 'D\\\\Documents\\\\DreadHaven\\\\30_Assets'.replace(/\\\\/g, '\\\\');
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function joinPath(base, seg) {
  if (!base) return seg;
  if (/\\$/.test(base)) return `${base}${seg}`;
  return `${base}\\${seg}`;
}

export default function DndAssets() {
  const [basePath, setBasePath] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState({ open: false, url: '', name: '' });
  const [previews, setPreviews] = useState({});
  const urlsRef = useRef(new Map());

  // Cleanup blob URLs
  useEffect(() => () => {
    for (const url of urlsRef.current.values()) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    urlsRef.current.clear();
  }, []);

  const initBase = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const vault = await getConfig('vaultPath');
      const base = (typeof vault === 'string' && vault)
        ? `${vault}\\\\30_Assets`.replace(/\\\\/g, '\\\\')
        : DEFAULT_ASSETS;
      setBasePath(base);
      setCurrentPath(base);
    } catch (e) {
      setBasePath(DEFAULT_ASSETS);
      setCurrentPath(DEFAULT_ASSETS);
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
      // Reset previews when changing folder
      setPreviews({});
      for (const url of urlsRef.current.values()) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      urlsRef.current.clear();
    } catch (e) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load previews for images in the folder
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const imgItems = items.filter((it) => !it.is_dir && IMG_RE.test(it.name));
      for (const it of imgItems) {
        try {
          const bytes = await readFileBytes(it.path);
          const arr = new Uint8Array(bytes);
          // Infer mime from extension
          const ext = it.name.split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png'
            : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : ext === 'bmp' ? 'image/bmp'
            : ext === 'svg' ? 'image/svg+xml'
            : 'application/octet-stream';
          const blob = new Blob([arr], { type: mime });
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urlsRef.current.set(it.path, url);
          setPreviews((prev) => ({ ...prev, [it.path]: url }));
        } catch (e) {
          // ignore failures
        }
      }
    };
    if (items.length) load();
    return () => { cancelled = true; };
  }, [items]);

  useEffect(() => { initBase(); }, [initBase]);
  useEffect(() => { if (currentPath) fetchList(currentPath); }, [currentPath, fetchList]);

  const crumbs = useMemo(() => {
    if (!basePath || !currentPath) return [];
    const base = basePath.replace(/\\+$/,'');
    const rel = currentPath.startsWith(base) ? currentPath.slice(base.length).replace(/^\\+/, '') : '';
    const segs = rel ? rel.split('\\') : [];
    const acc = [base];
    const out = [{ label: 'Assets', path: base }];
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
      <h1>Dungeons & Dragons · Assets</h1>
      <div className="assets-controls">
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
      <div className="assets-grid">
        {items.map((it) => {
          const isImg = !it.is_dir && IMG_RE.test(it.name);
          if (it.is_dir) {
            return (
              <button key={it.path} className="asset-card folder" onClick={() => setCurrentPath(it.path)} title={it.path}>
                <Icon name="Folder" size={28} className="asset-icon" />
                <div className="asset-name">{it.name}</div>
              </button>
            );
          }
          if (isImg) {
            const url = previews[it.path];
            return (
              <button key={it.path} className="asset-card image" onClick={() => url && setLightbox({ open: true, url, name: it.name })} title={it.path}>
                {url ? (
                  <img src={url} alt={it.name} className="asset-thumb" />
                ) : (
                  <div className="asset-thumb placeholder" />
                )}
                <div className="asset-name">{it.name}</div>
              </button>
            );
          }
          return (
            <button key={it.path} className="asset-card file" onClick={() => openPath(it.path)} title={it.path}>
              <Icon name="File" size={24} className="asset-icon" />
              <div className="asset-name">{it.name}</div>
            </button>
          );
        })}
        {!loading && items.length === 0 && (
          <div className="muted">This folder is empty.</div>
        )}
      </div>

      {lightbox.open && (
        <div className="lightbox" onClick={() => setLightbox({ open: false, url: '', name: '' })}>
          <img src={lightbox.url} alt={lightbox.name} className="lightbox-img" />
        </div>
      )}
    </>
  );
}
