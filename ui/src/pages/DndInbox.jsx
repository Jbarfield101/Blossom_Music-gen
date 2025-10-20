import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import {
  listInbox,
  readInbox,
  createInbox,
  updateInbox,
  deleteInbox,
  moveInboxItem,
} from '../api/inbox';
import './Dnd.css';
import { renderMarkdown } from '../lib/markdown.jsx';
import { useVaultVersion } from '../lib/vaultEvents.jsx';

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
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [createError, setCreateError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editError, setEditError] = useState('');
  const [convertMenuOpen, setConvertMenuOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState(null);
  const [convertTitle, setConvertTitle] = useState('');
  const [convertTags, setConvertTags] = useState('');
  const [convertBody, setConvertBody] = useState('');
  const [convertError, setConvertError] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const inboxVersion = useVaultVersion(['00_inbox']);
  const menuRef = useRef(null);

  const convertOptions = useMemo(
    () => [
      {
        id: 'npc',
        label: 'Create NPC from note',
        dialogTitle: 'Create NPC from inbox note',
        submitLabel: 'Create NPC',
        description: 'Move this note into 20_DM/NPC and tag it as an NPC record.',
        defaultTags: ['npc'],
      },
      {
        id: 'lore',
        label: 'Move to Lore',
        dialogTitle: 'Move note to Lore',
        submitLabel: 'Move to Lore',
        description: 'File this note inside 10_Lore with lore tags.',
        defaultTags: ['lore'],
      },
      {
        id: 'quest',
        label: 'Move to Quest Log',
        dialogTitle: 'Move note to Quest log',
        submitLabel: 'Move to Quest Log',
        description: 'Place this entry under 20_DM/Quests for follow-up tracking.',
        defaultTags: ['quest'],
      },
      {
        id: 'faction',
        label: 'Move to Faction',
        dialogTitle: 'Move note to Factions',
        submitLabel: 'Move to Faction',
        description: 'Organise the note beneath 10_World/Factions.',
        defaultTags: ['faction'],
      },
      {
        id: 'location',
        label: 'Move to Location',
        dialogTitle: 'Move note to Locations',
        submitLabel: 'Move to Location',
        description: 'Send the note to 10_World/Regions as a location entry.',
        defaultTags: ['location'],
      },
      {
        id: 'session',
        label: 'Move to Session Log',
        dialogTitle: 'Move note to Session log',
        submitLabel: 'Move to Session Log',
        description: 'Archive this entry inside 20_DM/Sessions.',
        defaultTags: ['session'],
      },
    ],
    []
  );

  useEffect(() => {
    if (!convertMenuOpen) return;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setConvertMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [convertMenuOpen]);

  const deriveTitle = useCallback(
    (content, fallback) => {
      if (typeof content !== 'string' || !content.trim()) {
        return fallback;
      }
      if (content.trimStart().startsWith('---')) {
        const match = content.match(/---\s*[\r\n]+([\s\S]*?)\r?\n---/);
        if (match && match[1]) {
          const lines = match[1].split(/\r?\n/);
          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            const lower = line.toLowerCase();
            if (lower.startsWith('title:')) {
              return line.split(/:(.+)/)[1]?.trim() || fallback;
            }
            if (lower.startsWith('name:')) {
              return line.split(/:(.+)/)[1]?.trim() || fallback;
            }
          }
        }
      }
      const heading = content.match(/^#\s+(.+)$/m);
      if (heading && heading[1]) {
        return heading[1].trim();
      }
      return fallback;
    },
    []
  );

  const openConvertDialog = useCallback(
    (option) => {
      if (!option || !activePath) return;
      const baseContent = editing ? editBody : activeContent;
      const fallback = selected?.title || selected?.name || 'Converted Note';
      const initialTitle = deriveTitle(baseContent, fallback) || fallback;
      setConvertTarget(option);
      setConvertTitle(initialTitle);
      setConvertTags((option.defaultTags || []).join(', '));
      setConvertBody(baseContent || '');
      setConvertError('');
      setConvertMenuOpen(false);
    },
    [activeContent, activePath, deriveTitle, editBody, editing, selected]
  );

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
  }, [fetchItems, inboxVersion]);

  useEffect(() => {
    if (!activePath) {
      setActiveContent('');
      setEditBody('');
      setEditing(false);
      return;
    }
    (async () => {
      try {
        const text = await readInbox(activePath);
        setActiveContent(text || '');
        setEditBody(text || '');
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
        <button type="button" onClick={() => { if (!creating) { setShowCreate(true); setNewName(''); setNewBody(''); setCreateError(''); } }} disabled={loading || creating}>
          New
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
          {items.map((item) => {
            const previewText =
              typeof item.preview === 'string' ? item.preview.trim() : '';
            const previewDisplay = previewText || 'No preview available';
            const markers = Array.isArray(item.markers) ? item.markers : [];
            const markersDescription =
              markers.length > 0
                ? `. Contains ${markers
                    .map((marker) => marker.replace(/_/g, ' '))
                    .join(', ')}`
                : '';
            const ariaLabel = `${item.title || item.name}. ${previewDisplay}${markersDescription}`;
            const previewTooltip = previewText
              ? `${item.path}\n${previewText}`
              : item.path;
            const markerMeta = {
              embed: {
                icon: '🖼️',
                label: 'Contains embedded asset',
              },
              link: {
                icon: '🔗',
                label: 'Contains external link',
              },
              code: {
                icon: '⌘',
                label: 'Contains code snippet',
              },
            };
            return (
              <button
                key={item.path}
                className={`inbox-item${item.path === activePath ? ' active' : ''}`}
                onClick={() => setActivePath(item.path)}
                title={previewTooltip}
                aria-label={ariaLabel}
              >
                <div className="inbox-item-head">
                  <div className="inbox-item-title">{item.title || item.name}</div>
                  <time className="inbox-item-date" title={formatDate(item.modified_ms)}>
                    {formatRelative(item.modified_ms)}
                  </time>
                </div>
                <div className="inbox-item-preview">
                  {markers.map((marker, index) => {
                    const meta = markerMeta[marker] || {
                      icon: '•',
                      label: marker.replace(/_/g, ' '),
                    };
                    return (
                      <span
                        key={`${marker}-${index}`}
                        className="inbox-item-marker"
                        aria-label={meta.label}
                        title={meta.label}
                      >
                        {meta.icon}
                      </span>
                    );
                  })}
                  <span
                    className={`inbox-item-preview-text${previewText ? '' : ' muted'}`}
                    title={previewText || undefined}
                  >
                    {previewDisplay}
                  </span>
                </div>
              </button>
            );
          })}
          {!loading && items.length === 0 && (
            <div className="muted">No files found in this folder.</div>
          )}
        </aside>
        <section className="inbox-reader">
          {selected ? (
            <>
              <header className="inbox-reader-header">
                <h2 className="inbox-reader-title">{selected.title || selected.name}</h2>
                <div className="inbox-reader-meta" style={{ gap: '0.75rem' }}>
                  <span>{selected.name}</span>
                  <span>·</span>
                  <time>{formatDate(selected.modified_ms)}</time>
                  <span style={{ marginLeft: 'auto' }} />
                  <div
                    ref={menuRef}
                    className="inbox-convert-menu"
                    style={{ position: 'relative' }}
                  >
                    <button
                      type="button"
                      onClick={() => setConvertMenuOpen((v) => !v)}
                      disabled={!activePath}
                    >
                      Convert/Move ▾
                    </button>
                    {convertMenuOpen && (
                      <div className="inbox-convert-dropdown" role="menu">
                        {convertOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className="inbox-convert-option"
                            onClick={() => openConvertDialog(option)}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => { setEditing((v) => !v); setEditError(''); setEditBody(activeContent || ''); }}>
                    {editing ? 'Cancel' : 'Edit'}
                  </button>
                  <button type="button" onClick={async () => {
                    if (!activePath) return;
                    if (editing) {
                      try { setEditError(''); await updateInbox(activePath, editBody); setEditing(false); setActiveContent(editBody); await fetchItems(); }
                      catch (err) { setEditError(err?.message || String(err)); }
                    } else {
                      if (!confirm('Delete this file?')) return;
                      try { await deleteInbox(activePath); setActivePath(''); await fetchItems(); }
                      catch (err) { alert(err?.message || String(err)); }
                    }
                  }}>
                    {editing ? 'Save' : 'Delete'}
                  </button>
                </div>
              </header>
              <article className="inbox-reader-body">
                {editing ? (
                  <>
                    <textarea rows={16} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                    {editError && <div className="error">{editError}</div>}
                  </>
                ) : (
                  (/\.(md|mdx|markdown)$/i.test(selected.name || '') ? (
                    (formatMarkdown ? renderMarkdown(activeContent) : (
                      <pre className="inbox-reader-content">{activeContent}</pre>
                    ))
                  ) : (
                    <pre className="inbox-reader-content">{activeContent}</pre>
                  ))
                )}
              </article>
            </>
          ) : (
            <div className="muted">Select a file to read.</div>
          )}
        </section>
      </div>
      {showCreate && (
        <div className="lightbox" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="lightbox-panel monster-create-panel" onClick={(e) => e.stopPropagation()}>
            <h2>New Inbox Item</h2>
            <form className="monster-create-form" onSubmit={async (e) => {
              e.preventDefault();
              if (creating) return;
              const name = newName.trim();
              if (!name) { setCreateError('Please enter a file name.'); return; }
              try {
                setCreating(true);
                setCreateError('');
                const path = await createInbox(name, newBody);
                setShowCreate(false);
                setNewName('');
                setNewBody('');
                await fetchItems();
                if (path) setActivePath(path);
              } catch (err) {
                setCreateError(err?.message || String(err));
              } finally {
                setCreating(false);
              }
            }}>
              <label>
                File name
                <input type="text" value={newName} onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(''); }} autoFocus disabled={creating} placeholder="e.g. Lead_on_the_Bandits" />
              </label>
              <label>
                Content (optional)
                <textarea rows={6} value={newBody} onChange={(e) => setNewBody(e.target.value)} disabled={creating} placeholder="# Title\n\nWrite your notes here." />
              </label>
              {createError && <div className="error">{createError}</div>}
              <div className="monster-create-actions">
                <button type="button" onClick={() => { if (!creating) setShowCreate(false); }} disabled={creating}>Cancel</button>
                <button type="submit" disabled={creating}>{creating ? 'Creating.' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {convertTarget && (
        <div className="lightbox" onClick={() => { if (!convertLoading) { setConvertTarget(null); setConvertError(''); } }}>
          <div className="lightbox-panel monster-create-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{convertTarget.dialogTitle}</h2>
            {convertTarget.description && (
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                {convertTarget.description}
              </p>
            )}
            <form
              className="monster-create-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!convertTarget || !activePath || convertLoading) return;
                const finalTitle = convertTitle.trim();
                if (!finalTitle) {
                  setConvertError('Please provide a title for the converted note.');
                  return;
                }
                try {
                  setConvertLoading(true);
                  setConvertError('');
                  const tags = convertTags
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                  await moveInboxItem({
                    path: activePath,
                    target: convertTarget.id,
                    title: finalTitle,
                    tags,
                    content: convertBody,
                  });
                  setConvertTarget(null);
                  setConvertBody('');
                  setConvertTitle('');
                  setConvertTags('');
                  setEditing(false);
                  setEditBody('');
                  setActiveContent('');
                  setActivePath('');
                  await fetchItems();
                } catch (err) {
                  setConvertError(err?.message || String(err));
                } finally {
                  setConvertLoading(false);
                }
              }}
            >
              <label>
                Title
                <input
                  type="text"
                  value={convertTitle}
                  onChange={(e) => setConvertTitle(e.target.value)}
                  disabled={convertLoading}
                />
              </label>
              <label>
                Tags (comma separated)
                <input
                  type="text"
                  value={convertTags}
                  onChange={(e) => setConvertTags(e.target.value)}
                  disabled={convertLoading}
                  placeholder="npc, ally, guild"
                />
              </label>
              <label>
                Content
                <textarea
                  rows={16}
                  value={convertBody}
                  onChange={(e) => setConvertBody(e.target.value)}
                  disabled={convertLoading}
                />
              </label>
              {convertError && <div className="error">{convertError}</div>}
              <div className="monster-create-actions">
                <button
                  type="button"
                  onClick={() => { if (!convertLoading) { setConvertTarget(null); setConvertError(''); } }}
                  disabled={convertLoading}
                >
                  Cancel
                </button>
                <button type="submit" disabled={convertLoading}>
                  {convertLoading ? 'Moving…' : convertTarget.submitLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}



