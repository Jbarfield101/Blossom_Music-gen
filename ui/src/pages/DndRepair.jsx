import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';
import { listNpcs } from '../api/npcs.js';
import { listenToNpcRepair, startNpcRepair } from '../api/repair.js';

const CATEGORY_OPTIONS = [
  { id: 'npc', label: 'NPCs', enabled: true },
  { id: 'location', label: 'Locations', enabled: false },
  { id: 'god', label: 'Gods', enabled: false },
];

const STATUS_META = {
  not_verified: { label: 'Not Verified', className: 'idle' },
  idle: { label: 'Not Verified', className: 'idle' },
  pending: { label: 'Pending', className: 'pending' },
  verified: { label: 'Verified', className: 'verified' },
  error: { label: 'Error', className: 'error' },
};

const FINISHED_STATUSES = new Set(['verified', 'error']);

function parseRunId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    if (typeof value.runId === 'number' && Number.isFinite(value.runId)) {
      return value.runId;
    }
    if (typeof value.run_id === 'number' && Number.isFinite(value.run_id)) {
      return value.run_id;
    }
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeRepairStatus(payload) {
  if (!payload) return null;
  if (payload.verified === true) return 'verified';
  if (payload.error === true || payload.failed === true) return 'error';
  if (payload.not_verified === true) return 'not_verified';
  if (payload.pending === true) return 'pending';
  const sources = [payload.status, payload.state, payload.phase, payload.stage];
  for (const source of sources) {
    if (!source) continue;
    const text = String(source).trim().toLowerCase();
    if (!text) continue;
    if (['not_verified', 'unverified', 'idle', 'unknown'].includes(text)) {
      return 'not_verified';
    }
    if (['pending', 'running', 'processing', 'queued', 'in-progress', 'working'].includes(text)) {
      return 'pending';
    }
    if (['verified', 'success', 'completed', 'complete', 'finished', 'done'].includes(text)) {
      return 'verified';
    }
    if (['error', 'failed', 'invalid'].includes(text)) {
      return 'error';
    }
  }
  if (typeof payload.success === 'boolean') {
    return payload.success ? 'verified' : 'error';
  }
  return null;
}

function isStartEvent(payload) {
  const status = String(payload?.status ?? payload?.state ?? '').toLowerCase();
  return payload?.started === true || status === 'started' || status === 'running';
}

function isCompletionEvent(payload) {
  if (!payload) return false;
  if (payload.done === true || payload.finished === true || payload.complete === true || payload.completed === true) {
    return true;
  }
  const status = String(payload.status ?? payload.state ?? payload.phase ?? '').toLowerCase();
  return ['finished', 'complete', 'completed', 'done', 'idle'].includes(status);
}

