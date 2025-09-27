import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { loadRaces, createRace, saveRacePortrait } from '../api/races';
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
          {items.length === 0 ? (
            <div className="muted">{loading ? 'Searching for races…' : 'No race notes found.'}</div>
          ) : (
            <div className="dnd-card-grid" style={{ marginTop: 'var(--space-md)' }}>
              {items.map((it) => (
                <Card key={it.path} to={''} icon="ScrollText" title={it.title}>
                  {it.name}
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
                    {items.map((it) => (
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
                <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
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
