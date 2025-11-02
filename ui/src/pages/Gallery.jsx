import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { listDir } from '../api/dir.js';
import { openPath } from '../api/files.js';
import { fileSrc } from '../lib/paths.js';
import './Gallery.css';

const DEFAULT_GALLERY_ROOT = 'assets/gallery';
const LORA_EXAMPLES_SUBDIRECTORY = 'assets/images/lora_examples';

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

function normalizeForComparison(value) {
  return value.replace(/\\/g, '/');
}

function deriveAdditionalRoots(primaryRoot) {
  if (typeof primaryRoot !== 'string' || !primaryRoot.trim()) {
    return [LORA_EXAMPLES_SUBDIRECTORY];
  }
  const trimmed = primaryRoot.trim();
  const usesBackslash = trimmed.includes('\\');
  const normalized = normalizeForComparison(trimmed).replace(/\/+$/, '');
  const lower = normalized.toLowerCase();
  let assetsPrefix = '';

  if (lower.endsWith('/gallery')) {
    assetsPrefix = normalized.slice(0, normalized.length - '/gallery'.length);
  } else {
    const suffix = '/assets/gallery';
    const idx = lower.lastIndexOf(suffix);
    if (idx >= 0) {
      assetsPrefix = normalized.slice(0, idx + '/assets'.length);
    }
  }

  if (!assetsPrefix) {
    const fallback = usesBackslash
      ? LORA_EXAMPLES_SUBDIRECTORY.replace(/\//g, '\\')
      : LORA_EXAMPLES_SUBDIRECTORY;
    return [fallback];
  }

  const candidateNormalized = `${assetsPrefix}/images/lora_examples`;
  const candidate = usesBackslash
    ? candidateNormalized.replace(/\//g, '\\')
    : candidateNormalized;
  return [candidate];
}

function relativeGalleryPath(path, roots) {
  if (typeof path !== 'string' || !path) return '';

  const rootList = Array.isArray(roots)
    ? roots.filter((value) => typeof value === 'string' && value.trim())
    : typeof roots === 'string' && roots.trim()
      ? [roots]
      : [];

  const normalizedPath = normalizeForComparison(path);
  const lowerPath = normalizedPath.toLowerCase();
  let bestMatch = '';
  let bestLength = -1;

  for (const root of rootList) {
    const normalizedRoot = normalizeForComparison(root).replace(/\/+$/, '');
    if (!normalizedRoot) continue;
    const lowerRoot = normalizedRoot.toLowerCase();
    const idx = lowerPath.indexOf(lowerRoot);
    if (idx >= 0) {
      const relative = normalizedPath.slice(idx + normalizedRoot.length).replace(/^\/+/, '');
      const candidate = relative || normalizedPath.slice(idx);
      if (normalizedRoot.length > bestLength && candidate != null) {
        bestLength = normalizedRoot.length;
        bestMatch = candidate;
      }
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  const lowered = path.toLowerCase();
  const idx = lowered.lastIndexOf('assets\\gallery');
  if (idx >= 0) {
    return path.slice(idx);
  }
  const altIdx = lowered.lastIndexOf('assets/gallery');
  if (altIdx >= 0) {
    return path.slice(altIdx);
  }
  const loraIdx = lowered.lastIndexOf('assets\\images\\lora_examples');
  if (loraIdx >= 0) {
    return path.slice(loraIdx);
  }
  const loraAltIdx = lowered.lastIndexOf('assets/images/lora_examples');
  if (loraAltIdx >= 0) {
    return path.slice(loraAltIdx);
  }
  return path;
}

export default function Gallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [galleryRoot, setGalleryRoot] = useState(DEFAULT_GALLERY_ROOT);
  const [extraRoots, setExtraRoots] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');

  const displayRoots = useMemo(() => {
    const seen = new Set();
    const list = [];
    const push = (root) => {
      if (typeof root !== 'string' || !root.trim()) return;
      const normalized = normalizeForComparison(root).toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      list.push(root.trim());
    };
    push(galleryRoot || DEFAULT_GALLERY_ROOT);
    for (const root of extraRoots) {
      push(root);
    }
    return list;
  }, [galleryRoot, extraRoots]);

  const formattedSourceNodes = useMemo(() => {
    if (!displayRoots.length) return null;
    return displayRoots.map((root, index) => {
      const isLast = index === displayRoots.length - 1;
      const isSecondLast = index === displayRoots.length - 2;
      const separator = isLast ? '' : isSecondLast ? ' and ' : ', ';
      return (
        <span key={`${root}-${index}`}>
          <code>{root}</code>
          {separator}
        </span>
      );
    });
  }, [displayRoots]);

  const dropTargetText = useMemo(() => {
    if (!displayRoots.length) {
      return DEFAULT_GALLERY_ROOT;
    }
    if (displayRoots.length === 1) {
      return displayRoots[0];
    }
    if (displayRoots.length === 2) {
      return `${displayRoots[0]} or ${displayRoots[1]}`;
    }
    const leading = displayRoots.slice(0, -1).join(', ');
    return `${leading}, or ${displayRoots[displayRoots.length - 1]}`;
  }, [displayRoots]);

  const loadGallery = useCallback(
    async ({ signal, rootOverride } = {}) => {
      const targetRoot =
        typeof rootOverride === 'string' && rootOverride
          ? rootOverride
          : galleryRoot || DEFAULT_GALLERY_ROOT;
      setLoading(true);
      try {
        const normalizedPrimary = normalizeForComparison(targetRoot).toLowerCase();
        const candidateExtras = deriveAdditionalRoots(targetRoot).filter((root) => {
          if (typeof root !== 'string' || !root.trim()) return false;
          return normalizeForComparison(root).toLowerCase() !== normalizedPrimary;
        });
        const rootsToScan = [targetRoot, ...candidateExtras];
        const aggregatedByPath = new Map();
        const discoveredExtras = [];
        const seenExtraKeys = new Set();

        for (const root of rootsToScan) {
          if (signal?.aborted) break;
          try {
            const entries = await enumerateGallery(root, signal);
            if (signal?.aborted) return;
            if (root !== targetRoot) {
              const key = normalizeForComparison(root).toLowerCase();
              if (!seenExtraKeys.has(key)) {
                seenExtraKeys.add(key);
                discoveredExtras.push(root);
              }
            }
            for (const entry of entries) {
              const key = normalizeForComparison(entry.path).toLowerCase();
              const next = { ...entry, originRoot: root };
              const existing = aggregatedByPath.get(key);
              if (
                !existing ||
                (typeof next.modifiedMs === 'number' &&
                  next.modifiedMs > (existing.modifiedMs ?? Number.NEGATIVE_INFINITY))
              ) {
                aggregatedByPath.set(key, next);
              }
            }
          } catch (innerError) {
            if (signal?.aborted) return;
            if (root === targetRoot) {
              throw innerError;
            } else {
              // Swallow missing optional directories (e.g., lora_examples not yet created)
              console.warn(`Gallery: unable to scan optional directory ${root}`, innerError);
            }
          }
        }

        if (signal?.aborted) return;

        setExtraRoots(discoveredExtras);

        const files = Array.from(aggregatedByPath.values());
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
        setExtraRoots([]);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [galleryRoot],
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
        let resolvedRoot = DEFAULT_GALLERY_ROOT;
        try {
          const root = await invoke('gallery_root_path');
          if (!signal.aborted && typeof root === 'string' && root.trim()) {
            resolvedRoot = root.trim();
            setGalleryRoot(resolvedRoot);
          }
        } catch (invokeError) {
          if (!signal.aborted) {
            setGalleryRoot(DEFAULT_GALLERY_ROOT);
            console.warn('Failed to resolve gallery root:', invokeError);
          }
        }
        await loadGallery({ signal, rootOverride: resolvedRoot });
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
            Everything saved under{' '}
            {formattedSourceNodes || <code>{galleryRoot}</code>} is collected here.
            Use it to keep renders, exports, and captures in one place.
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
              ? `Drop images, audio, or video into ${dropTargetText} to see them here.`
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
                    <p className="card-caption gallery-path">
                      {relativeGalleryPath(item.path, [item.originRoot, ...displayRoots])}
                    </p>
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