export default function DndRepair() {
  const [category, setCategory] = useState('npc');
  const disabledCategoryNames = useMemo(
    () => CATEGORY_OPTIONS.filter((option) => !option.enabled).map((option) => option.label),
    [],
  );
  const [npcs, setNpcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const runIdRef = useRef(null);
  const activeSetRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    listNpcs()
      .then((list) => {
        if (cancelled) return;
        const normalized = Array.isArray(list) ? list.slice() : [];
        normalized.sort((a, b) => {
          const aName = String(a?.name || '').toLowerCase();
          const bName = String(b?.name || '').toLowerCase();
          return aName.localeCompare(bName);
        });
        setNpcs(normalized);
        setStatuses((prev) => {
          const next = { ...prev };
          for (const npc of normalized) {
            if (npc?.id && !next[npc.id]) {
              next[npc.id] = 'not_verified';
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || 'Failed to load NPCs';
        setLoadError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten = null;
    listenToNpcRepair((event) => {
      const payload = event?.payload ?? {};
      const summary = payload?.summary;
      const runIdCandidates = [
        payload?.runId,
        payload?.run_id,
        payload?.jobId,
        payload?.job_id,
        summary?.runId,
        summary?.run_id,
      ];
      let eventRunId = null;
      for (const candidate of runIdCandidates) {
        const parsed = parseRunId(candidate);
        if (parsed) {
          eventRunId = parsed;
          break;
        }
      }
      if (eventRunId && runIdRef.current && eventRunId !== runIdRef.current) {
        return;
      }
      if (eventRunId && !runIdRef.current) {
        runIdRef.current = eventRunId;
      }

      if (summary) {
        const statusMap = summary.status_map || summary.statusMap || {};
        const verifiedList = Array.isArray(summary.verified) ? summary.verified : [];
        const failedList = Array.isArray(summary.failed) ? summary.failed : [];
        const errorsMap = (summary.errors || summary.Errors) ?? {};

        const normalizedEntries = [];
        if (statusMap && typeof statusMap === 'object') {
          for (const [id, statusValue] of Object.entries(statusMap)) {
            const normalized = normalizeRepairStatus({ status: statusValue });
            normalizedEntries.push([id, normalized]);
          }
        }

        setStatuses((prev) => {
          const next = { ...prev };
          const applyStatus = (id, status) => {
            if (!id || !status) return;
            next[id] = status;
          };
          normalizedEntries.forEach(([id, status]) => applyStatus(id, status));
          verifiedList.forEach((id) => applyStatus(id, 'verified'));
          failedList.forEach((id) => applyStatus(id, 'error'));
          if (errorsMap && typeof errorsMap === 'object') {
            Object.keys(errorsMap).forEach((id) => applyStatus(id, 'error'));
          }
          if (Array.isArray(summary.requested)) {
            summary.requested.forEach((id) => {
              if (!id) return;
              if (!next[id]) {
                const hasError =
                  (errorsMap && typeof errorsMap === 'object' && errorsMap[id]) ||
                  failedList.includes(id);
                applyStatus(id, hasError ? 'error' : 'not_verified');
              }
            });
          }
          return next;
        });

        const hasFailure =
          failedList.length > 0 ||
          normalizedEntries.some(([, status]) => status === 'error') ||
          (errorsMap && typeof errorsMap === 'object' && Object.keys(errorsMap).length > 0);
        if (hasFailure) {
          if (errorsMap && typeof errorsMap === 'object') {
            const firstError = Object.values(errorsMap).find(
              (value) => typeof value === 'string' && value.trim(),
            );
            if (firstError) {
              setRunError(String(firstError));
            } else if (typeof payload.error === 'string' && payload.error.trim()) {
              setRunError(String(payload.error));
            } else {
              setRunError('Some NPCs failed verification.');
            }
          } else if (typeof payload.error === 'string' && payload.error.trim()) {
            setRunError(String(payload.error));
          } else {
            setRunError('Some NPCs failed verification.');
          }
        } else {
          setRunError('');
        }

        activeSetRef.current = new Set();
        setRunning(false);
        return;
      }

      if (isStartEvent(payload)) {
        setRunning(true);
      }

      const entityId =
        payload.npcId || payload.npc_id || payload.entityId || payload.entity_id || payload.id;
      const status = normalizeRepairStatus(payload);
      if (entityId && status) {
        setStatuses((prev) => ({ ...prev, [entityId]: status }));
      }

      if (!entityId && typeof payload.error === 'string' && payload.error.trim()) {
        setRunError(String(payload.error));
      } else if (entityId && typeof payload.error === 'string' && payload.error.trim()) {
        setRunError(String(payload.error));
      }

      if (!entityId && isCompletionEvent(payload)) {
        activeSetRef.current = new Set();
        setRunning(false);
      }
    })
      .then((stopListening) => {
        if (cancelled) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((err) => {
        console.error('Failed to subscribe to NPC repair updates', err);
      });
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const activeIds = activeSetRef.current;
    if (!activeIds.size) return;
    const done = Array.from(activeIds).every((id) => FINISHED_STATUSES.has(statuses[id]));
    if (done) {
      activeSetRef.current = new Set();
      setRunning(false);
    }
  }, [statuses, running]);

  const npcMap = useMemo(() => {
    const map = new Map();
    for (const npc of npcs) {
      if (npc?.id) {
        map.set(npc.id, npc);
      }
    }
    return map;
  }, [npcs]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => npcMap.has(id)));
  }, [npcMap]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filteredEntities = useMemo(() => {
    if (category !== 'npc') return [];
    return npcs;
  }, [category, npcs]);

  const allSelected = filteredEntities.length > 0 && filteredEntities.every((npc) => selectedSet.has(npc.id));

  const toggleSelect = useCallback((id) => {
    if (running) return;
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((value) => value !== id) : prev.concat(id);
      return next;
    });
  }, [running]);

  const handleSelectAll = useCallback(() => {
    if (running) return;
    if (allSelected) {
      setSelected([]);
    } else {
      setSelected(filteredEntities.map((npc) => npc.id));
    }
  }, [allSelected, filteredEntities, running]);

  const handleClearSelection = useCallback(() => {
    if (running) return;
    setSelected([]);
  }, [running]);

  const handleStart = useCallback(async () => {
    if (!selected.length || running) return;
    setRunError('');
    activeSetRef.current = new Set(selected);
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        next[id] = 'pending';
      }
      return next;
    });
    setRunning(true);
    runIdRef.current = null;
    try {
      const result = await startNpcRepair(selected);
      const runId = parseRunId(result);
      if (runId) {
        runIdRef.current = runId;
      }
    } catch (err) {
      const message = err?.message || 'Failed to start repair run';
      setRunError(message);
      setRunning(false);
      activeSetRef.current = new Set();
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of selected) {
          if (next[id] === 'pending') {
            next[id] = 'not_verified';
          }
        }
        return next;
      });
    }
  }, [selected, running]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Repair</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Validate campaign records, fill in missing metadata, and stream progress updates from the repair service.
      </p>

      <div className="repair-category-toggle" role="tablist" aria-label="Repair categories">
        {CATEGORY_OPTIONS.map((option) => {
          const isActive = option.id === category;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              className={`repair-category-button${isActive ? ' is-active' : ''}`}
              aria-selected={isActive}
              disabled={!option.enabled || running}
              onClick={() => {
                if (!option.enabled || running) return;
                setCategory(option.id);
              }}
            >
              {option.label}
              {!option.enabled && <span className="repair-badge">Soon</span>}
            </button>
          );
        })}
      </div>

      {disabledCategoryNames.length > 0 && (
        <div className="repair-coming-soon muted" role="note">
          Only NPC repair runs are available right now; {disabledCategoryNames.join(' and ')} automation is still in
          progress.
        </div>
      )}

      <section className="repair-layout">
        <header className="repair-actions">
          <div className="repair-actions-left">
            <button type="button" onClick={handleSelectAll} disabled={running || loading || !filteredEntities.length}>
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <button type="button" onClick={handleClearSelection} disabled={running || !selected.length}>
              Clear selection
            </button>
          </div>
          <div className="repair-actions-right">
            <button
              type="button"
              className="repair-run-button"
              onClick={handleStart}
              disabled={running || !selected.length}
            >
              {running
                ? 'Repair in progress...'
                : selected.length
                  ? `Repair ${selected.length} ${selected.length === 1 ? 'record' : 'records'}`
                  : 'Repair selected records'}
            </button>
          </div>
        </header>

        {runError && <div className="dnd-modal-error" role="status">{runError}</div>}

        {loading ? (
          <div className="muted" role="status">Loading NPCs...</div>
        ) : loadError ? (
          <div className="warning" role="alert">{loadError}</div>
        ) : !filteredEntities.length ? (
          <div className="muted">No items available for this category.</div>
        ) : (
          <ul className="repair-entity-list">
            {filteredEntities.map((npc) => {
              const statusKey = statuses[npc.id] || 'not_verified';
              const status = STATUS_META[statusKey] ?? STATUS_META.idle;
              const isSelected = selectedSet.has(npc.id);
              return (
                <li key={npc.id} className={`repair-entity${isSelected ? ' is-selected' : ''}`}>
                  <label className="repair-entity-row">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(npc.id)}
                      disabled={running}
                    />
                    <div className="repair-entity-meta">
                      <div className="repair-entity-head">
                        <span className="repair-entity-name">{npc.name || 'Unnamed NPC'}</span>
                        <span className={`repair-status repair-status--${status.className}`}>{status.label}</span>
                      </div>
                      <div className="repair-entity-tags">
                        {npc.region && <span className="chip">Region: {npc.region}</span>}
                        {npc.location && <span className="chip">Town: {npc.location}</span>}
                        {npc.purpose && <span className="chip">Role: {npc.purpose}</span>}
                        {npc.id && <span className="chip">ID: {npc.id}</span>}
                      </div>
                      {npc.description && (
                        <p className="repair-entity-description">{npc.description.slice(0, 160)}{npc.description.length > 160 ? '...' : ''}</p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
