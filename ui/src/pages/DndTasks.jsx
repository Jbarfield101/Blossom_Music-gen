import { useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { listenToTagUpdates, updateSectionTags } from '../api/tags.js';
import { TAG_SECTIONS } from '../lib/dndTags.js';
import './Dnd.css';

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
      </main>
      {modalOpen && (
        <div
          className="dnd-modal-backdrop"
          role="presentation"
          onClick={handleBackdropClick}
        >
          <div
            className="dnd-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dnd-tag-modal-title"
          >
            <header className="dnd-modal-header">
              <div>
                <h2 id="dnd-tag-modal-title">Update Vault Tags</h2>
                <p className="dnd-modal-subtitle">
                  Pick one or more sections to process. Notes are updated sequentially so new runs
                  wait for the current pass to finish.
                </p>
              </div>
              <button type="button" onClick={handleClose} disabled={running}>
                Close
              </button>
            </header>
            <div className="dnd-modal-body">
              <section className="dnd-section-picker">
                <h3>Select sections</h3>
                <ul className="dnd-section-list">
                  {TAG_SECTIONS.map((section) => {
                    const checked = selectedSet.has(section.id);
                    return (
                      <li key={section.id}>
                        <label
                          className={`dnd-section-option${checked ? ' is-selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSection(section.id)}
                            disabled={running}
                          />
                          <div className="dnd-section-meta">
                            <div className="dnd-section-head">
                              <span className="dnd-section-title">{section.label}</span>
                              <span className="dnd-section-path">{section.vaultSubfolder}</span>
                            </div>
                            <p className="dnd-section-prompt">{section.prompt}</p>
                            {section.tags?.length > 0 && (
                              <div className="dnd-section-tags">
                                {section.tags.map((tag) => (
                                  <span key={tag} className="dnd-tag-chip">
                                    {tag}
                                  </span>
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
                  {running && activeSectionLabel && (
                    <span className="dnd-progress-active">Running: {activeSectionLabel}</span>
                  )}
                </div>
                <ol className="dnd-progress-list">
                  {visibleLogs.length > 0 ? (
                    visibleLogs.map((entry) => {
                      const statusLabel = STATUS_LABELS[entry.status] || entry.status;
                      const key = entry.id;
                      return (
                        <li
                          key={key}
                          className={`dnd-progress-item status-${entry.status}`}
                        >
                          <div className="dnd-progress-row">
                            <span className="dnd-progress-status">{statusLabel}</span>
                            {entry.index != null && entry.total != null && (
                              <span className="dnd-progress-count">
                                {entry.index + 1} / {entry.total}
                              </span>
                            )}
                          </div>
                          {entry.path && (
                            <div className="dnd-progress-path">{entry.path}</div>
                          )}
                          {entry.message && (
                            <div className="dnd-progress-message">{entry.message}</div>
                          )}
                          {entry.tags && entry.tags.length > 0 && (
                            <div className="dnd-progress-tags">
                              {entry.tags.map((tag) => (
                                <span key={tag} className="dnd-tag-chip">
                                  {tag}
                                </span>
                              ))}
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
                    <li className="dnd-progress-item muted">Waiting for the run to start…</li>
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
                        {item.duration_ms != null && (
                          <span className="dnd-summary-duration">
                            Duration: {(item.duration_ms / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
            {error && <div className="dnd-modal-error">{error}</div>}
            <footer className="dnd-modal-actions">
              <button
                type="button"
                onClick={handleStart}
                disabled={running || !selected.length}
              >
                {running ? 'Updating…' : 'Run update'}
              </button>
              <button type="button" onClick={handleClose} disabled={running}>
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

