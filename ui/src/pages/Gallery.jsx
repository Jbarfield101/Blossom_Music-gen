import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { listDir } from '../api/dir.js';
import { openPath } from '../api/files.js';
import { fileSrc } from '../lib/paths.js';
import './Gallery.css';

const GALLERY_ROOT = 'assets/gallery';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']);
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function extensionForPath(path) {
  if (typeof path !== 'string') return '';
  const match = /\.([^.\\/>]+)$/.exec(path.toLowerCase());
  return match ? match[1] : '';
}

function classifyPath(path) {
  const ext = extensionForPath(path);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function fallbackName(path) {
  if (typeof path !== 'string' || !path) return 'Untitled';
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatModified(modifiedMs) {
  if (typeof modifiedMs !== 'number' || !Number.isFinite(modifiedMs) || modifiedMs <= 0) {
    return '';
  }
  try {
    return dateFormatter.format(new Date(modifiedMs));
  } catch {
    return '';
  }
}

async function enumerateGallery(root, signal) {
  const results = [];
  const stack = [root];
  const seen = new Set();

  while (stack.length > 0) {
    if (signal?.aborted) break;
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    let entries;
    try {
      entries = await listDir(current);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Unable to read ${current}: ${message}`);
    }
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (signal?.aborted) break;
      const entryPath = typeof entry?.path === 'string' ? entry.path : '';
      if (!entryPath) continue;

      if (entry?.is_dir) {
        stack.push(entryPath);
        continue;
      }

      const type = classifyPath(entryPath);
      if (!type) continue;

      const name =
        (typeof entry?.name === 'string' && entry.name) || fallbackName(entryPath);
      const modified =
        typeof entry?.modified_ms === 'number'
          ? entry.modified_ms
          : typeof entry?.modifiedMs === 'number'
            ? entry.modifiedMs
            : 0;
      const size = typeof entry?.size === 'number' ? entry.size : null;

      results.push({
        type,
        name,
        path: entryPath,
        modifiedMs: modified,
        size,
      });
    }
  }

  return results;
}

function relativeGalleryPath(path) {
  if (typeof path !== 'string') return '';
  const lowered = path.toLowerCase();
  const idx = lowered.lastIndexOf('assets\\gallery');
  if (idx >= 0) {
    return path.slice(idx);
  }
  const altIdx = lowered.lastIndexOf('assets/gallery');
  if (altIdx >= 0) {
    return path.slice(altIdx);
  }
  return path;
}

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

  const loadGallery = useCallback(
    async ({ signal } = {}) => {
      setLoading(true);
      try {
        const files = await enumerateGallery(GALLERY_ROOT, signal);
        if (signal?.aborted) return;
        files.sort((a, b) => {
          const left = typeof b.modifiedMs === 'number' ? b.modifiedMs : 0;
          const right = typeof a.modifiedMs === 'number' ? a.modifiedMs : 0;
          return left - right;
        });
        setItems(files);
        setError('');
      } catch (err) {
        if (signal?.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setItems([]);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const signal = { aborted: false };
    (async () => {
      try {
        const tauri = await isTauri();
        if (signal.aborted) return;
        setIsTauriEnv(tauri);
        if (!tauri) {
          setError('Gallery is available in the desktop shell.');
          setLoading(false);
          return;
        }
        await loadGallery({ signal });
      } catch (err) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
      }
    })();
    return () => {
      signal.aborted = true;
    };
  }, [loadGallery]);

  const handleRefresh = useCallback(() => {
    if (!isTauriEnv) return;
    loadGallery();
  }, [isTauriEnv, loadGallery]);

  const counts = useMemo(() => {
    const tally = { all: items.length, image: 0, audio: 0, video: 0 };
    for (const item of items) {
      if (item.type === 'image' || item.type === 'audio' || item.type === 'video') {
        tally[item.type] += 1;
      }
    }
    return tally;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    return items.filter((item) => item.type === activeFilter);
  }, [items, activeFilter]);

  return (
    <div className="gallery-page">
      <BackButton to="/" label="Back to Dashboard" />
      <header className="gallery-header">
        <div>
          <h1>Gallery</h1>
          <p className="card-caption">
            Everything saved under <code>{GALLERY_ROOT}</code> is collected here. Use it to
            keep renders, exports, and captures in one place.
          </p>
        </div>
        <div className="gallery-actions">
          <PrimaryButton
            type="button"
            onClick={handleRefresh}
            disabled={!isTauriEnv}
            loading={loading && isTauriEnv}
            loadingText="Refreshing..."
          >
            Refresh
          </PrimaryButton>
        </div>
      </header>

      {error && (
        <section className="card gallery-status" role="alert">
          <p className="card-caption" style={{ color: 'var(--accent)' }}>
            {error}
          </p>
        </section>
      )}

      <section className="card gallery-status">
        <div className="gallery-filters" role="tablist" aria-label="Media Type">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={activeFilter === value}
              className={`gallery-filter-button${
                activeFilter === value ? ' active' : ''
              }`}
              onClick={() => setActiveFilter(value)}
            >
              {label}
              <span className="gallery-filter-count">{counts[value] ?? 0}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card gallery-content">
        {loading ? (
          <p className="card-caption">Loading gallery...</p>
        ) : filteredItems.length === 0 ? (
          <p className="card-caption">
            {activeFilter === 'all'
              ? 'Drop images, audio, or video into assets/gallery to see them here.'
              : `No ${activeFilter} assets yet. Render or export something to populate this tab.`}
          </p>
        ) : (
          <div className="gallery-grid" role="list">
            {filteredItems.map((item) => {
              const src = fileSrc(item.path);
              const modifiedText = formatModified(item.modifiedMs);
              const sizeText = formatBytes(item.size);
              const metaParts = [];
              if (modifiedText) metaParts.push(`Updated ${modifiedText}`);
              if (sizeText) metaParts.push(sizeText);

              return (
                <article
                  key={item.path}
                  className={`gallery-card ${item.type}`}
                  role="listitem"
                >
                  {item.type === 'image' ? (
                    <img src={src} alt={item.name} className="gallery-thumb" />
                  ) : item.type === 'audio' ? (
                    <audio
                      className="gallery-media"
                      controls
                      preload="metadata"
                      src={src}
                    >
                      <track kind="captions" />
                    </audio>
                  ) : (
                    <video
                      className="gallery-media"
                      controls
                      preload="metadata"
                      src={src}
                    />
                  )}
                  <div className="gallery-card-body">
                    <h2 className="gallery-title">{item.name}</h2>
                    {metaParts.length > 0 && (
                      <p className="card-caption">{metaParts.join(' • ')}</p>
                    )}
                    <p className="card-caption gallery-path">{relativeGalleryPath(item.path)}</p>
                  </div>
                  <div className="gallery-card-actions">
                    <button
                      type="button"
                      className="gallery-open"
                      onClick={() => openPath(item.path)}
                    >
                      Open in Explorer
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
