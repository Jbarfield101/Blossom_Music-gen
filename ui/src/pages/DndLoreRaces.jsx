import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getConfig } from '../api/config';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { loadRaces, createRace, saveRacePortrait } from '../api/races';
import { readInbox } from '../api/inbox';
import { renderMarkdown } from '../lib/markdown.jsx';
import './Dnd.css';

export default function DndLoreRaces() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState('');
  const [isSubrace, setIsSubrace] = useState(false);
  const [parentRace, setParentRace] = useState('');
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [lastCreated, setLastCreated] = useState({ race: '', subrace: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [activePath, setActivePath] = useState('');
  const [activeContent, setActiveContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadRaces();
      setUsingPath(result?.root || '');
      setItems(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      console.error('Failed to load races', err);
      setError(err?.message || 'Failed to load races');
      setItems([]);
      setUsingPath('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Resolve portrait path for a race (Portrait_<RaceName>.*)
  const resolvePortrait = useCallback(async (raceName) => {
    let base = 'D:\\Documents\\DreadHaven';
    try {
      const vault = await getConfig('vaultPath');
      if (typeof vault === 'string' && vault.trim()) base = vault;
    } catch {}
    const dir = `${base}\\\\30_Assets\\\\Images\\\\Race_Portraits`;
    const clean = (s) => String(s || '').trim().replace(/\s+/g, '_');
    const race = clean(raceName);
    const exts = ['png','jpg','jpeg','webp'];
    const candidates = exts.map((ext) => `${dir}\\\\Portrait_${race}.${ext}`);
    for (const path of candidates) {
      try {
        await invoke('read_file_bytes', { path });
        return convertFileSrc(path);
      } catch {}
    }
    return '';
  }, []);

  // Build augmented view model with portraitUrl, race/subrace
  const itemsWithMeta = useMemo(() => items.map((it) => {
    const rel = String(it.path || '').replace(/\\/g, '/');
    const root = String(usingPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const inner = rel.startsWith(root) ? rel.slice(root.length).replace(/^\/+/, '') : rel;
    const segs = inner.split('/');
    const folder = segs[0] || '';
    const file = (it.name || '').replace(/\.[^.]+$/, '');
    const isRace = folder && file && folder.toLowerCase() === file.toLowerCase();
    return { ...it, race: folder || file, subrace: isRace ? '' : file };
  }), [items, usingPath]);

  const [portraits, setPortraits] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = {};
      for (const it of itemsWithMeta) {
        const url = await resolvePortrait(it.race);
        if (cancelled) return;
        if (url) map[it.path] = url;
      }
      if (!cancelled) setPortraits(map);
    })();
    return () => { cancelled = true; };
  }, [itemsWithMeta, resolvePortrait]);

  useEffect(() => {
    let cancelled = false;
    if (!activePath) { setActiveContent(''); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    setActiveContent('');
    (async () => {
      try {
        const text = await readInbox(activePath);
        if (!cancelled) { setActiveContent(text || ''); setPreviewLoading(false); }
      } catch (err) {
        console.error(err);
        if (!cancelled) { setActiveContent('Failed to load file.'); setPreviewLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [activePath]);

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Races</h1>
      <main className="dashboard" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <section className="dnd-surface">
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2>Playable Ancestries</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                Document racial traits, cultural notes, and setting-specific variants here.
              </p>
              {usingPath && <div className="muted">Folder: {usingPath}</div>}
            </div>
            <div>
              <button type="button" onClick={() => { if (!creating) { setShowCreate(true); setNewName(''); setCreateError(''); } }}>Add Race</button>
              <button type="button" onClick={refresh} style={{ marginLeft: '0.5rem' }} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
            </div>
          </div>
          {error && <div className="warning">{error}</div>}
          {itemsWithMeta.length === 0 ? (
            <div className="muted">{loading ? 'Searching for races…' : 'No race notes found.'}</div>
          ) : (
            <div className="dnd-card-grid" style={{ marginTop: 'var(--space-md)' }}>
              {itemsWithMeta.map((it) => (
                <Card
                  key={it.path}
                  to={''}
                  imageSrc={portraits[it.path] || ''}
                  imageAlt={it.title}
                  title={it.title}
                  onClick={() => { setActivePath(it.path); setModalOpen(true); }}
                >
                  {it.subrace ? `${it.subrace} (${it.race})` : it.race}
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      {showCreate && (
        <div className="lightbox" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <h2>New Race</h2>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (creating) return;
              const name = newName.trim();
              if (!name) { setCreateError(isSubrace ? 'Please enter a subrace name.' : 'Please enter a race name.'); return; }
              if (isSubrace && !parentRace) { setCreateError('Please choose a parent race.'); return; }
              try {
                setCreating(true);
                setCreateError('');
                if (isSubrace) {
                  await createRace({ name, parentName: parentRace, useLLM: true });
                  setLastCreated({ race: parentRace, subrace: name });
                } else {
                  await createRace({ name, useLLM: true });
                  setLastCreated({ race: name, subrace: '' });
                }
                setShowCreate(false);
                setNewName('');
                setParentRace('');
                refresh();
                // Prompt for image upload
                setShowImagePrompt(true);
              } catch (err) {
                console.error('Failed to create race note', err);
                setCreateError(err?.message || 'Failed to create race note');
              } finally {
                setCreating(false);
              }
            }}>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <input type="radio" name="raceType" checked={!isSubrace} onChange={() => setIsSubrace(false)} /> Race
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <input type="radio" name="raceType" checked={isSubrace} onChange={() => setIsSubrace(true)} /> Subrace
                </label>
              </div>
              {isSubrace && (
                <label>
                  Parent Race
                  <select value={parentRace} onChange={(e) => setParentRace(e.target.value)} disabled={creating}>
                    <option value="">Select a parent race…</option>
                    {itemsWithMeta.filter((it) => !it.subrace).map((it) => (
                      <option key={it.title} value={it.title}>{it.title}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {isSubrace ? 'Subrace Name' : 'Race Name'}
                <input type="text" value={newName} onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(''); }} autoFocus disabled={creating} placeholder={isSubrace ? 'e.g. High Elf' : 'e.g. Goliath'} />
              </label>
              {createError && <div className="error">{createError}</div>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => { if (!creating) setShowCreate(false); }} disabled={creating}>Cancel</button>
                <button type="submit" disabled={creating}>{creating ? (<><span className="spinner" aria-label="loading" /> Creating…</>) : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="lightbox" onClick={() => setModalOpen(false)}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{(itemsWithMeta.find((i) => i.path === activePath)?.title) || 'Race'}</h2>
            {previewLoading ? (
              <div className="muted">Loading…</div>
            ) : (
              <article className="inbox-reader-body">
                {renderMarkdown(activeContent || '')}
              </article>
            )}
          </div>
        </div>
      )}

      {showImagePrompt && (
        <div className="lightbox" onClick={() => setShowImagePrompt(false)}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            <h2>Upload Portrait</h2>
            <p className="muted">Optional: Add an image for {lastCreated.subrace ? `${lastCreated.subrace} (${lastCreated.race})` : lastCreated.race}.</p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const input = e.currentTarget.querySelector('input[type=file]');
              const file = input && input.files && input.files[0];
              if (!file) { setShowImagePrompt(false); return; }
              try {
                await saveRacePortrait({ race: lastCreated.race, subrace: lastCreated.subrace, file });
              } catch (err) {
                console.error('Failed to save portrait', err);
              } finally {
                setShowImagePrompt(false);
              }
            }}>
              <input type="file" accept="image/*" />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowImagePrompt(false)}>Skip</button>
                <button type="submit">Upload</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
