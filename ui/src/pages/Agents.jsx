import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  writeFile as writeBinaryFile,
  remove,
} from '@tauri-apps/plugin-fs';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import Icon from '../components/Icon.jsx';
import { listDir } from '../api/dir.js';
import { fileSrc } from '../lib/paths.js';
import './Agents.css';

const AGENTS_DIRECTORY = 'assets/agents';
const AGENT_IMAGES_DIRECTORY = `${AGENTS_DIRECTORY}/images`;
const THUMBNAIL_MANIFEST_PATH = `${AGENTS_DIRECTORY}/thumbnails.json`;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function sanitizeSlug(value, fallback = 'agent') {
  const base = typeof value === 'string' ? value : String(value || '');
  const normalized = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return normalized || fallback;
}

function fallbackNameFromPath(path) {
  if (typeof path !== 'string' || !path) return 'agent.md';
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] || 'agent.md';
}

function toTitleCase(value) {
  const base = typeof value === 'string' ? value : String(value || '');
  const cleaned = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled Agent';
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractFirstHeading(markdown) {
  if (typeof markdown !== 'string') return '';
  const match = /^#{1,6}[ \t]+(.+?)\s*$/m.exec(markdown);
  return match ? match[1].trim() : '';
}

function deriveTitle(markdown, fallbackValue) {
  const heading = extractFirstHeading(markdown);
  if (heading) return heading;
  return toTitleCase(fallbackValue);
}

function countHeadings(markdown) {
  if (typeof markdown !== 'string' || !markdown) return 0;
  const matches = markdown.match(/^#{1,6}[ \t]+/gm);
  return matches ? matches.length : 0;
}

function countWords(markdown) {
  if (typeof markdown !== 'string') return 0;
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  const words = trimmed.match(/\S+/g);
  return words ? words.length : 0;
}

function countLines(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return 0;
  return markdown.split(/\r?\n/).length;
}

function formatModified(modifiedMs) {
  const value = Number(modifiedMs);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return dateFormatter.format(new Date(value));
  } catch (error) {
    console.warn('Agents: failed to format modified timestamp', error);
    return '';
  }
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let remaining = value;
  let unitIndex = 0;
  while (remaining >= 1024 && unitIndex < units.length - 1) {
    remaining /= 1024;
    unitIndex += 1;
  }
  const decimals = remaining >= 10 || unitIndex === 0 ? 0 : 1;
  return `${remaining.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

function extractModifiedMs(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const candidates = [
    entry.modified_ms,
    entry.modifiedMs,
    entry.mtime_ms,
    entry.mtimeMs,
    entry.modified,
    entry.mtime,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

async function ensureDirectoryExists(path) {
  if (!path) return;
  try {
    const alreadyExists = await exists(path);
    if (!alreadyExists) {
      await mkdir(path, { recursive: true });
    }
  } catch (error) {
    console.warn('Agents: unable to ensure directory', path, error);
  }
}

async function readThumbnailManifest() {
  try {
    const raw = await readTextFile(THUMBNAIL_MANIFEST_PATH);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' || !value) continue;
      const slug = sanitizeSlug(key);
      if (!slug) continue;
      normalized[slug] = value;
    }
    return normalized;
  } catch (error) {
    if (error && error.code !== 'NotFound') {
      console.warn('Agents: unable to read thumbnail manifest', error);
    }
    return {};
  }
}

async function writeThumbnailManifest(manifest) {
  const payload = JSON.stringify(manifest, null, 2);
  await ensureDirectoryExists(AGENTS_DIRECTORY);
  await writeTextFile(THUMBNAIL_MANIFEST_PATH, payload);
}

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [thumbnails, setThumbnails] = useState({});
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);
  const [isRemovingImage, setIsRemovingImage] = useState(false);

  const newAgentInputRef = useRef(null);
  const thumbnailInputRef = useRef(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.slug === selectedSlug) || null,
    [agents, selectedSlug],
  );

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      await ensureDirectoryExists(AGENTS_DIRECTORY);
      await ensureDirectoryExists(AGENT_IMAGES_DIRECTORY);
      const manifest = await readThumbnailManifest();
      setThumbnails(manifest);

      let entries = [];
      try {
        const result = await listDir(AGENTS_DIRECTORY);
        if (Array.isArray(result)) {
          entries = result;
        }
      } catch (listingError) {
        throw new Error(listingError?.message || 'Unable to list agent files.');
      }

      const markdownEntries = entries.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const isDirectory = entry.is_dir === true || entry.isDir === true;
        if (isDirectory) return false;
        const name = typeof entry.name === 'string' ? entry.name : '';
        if (name && /^thumbnails\.json$/i.test(name)) return false;
        const candidate = name || (typeof entry.path === 'string' ? entry.path : '');
        return /\.md$/i.test(candidate);
      });

      const slugSet = new Set();
      const agentRecords = await Promise.all(
        markdownEntries.map(async (entry) => {
          const path =
            typeof entry.path === 'string' && entry.path
              ? entry.path
              : `${AGENTS_DIRECTORY}/${typeof entry.name === 'string' ? entry.name : ''}`;
          const fileName =
            (typeof entry.name === 'string' && entry.name) || fallbackNameFromPath(path);
          const baseName = fileName.replace(/\.md$/i, '');
          const baseSlug = sanitizeSlug(baseName, 'agent');
          let slug = baseSlug;
          let suffix = 2;
          while (slugSet.has(slug)) {
            slug = `${baseSlug}-${suffix}`;
            suffix += 1;
          }
          slugSet.add(slug);

          let markdown = '';
          try {
            markdown = await readTextFile(path);
          } catch (readError) {
            console.warn('Agents: unable to read markdown for', path, readError);
          }

          const headingCount = countHeadings(markdown);
          const wordCount = countWords(markdown);
          const lineCount = countLines(markdown);
          const charCount = typeof markdown === 'string' ? markdown.length : 0;
          const title = deriveTitle(markdown, baseName || slug);
          const imagePath = manifest[slug] || manifest[baseSlug] || '';
          const sizeSource =
            entry && typeof entry === 'object'
              ? entry.size ?? entry.length ?? entry.metadata?.size ?? entry.metadata?.length ?? entry.stat?.size
              : null;
          const sizeNumber = Number(sizeSource);
          const size = Number.isFinite(sizeNumber) && sizeNumber > 0 ? sizeNumber : null;
          const modifiedMs = extractModifiedMs(entry);

          return {
            slug,
            baseSlug,
            title,
            path,
            fileName,
            wordCount,
            headingCount,
            lineCount,
            charCount,
            size,
            modifiedMs,
            imagePath,
          };
        }),
      );

      agentRecords.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));

      setAgents(agentRecords);
      setSelectedSlug((prev) => {
        if (prev && agentRecords.some((agent) => agent.slug === prev)) {
          return prev;
        }
        return agentRecords[0]?.slug ?? null;
      });
    } catch (loadingError) {
      console.error('Agents: failed to load agents', loadingError);
      setAgents([]);
      setThumbnails({});
      setSelectedSlug(null);
      setError(loadingError?.message || 'Failed to load agents.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleNewAgentClick = useCallback(() => {
    if (newAgentInputRef.current) {
      newAgentInputRef.current.click();
    }
  }, []);

  const handleThumbnailClick = useCallback(() => {
    if (selectedAgent && thumbnailInputRef.current) {
      thumbnailInputRef.current.click();
    }
  }, [selectedAgent]);

  const handleNewAgentFileChange = useCallback(
    async (event) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (input) {
        input.value = '';
      }
      if (!file) {
        return;
      }
      if (typeof file.name === 'string' && !/\.md$/i.test(file.name)) {
        setError('Please choose a Markdown (.md) file.');
        return;
      }

      setIsCreating(true);
      setError('');
      try {
        await ensureDirectoryExists(AGENTS_DIRECTORY);
        const content = await file.text();
        const baseName = (typeof file.name === 'string' ? file.name : 'agent.md').replace(/\.md$/i, '');
        const baseSlug = sanitizeSlug(baseName, 'agent');
        let candidate = baseSlug;
        let suffix = 2;
        const existingSlugs = new Set(agents.map((agent) => agent.slug));
        while (existingSlugs.has(candidate)) {
          candidate = `${baseSlug}-${suffix}`;
          suffix += 1;
        }
        while (await exists(`${AGENTS_DIRECTORY}/${candidate}.md`).catch(() => false)) {
          candidate = `${baseSlug}-${suffix}`;
          suffix += 1;
        }

        await writeTextFile(`${AGENTS_DIRECTORY}/${candidate}.md`, content);
        setSelectedSlug(candidate);
        await loadAgents();
      } catch (creationError) {
        console.error('Agents: failed to create agent', creationError);
        setError(creationError?.message || 'Failed to create agent.');
      } finally {
        setIsCreating(false);
      }
    },
    [agents, loadAgents],
  );

  const handleThumbnailFileChange = useCallback(
    async (event) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (input) {
        input.value = '';
      }
      if (!file || !selectedAgent) {
        return;
      }

      setIsUpdatingImage(true);
      setError('');
      try {
        await ensureDirectoryExists(AGENT_IMAGES_DIRECTORY);
        const slug = selectedAgent.slug || selectedAgent.baseSlug || sanitizeSlug(selectedAgent.fileName, 'agent');
        const match = typeof file.name === 'string' ? file.name.match(/\.([A-Za-z0-9]+)$/) : null;
        const extension = match ? `.${match[1].toLowerCase()}` : '.png';
        const safeExtension = extension.length > 1 && extension.length <= 8 ? extension : '.png';
        const targetPath = `${AGENT_IMAGES_DIRECTORY}/${slug}${safeExtension}`;
        const previousPath = thumbnails[slug];
        if (previousPath && previousPath !== targetPath) {
          try {
            await remove(previousPath);
          } catch (removalError) {
            console.warn('Agents: unable to remove previous thumbnail', removalError);
          }
        }

        const buffer = await file.arrayBuffer();
        await writeBinaryFile(targetPath, new Uint8Array(buffer));
        const updatedManifest = { ...thumbnails, [slug]: targetPath };
        await writeThumbnailManifest(updatedManifest);
        setThumbnails(updatedManifest);
        setSelectedSlug(slug);
        await loadAgents();
      } catch (thumbnailError) {
        console.error('Agents: failed to update thumbnail', thumbnailError);
        setError(thumbnailError?.message || 'Failed to update thumbnail.');
      } finally {
        setIsUpdatingImage(false);
      }
    },
    [selectedAgent, thumbnails, loadAgents],
  );

  const handleRemoveThumbnail = useCallback(async () => {
    if (!selectedAgent) return;
    const slug = selectedAgent.slug;
    const currentPath = thumbnails[slug];

    setIsRemovingImage(true);
    setError('');
    try {
      if (currentPath) {
        try {
          await remove(currentPath);
        } catch (removalError) {
          console.warn('Agents: unable to delete thumbnail', removalError);
        }
      }
      const updatedManifest = { ...thumbnails };
      delete updatedManifest[slug];
      await writeThumbnailManifest(updatedManifest);
      setThumbnails(updatedManifest);
      setSelectedSlug(slug);
      await loadAgents();
    } catch (removalError) {
      console.error('Agents: failed to remove thumbnail', removalError);
      setError(removalError?.message || 'Failed to remove thumbnail.');
    } finally {
      setIsRemovingImage(false);
    }
  }, [selectedAgent, thumbnails, loadAgents]);

  return (
    <div className="agents-page">
      <BackButton />
      <header className="agents-header">
        <div className="agents-header__text">
          <h1>Agents</h1>
          <p>Manage Markdown-driven agent definitions, thumbnails, and metadata.</p>
        </div>
        <div className="agents-actions">
          <PrimaryButton onClick={handleNewAgentClick} loading={isCreating} loadingText="Saving…">
            New Agent
          </PrimaryButton>
          <input
            ref={newAgentInputRef}
            type="file"
            accept=".md,text/markdown"
            onChange={handleNewAgentFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </header>

      {error ? <div className="agents-error">{error}</div> : null}

      <div className="agents-layout">
        <section className="agents-collection">
          {isLoading ? (
            <div className="agents-loading">Loading agents…</div>
          ) : agents.length === 0 ? (
            <div className="agents-empty">Upload a Markdown file to create your first agent.</div>
          ) : (
            <div className="agents-grid">
              {agents.map((agent) => {
                const isSelected = agent.slug === selectedSlug;
                const thumbSrc = agent.imagePath ? fileSrc(agent.imagePath) : '';
                const placeholderInitial = agent.title?.trim()?.charAt(0)?.toUpperCase() || '#';
                return (
                  <button
                    key={agent.slug}
                    type="button"
                    className={`card agent-card${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelectedSlug(agent.slug)}
                    aria-pressed={isSelected ? 'true' : 'false'}
                  >
                    <div className="agent-card__header">
                      <div className="agent-card__thumb">
                        {thumbSrc ? (
                          <img src={thumbSrc} alt={`${agent.title} thumbnail`} />
                        ) : (
                          <span className="agent-card__thumb-placeholder">{placeholderInitial}</span>
                        )}
                      </div>
                      <div className="agent-card__meta">
                        <h2>{agent.title}</h2>
                        <p className="agent-card__slug">{agent.fileName}</p>
                      </div>
                    </div>
                    <dl className="agent-card__stats">
                      <div>
                        <dt>Words</dt>
                        <dd>{formatCount(agent.wordCount)}</dd>
                      </div>
                      <div>
                        <dt>Headings</dt>
                        <dd>{formatCount(agent.headingCount)}</dd>
                      </div>
                      <div>
                        <dt>Lines</dt>
                        <dd>{formatCount(agent.lineCount)}</dd>
                      </div>
                    </dl>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="card agents-details">
          {selectedAgent ? (
            <>
              <div className="agents-details__header">
                <h2>{selectedAgent.title}</h2>
                <p className="agents-details__filename">{selectedAgent.fileName}</p>
              </div>
              <div className="agents-details__thumbnail">
                {selectedAgent.imagePath ? (
                  <img src={fileSrc(selectedAgent.imagePath)} alt={`${selectedAgent.title} thumbnail`} />
                ) : (
                  <div className="agents-details__placeholder">
                    <Icon name="ImageOff" size={48} />
                    <p>No thumbnail yet</p>
                  </div>
                )}
              </div>
              <div className="agents-thumbnail-actions">
                <PrimaryButton
                  onClick={handleThumbnailClick}
                  loading={isUpdatingImage}
                  loadingText="Saving…"
                  disabled={!selectedAgent}
                >
                  {selectedAgent.imagePath ? 'Replace Image' : 'Upload Image'}
                </PrimaryButton>
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailFileChange}
                  style={{ display: 'none' }}
                />
                {selectedAgent.imagePath ? (
                  <button
                    type="button"
                    className="agents-remove-image"
                    onClick={handleRemoveThumbnail}
                    disabled={isRemovingImage}
                  >
                    {isRemovingImage ? 'Removing…' : 'Remove Image'}
                  </button>
                ) : null}
              </div>
              <ul className="agents-summary">
                <li>
                  <span>Words</span>
                  <strong>{formatCount(selectedAgent.wordCount)}</strong>
                </li>
                <li>
                  <span>Headings</span>
                  <strong>{formatCount(selectedAgent.headingCount)}</strong>
                </li>
                <li>
                  <span>Lines</span>
                  <strong>{formatCount(selectedAgent.lineCount)}</strong>
                </li>
                <li>
                  <span>Characters</span>
                  <strong>{formatCount(selectedAgent.charCount)}</strong>
                </li>
                <li>
                  <span>File Size</span>
                  <strong>{formatBytes(selectedAgent.size) || '—'}</strong>
                </li>
                <li>
                  <span>Last Updated</span>
                  <strong>{formatModified(selectedAgent.modifiedMs) || '—'}</strong>
                </li>
              </ul>
            </>
          ) : (
            <div className="agents-details__placeholder">
              <Icon name="BookOpen" size={48} />
              <p>Select an agent to view details.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
