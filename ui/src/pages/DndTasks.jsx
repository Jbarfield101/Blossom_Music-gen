import { useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { listenToTagUpdates, updateSectionTags } from '../api/tags.js';
import { TAG_SECTIONS } from '../lib/dndTags.js';
import './Dnd.css';
import { getConfig } from '../api/config';
import { listDir } from '../api/dir';
import { listInbox, readInbox } from '../api/inbox';
import { listNpcs } from '../api/npcs';
import { saveGodPortrait, saveNpcPortrait } from '../api/images';
import { invoke } from '@tauri-apps/api/core';

const STATUS_LABELS = {
  started: 'Started',
  inspecting: 'Inspecting',
  updated: 'Updated',
  skipped: 'Skipped',
  finished: 'Finished',
  error: 'Error',
};

function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const tag = String(raw || '').trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function selectDefaultSections() {
  if (!TAG_SECTIONS.length) return [];
  return [TAG_SECTIONS[0].id];
}

export default function DndTasks() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(selectDefaultSections);
  const [running, setRunning] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState([]);
  const [progressRunId, setProgressRunId] = useState(0);
  const [summaries, setSummaries] = useState({});
  const runIdRef = useRef(0);

  // Images task state
  const [imagesOpen, setImagesOpen] = useState(false);
  const [imageScanError, setImageScanError] = useState('');
  const [imageItems, setImageItems] = useState([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageLogs, setImageLogs] = useState([]);

  const pushImageLog = (status, message) => {
    setImageLogs((prev) => prev.concat({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status,
      message: String(message || ''),
      t: Date.now(),
    }).slice(-400));
  };

  const sectionOrder = useMemo(() => TAG_SECTIONS.map((section) => section.id), []);
  const orderMap = useMemo(() => {
    const map = new Map();
    sectionOrder.forEach((id, index) => map.set(id, index));
    return map;
  }, [sectionOrder]);

  const sectionMap = useMemo(() => {
    const map = new Map();
    for (const section of TAG_SECTIONS) {
      map.set(section.id, section);
    }
    return map;
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    let cancelled = false;
    let unlisten = null;
    listenToTagUpdates((event) => {
      const payload = event?.payload || {};
      const tags = normalizeTags(payload.tags);
      const relPath = payload.rel_path || payload.relPath || payload.path || '';
      const item = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        runId: runIdRef.current,
        section: typeof payload.section === 'string' ? payload.section : '',
        label: typeof payload.label === 'string' ? payload.label : '',
        status: typeof payload.status === 'string' ? payload.status : 'info',
        message: payload.message ? String(payload.message) : '',
        path: relPath ? String(relPath) : '',
        tags,
        index: Number.isFinite(payload.index) ? Number(payload.index) : null,
        total: Number.isFinite(payload.total) ? Number(payload.total) : null,
        updated: Number.isFinite(payload.updated) ? Number(payload.updated) : null,
        skipped: Number.isFinite(payload.skipped) ? Number(payload.skipped) : null,
        failed: Number.isFinite(payload.failed) ? Number(payload.failed) : null,
        timestamp: Date.now(),
      };
      setProgress((prev) => {
        const next = prev.concat(item);
        const limit = 400;
        return next.length > limit ? next.slice(next.length - limit) : next;
      });
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.error('Failed to subscribe to tag updates', err);
      });
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const visibleLogs = useMemo(() => {
    if (!progressRunId) return progress;
    return progress.filter((entry) => entry.runId === progressRunId);
  }, [progress, progressRunId]);

  const toggleSection = (id) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      const ordered = Array.from(next);
      ordered.sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0));
      return ordered;
    });
  };

  const handleClose = () => {
    if (running) return;
    setModalOpen(false);
    setError('');
  };

  const handleCloseImages = () => {
    setImagesOpen(false);
    setImageScanError('');
    setImageItems([]);
    setImageLogs([]);
  };

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  const handleStart = async () => {
    if (!selected.length || running) return;
    setModalOpen(true);
    setError('');
    setSummaries({});
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setProgressRunId(runId);
    setProgress([]);
    setRunning(true);

    try {
      for (const sectionId of selected) {
        setActiveSectionId(sectionId);
        const summary = await updateSectionTags(sectionId);
        if (summary && summary.section) {
          setSummaries((prev) => ({ ...prev, [summary.section]: summary }));
        }
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
      setActiveSectionId('');
    }
  };

  const activeSectionLabel = activeSectionId
    ? sectionMap.get(activeSectionId)?.label || activeSectionId
    : '';

  const summaryItems = useMemo(() => {
    const items = [];
    for (const section of TAG_SECTIONS) {
      if (summaries[section.id]) {
        items.push({ ...summaries[section.id], label: section.label });
      }
    }
    return items;
  }, [summaries]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons · Tasks</h1>
      <main className="dashboard dnd-card-grid">
        <Card icon="Tags" title="Update Tags" onClick={() => setModalOpen(true)}>
          Refresh YAML tags across campaign notes using the shared taxonomies.
        </Card>
        <Card icon="Image" title="Update Images" onClick={async () => {
          setImagesOpen(true);
          setImageScanError('');
          setImageItems([]);
          setImageLoading(true);
          setImageLogs([]);
          try {
            const vault = await getConfig('vaultPath');
            const npcPortraitBase = (typeof vault === 'string' && vault)
              ? `${vault}\\30_Assets\\Images\\NPC_Portraits`.replace(/\\/g, '\\\\')
              : 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\NPC_Portraits'.replace(/\\/g, '\\\\');
            const godPortraitBase = (typeof vault === 'string' && vault)
              ? `${vault}\\30_Assets\\Images\\God_Portraits`.replace(/\\/g, '\\\\')
              : 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\God_Portraits'.replace(/\\/g, '\\\\');
            pushImageLog('started', `Indexing portraits (NPC: ${npcPortraitBase}, God: ${godPortraitBase})`);
            const buildIndex = async (base) => {
              const idx = {};
              const stack = [base];
              const seen = new Set();
              const normalize = (s) => String(s || '')
                .replace(/\.[^.]+$/, '')
                .replace(/^portrait[_\-\s]+/i, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
              while (stack.length) {
                const dir = stack.pop();
                if (!dir || seen.has(dir)) continue;
                seen.add(dir);
                let entries = [];
                try { entries = await listDir(dir); } catch { entries = []; }
                for (const e of entries) {
                  if (e.is_dir) {
                    stack.push(e.path);
                  } else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name)) {
                    const key = normalize(e.name);
                    if (key && !idx[key]) idx[key] = e.path;
                  }
                }
              }
              return idx;
            };
            const npcPortraitIndex = await buildIndex(npcPortraitBase);
            const godPortraitIndex = await buildIndex(godPortraitBase);

            const npcs = await listNpcs();
            const norm = (s) => String(s || '')
              .replace(/\.[^.]+$/, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '');
            const missing = [];
            pushImageLog('inspecting', `Scanning NPCs (${Array.isArray(npcs) ? npcs.length : 0})`);
            for (const npc of (Array.isArray(npcs) ? npcs : [])) {
              const key = norm(npc.name || '');
              if (!key) continue;
              if (!npcPortraitIndex[key]) {
                let prompt = '';
                try {
                  const sys = 'You craft concise, vivid image prompts for fantasy portrait generators. Keep under 60 words.';
                  const desc = String(npc.description || '').trim();
                  const base = `Create a portrait prompt for NPC ${npc.name}. ${desc ? `Description: ${desc}` : ''}`;
                  prompt = String(await invoke('generate_llm', { prompt: base, system: sys })) || '';
                } catch {}
                missing.push({ kind: 'npc', name: npc.name, description: npc.description || '', prompt });
                pushImageLog('skipped', `Missing NPC portrait: ${npc.name}`);
              }
            }
            pushImageLog('info', `NPCs missing portraits: ${missing.filter(m => m.kind==='npc').length}`);

            let pantheonBase = '';
            if (typeof vault === 'string' && vault) {
              pantheonBase = `${vault}\\10_World\\Gods of the Realm`;
            } else {
              pantheonBase = 'D:\\\\Documents\\\\DreadHaven\\\\10_World\\\\Gods of the Realm';
            }
            let gods = [];
            try { gods = await listInbox(pantheonBase); } catch { gods = []; }
            pushImageLog('inspecting', `Scanning Gods (${Array.isArray(gods) ? gods.length : 0})`);
            for (const g of (Array.isArray(gods) ? gods : [])) {
              const title = g.title || g.name || '';
              const key = norm(title);
              if (!key) continue;
              if (!godPortraitIndex[key]) {
                let prompt = '';
                try {
                  const text = await readInbox(g.path);
                  const sys = 'You craft concise, vivid image prompts for gods/deities in fantasy settings. Keep under 60 words.';
                  const base = `Create a portrait prompt for the deity ${title}. Here is context from the note:\n\n${String(text || '').slice(0, 1200)}`;
                  prompt = String(await invoke('generate_llm', { prompt: base, system: sys })) || '';
                } catch {}
                missing.push({ kind: 'god', name: title, path: g.path, prompt });
                pushImageLog('skipped', `Missing God portrait: ${title}`);
              }
            }
            setImageItems(missing);
            pushImageLog('finished', `Scan complete. Total missing: ${missing.length}`);
          } catch (e) {
            const msg = e?.message || String(e);
            setImageScanError(msg);
            pushImageLog('error', msg);
          } finally {
            setImageLoading(false);
          }
        }}>
          Find NPCs and Gods missing portrait images; attach images and get auto-generated prompts.
        </Card>
      </main>

      {modalOpen && (
        <div className="dnd-modal-backdrop" role="presentation" onClick={handleBackdropClick}>
          <div className="dnd-modal" role="dialog" aria-modal="true" aria-labelledby="dnd-tag-modal-title">
            <header className="dnd-modal-header">
              <div>
                <h2 id="dnd-tag-modal-title">Update Vault Tags</h2>
                <p className="dnd-modal-subtitle">Pick one or more sections to process. Notes are updated sequentially so new runs wait for the current pass to finish.</p>
              </div>
              <button type="button" onClick={handleClose} disabled={running}>Close</button>
            </header>
            <div className="dnd-modal-body">
              <section className="dnd-section-picker">
                <h3>Select sections</h3>
                <ul className="dnd-section-list">
                  {TAG_SECTIONS.map((section) => {
                    const checked = selectedSet.has(section.id);
                    return (
                      <li key={section.id}>
                        <label className={`dnd-section-option${checked ? ' is-selected' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleSection(section.id)} disabled={running} />
                          <div className="dnd-section-meta">
                            <div className="dnd-section-head">
                              <span className="dnd-section-title">{section.label}</span>
                              <span className="dnd-section-path">{section.vaultSubfolder}</span>
                            </div>
                            <p className="dnd-section-prompt">{section.prompt}</p>
                            {section.tags?.length > 0 && (
                              <div className="dnd-section-tags">
                                {section.tags.map((tag) => (
                                  <span key={tag} className="dnd-tag-chip">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section className="dnd-task-progress" aria-live="polite">
                <div className="dnd-progress-head">
                  <h3>Progress</h3>
                  {running && activeSectionLabel && (<span className="dnd-progress-active">Running: {activeSectionLabel}</span>)}
                </div>
                <ol className="dnd-progress-list">
                  {visibleLogs.length > 0 ? (
                    visibleLogs.map((entry) => {
                      const statusLabel = STATUS_LABELS[entry.status] || entry.status;
                      const key = entry.id;
                      return (
                        <li key={key} className={`dnd-progress-item status-${entry.status}`}>
                          <div className="dnd-progress-row">
                            <span className="dnd-progress-status">{statusLabel}</span>
                            {entry.index != null && entry.total != null && (
                              <span className="dnd-progress-count">{entry.index + 1} / {entry.total}</span>
                            )}
                          </div>
                          {entry.path && (<div className="dnd-progress-path">{entry.path}</div>)}
                          {entry.message && (<div className="dnd-progress-message">{entry.message}</div>)}
                          {entry.tags && entry.tags.length > 0 && (
                            <div className="dnd-progress-tags">
                              {entry.tags.map((tag) => (<span key={tag} className="dnd-tag-chip">{tag}</span>))}
                            </div>
                          )}
                          {entry.status === 'finished' && (
                            <div className="dnd-progress-summary">
                              <span>Updated: {entry.updated ?? 0}</span>
                              <span>Skipped: {entry.skipped ?? 0}</span>
                              <span>Failed: {entry.failed ?? 0}</span>
                            </div>
                          )}
                        </li>
                      );
                    })
                  ) : (
                    <li className="dnd-progress-item muted">Waiting for the run to start.</li>
                  )}
                </ol>
                {summaryItems.length > 0 && (
                  <div className="dnd-progress-summaries">
                    {summaryItems.map((item) => (
                      <div key={item.section} className="dnd-summary-card">
                        <h4>{item.label}</h4>
                        <div className="dnd-summary-grid">
                          <span>Total: {item.total_notes ?? item.total ?? 0}</span>
                          <span>Updated: {item.updated_notes ?? item.updated ?? 0}</span>
                          <span>Skipped: {item.skipped_notes ?? item.skipped ?? 0}</span>
                          <span>Failed: {item.failed_notes ?? item.failed ?? 0}</span>
                        </div>
                        {item.duration_ms != null && (<span className="dnd-summary-duration">Duration: {(item.duration_ms / 1000).toFixed(1)}s</span>)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
            {error && <div className="dnd-modal-error">{error}</div>}
            <footer className="dnd-modal-actions">
              <button type="button" onClick={handleStart} disabled={running || !selected.length}>{running ? 'Updating.' : 'Run update'}</button>
              <button type="button" onClick={handleClose} disabled={running}>Cancel</button>
            </footer>
          </div>
        </div>
      )}

      {imagesOpen && (
        <div className="dnd-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) handleCloseImages(); }}>
          <div className="dnd-modal" role="dialog" aria-modal="true" aria-labelledby="dnd-images-title">
            <header className="dnd-modal-header">
              <div>
                <h2 id="dnd-images-title">Update Images</h2>
                <p className="dnd-modal-subtitle">NPCs and Gods without portraits. Attach an image or use the prompt to generate one.</p>
              </div>
              <button type="button" onClick={handleCloseImages}>Close</button>
            </header>
            <div className="dnd-modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <section className="dnd-task-progress" aria-live="polite">
                <div className="dnd-progress-head">
                  <h3>Status</h3>
                </div>
                <ol className="dnd-progress-list">
                  {imageLogs.length === 0 ? (
                    <li className="dnd-progress-item muted">Waiting to start.</li>
                  ) : (
                    imageLogs.map((l) => (
                      <li key={l.id} className={`dnd-progress-item status-${l.status}`}>
                        <div className="dnd-progress-row">
                          <span className="dnd-progress-status">{l.status}</span>
                        </div>
                        <div className="dnd-progress-message">{l.message}</div>
                      </li>
                    ))
                  )}
                </ol>
              </section>
              {imageLoading ? (
                <div className="muted">Scanning for missing images.</div>
              ) : imageScanError ? (
                <div className="warning">{imageScanError}</div>
              ) : imageItems.length === 0 ? (
                <div className="muted">All set. No missing images found.</div>
              ) : (
                <ul className="commands-list">
                  {imageItems.map((it, idx) => (
                    <li key={`${it.kind}-${it.name}-${idx}`} className="commands-item">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
                        <strong>{it.name}</strong>
                        <span className="muted">({it.kind === 'npc' ? 'NPC' : 'God'})</span>
                        <span style={{ marginLeft: 'auto' }} />
                        <label className="button" style={{ cursor: 'pointer' }}>
                          Attach Image
                          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                            const file = e.target.files && e.target.files[0];
                            e.target.value = '';
                            if (!file) return;
                            try {
                              if (it.kind === 'npc') {
                                await saveNpcPortrait(it.name, file);
                              } else {
                                await saveGodPortrait(it.name, file);
                              }
                              setImageItems((prev) => prev.filter((row) => !(row.kind === it.kind && row.name === it.name)));
                              pushImageLog('updated', `Attached image for ${it.kind === 'npc' ? 'NPC' : 'God'}: ${it.name}`);
                            } catch (err) {
                              alert(err?.message || String(err));
                              pushImageLog('error', `Failed to attach image for ${it.name}`);
                            }
                          }} />
                        </label>
                      </div>
                      {it.prompt && (
                        <div className="inbox-reader" style={{ marginTop: 8 }}>
                          <div className="muted" style={{ marginBottom: 4 }}>Image Prompt</div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{it.prompt}</div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
