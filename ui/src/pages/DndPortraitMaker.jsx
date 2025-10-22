import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { useJobQueue } from '../lib/useJobQueue.js';

const JOB_POLL_INTERVAL_MS = 2000;

const TEXTAREA_STYLE = Object.freeze({
  width: '100%',
  minHeight: '140px',
  padding: '1.1rem',
  fontSize: '1.05rem',
  lineHeight: 1.6,
  borderRadius: '14px',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  background: 'var(--card-bg)',
  color: 'var(--text)',
  resize: 'vertical',
  boxShadow: 'inset 0 2px 6px rgba(15, 23, 42, 0.08)',
});

function formatEta(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function DndPortraitMaker() {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [characterClass, setCharacterClass] = useState('');
  const [stylePreset, setStylePreset] = useState('illustrated');
  const [lighting, setLighting] = useState('dramatic');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState(null);
  const [jobStage, setJobStage] = useState('');
  const [jobProgress, setJobProgress] = useState(0);
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);

  const jobIdRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tauri = await isTauri();
        if (!cancelled) {
          setIsTauriEnv(Boolean(tauri));
        }
      } catch {
        if (!cancelled) {
          setIsTauriEnv(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearJobPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearJobPolling();
      jobIdRef.current = null;
    },
    [clearJobPolling],
  );

  const pollJobStatus = useCallback(
    async (id) => {
      if (!isTauriEnv || !id || jobIdRef.current !== id) return;
      try {
        const data = await invoke('job_status', { jobId: id });
        if (jobIdRef.current !== id) {
          return;
        }

        const status = typeof data?.status === 'string' ? data.status : '';
        const progressInfo = data?.progress || {};
        const percent =
          typeof progressInfo.percent === 'number'
            ? progressInfo.percent
            : status === 'completed'
              ? 100
              : 0;
        setJobProgress(percent);
        setJobStage(progressInfo.stage || status || '');
        setQueuePosition(
          typeof progressInfo.queue_position === 'number' ? progressInfo.queue_position : null,
        );
        setQueueEtaSeconds(
          typeof progressInfo.queue_eta_seconds === 'number' ? progressInfo.queue_eta_seconds : null,
        );
        refreshQueue();

        if (status === 'queued' || status === 'running') {
          clearJobPolling();
          pollIntervalRef.current = setTimeout(() => {
            pollJobStatus(id);
          }, JOB_POLL_INTERVAL_MS);
          return;
        }

        clearJobPolling();
        jobIdRef.current = null;
        setJobId(null);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        if (status === 'completed') {
          setStatusMessage(progressInfo.message || 'Portrait render complete.');
          setError('');
        } else if (status === 'cancelled') {
          setStatusMessage('Portrait job cancelled.');
          setError('');
        } else {
          const message =
            typeof data?.message === 'string' && data.message
              ? data.message
              : 'Portrait job ended without completing.';
          setStatusMessage('');
          setError(message);
        }
      } catch (err) {
        if (jobIdRef.current !== id) {
          return;
        }
        clearJobPolling();
        jobIdRef.current = null;
        setJobId(null);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        const message = err instanceof Error ? err.message : String(err);
        setStatusMessage('');
        setError(message || 'Failed to poll portrait job status.');
      }
    },
    [clearJobPolling, isTauriEnv, refreshQueue],
  );

  const startJobPolling = useCallback(
    (id) => {
      if (!id) return;
      jobIdRef.current = id;
      setJobId(id);
      setJobProgress(0);
      setJobStage('');
      setQueuePosition(null);
      setQueueEtaSeconds(null);
      setStatusMessage('Tracking portrait job...');
      setError('');
      clearJobPolling();
      pollJobStatus(id);
    },
    [clearJobPolling, pollJobStatus],
  );

  const cancelFromQueue = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke('cancel_job', { jobId: id });
      } catch (err) {
        console.warn('Failed to cancel portrait job', err);
      } finally {
        refreshQueue();
      }
    },
    [refreshQueue],
  );

  const handleQueuePortrait = useCallback(
    async (event) => {
      event.preventDefault();
      if (!isTauriEnv) {
        setError('DND Portrait Maker is only available in the desktop shell for now.');
        setStatusMessage('');
        return;
      }

      setError('');
      setStatusMessage('Queuing portrait job...');

      try {
        const id = await invoke('queue_dnd_portrait_job', {
          prompt,
          negativePrompt,
          characterName,
          characterClass,
          stylePreset,
          lighting,
        });
        const numericId = typeof id === 'number' ? id : Number.parseInt(id, 10);
        const resolvedId = Number.isNaN(numericId) ? id : numericId;
        startJobPolling(resolvedId);
        refreshQueue();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Portrait job queue is not available yet.');
        setStatusMessage('');
      }
    },
    [
      characterClass,
      characterName,
      isTauriEnv,
      lighting,
      negativePrompt,
      prompt,
      refreshQueue,
      startJobPolling,
      stylePreset,
    ],
  );

  const queueDisabled = loading || !prompt.trim();

  return (
    <>
      <BackButton />
      <h1>DND Portrait Maker</h1>

      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <span className="card-caption" style={{ fontWeight: 600 }}>
            {jobId ? 'Rendering in progress' : 'Ready to generate a new portrait'}
          </span>
          {statusMessage && (
            <span className="card-caption" style={{ color: 'var(--accent)' }}>
              {statusMessage}
            </span>
          )}
          {error && (
            <span className="card-caption" style={{ color: 'var(--danger)', maxWidth: '520px' }}>
              {error}
            </span>
          )}
          {!isTauriEnv && !loading && (
            <span className="card-caption" style={{ maxWidth: '520px' }}>
              Desktop mode unlocks rendering with ComfyUI. Configure prompts here and we will wire up
              the workflow shortly.
            </span>
          )}
        </div>
        <div className="card-caption" style={{ textAlign: 'right' }}>
          {jobId && (
            <>
              <div>Job id: {jobId}</div>
              {jobStage && <div>Stage: {jobStage}</div>}
              {queuePosition !== null && <div>Queue position: {queuePosition + 1}</div>}
              {queueEtaSeconds !== null && <div>ETA: {formatEta(queueEtaSeconds)}</div>}
              {jobProgress ? <div>{Math.round(jobProgress)}% complete</div> : null}
            </>
          )}
          {!jobId && <div>No active portrait job</div>}
        </div>
      </div>

      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />

      <form
        className="card"
        onSubmit={handleQueuePortrait}
        style={{
          display: 'grid',
          gap: '1.25rem',
          alignItems: 'start',
          width: 'min(95vw, 1100px)',
          margin: '1.5rem auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            Character name
            <input
              type="text"
              value={characterName}
              onChange={(event) => setCharacterName(event.target.value)}
              placeholder="E.g. Seraphina Nightbloom"
              className="input"
              style={{ padding: '0.9rem 1rem', borderRadius: '12px' }}
            />
          </label>
          <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            Class or role
            <input
              type="text"
              value={characterClass}
              onChange={(event) => setCharacterClass(event.target.value)}
              placeholder="E.g. Tiefling warlock"
              className="input"
              style={{ padding: '0.9rem 1rem', borderRadius: '12px' }}
            />
          </label>
          <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            Style preset
            <select
              value={stylePreset}
              onChange={(event) => setStylePreset(event.target.value)}
              className="input"
              style={{ padding: '0.9rem 1rem', borderRadius: '12px' }}
            >
              <option value="illustrated">Illustrated realism</option>
              <option value="watercolor">Painterly watercolor</option>
              <option value="comic">Bold comic inks</option>
              <option value="digital">High-fidelity digital</option>
            </select>
          </label>
          <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            Lighting mood
            <select
              value={lighting}
              onChange={(event) => setLighting(event.target.value)}
              className="input"
              style={{ padding: '0.9rem 1rem', borderRadius: '12px' }}
            >
              <option value="dramatic">Dramatic rim lighting</option>
              <option value="campfire">Warm campfire glow</option>
              <option value="arcane">Arcane ambient light</option>
              <option value="daylight">Natural daylight</option>
            </select>
          </label>
        </div>

        <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          Hero prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the hero, gear, expression, and cinematic tone."
            style={TEXTAREA_STYLE}
          />
        </label>

        <label className="card-caption" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          Negative prompt
          <textarea
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            placeholder="List traits or artifacts to avoid in the render."
            style={TEXTAREA_STYLE}
          />
        </label>

        <div
          className="card"
          style={{
            background: 'var(--card-bg-alt)',
            padding: '1.25rem',
            borderRadius: '16px',
            border: '1px dashed rgba(148, 163, 184, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <span className="card-caption" style={{ fontWeight: 600 }}>
            Pose and composition ideas
          </span>
          <span className="card-caption">
            Drop notes about framing, camera angle, or gesture references here. We will wire this into
            structured controls as the workflow matures.
          </span>
          <textarea
            placeholder="Three-quarter profile with spellcasting focus in frame..."
            style={{ ...TEXTAREA_STYLE, minHeight: '120px' }}
          />
        </div>

        <PrimaryButton type="submit" disabled={queueDisabled} loading={jobId !== null} loadingText="Queued">
          Queue portrait render
        </PrimaryButton>
      </form>

      <section
        className="card"
        style={{
          width: 'min(95vw, 1100px)',
          margin: '0 auto 1.5rem',
          padding: '1.5rem',
          display: 'grid',
          gap: '1rem',
        }}
      >
        <header>
          <h2 style={{ margin: 0 }}>Reference kit</h2>
          <p className="card-caption">
            Upload portrait inspirations, party crests, or mood boards to anchor the next iteration.
            Asset handling hooks will land in a follow-up PR.
          </p>
        </header>
        <div
          style={{
            minHeight: '140px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '14px',
            border: '1px dashed rgba(148, 163, 184, 0.4)',
            background: 'rgba(148, 163, 184, 0.08)',
            color: 'var(--muted)',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          Reference uploader coming soon.
        </div>
      </section>

      <section
        className="card"
        style={{
          width: 'min(95vw, 1100px)',
          margin: '0 auto 3rem',
          padding: '1.5rem',
          display: 'grid',
          gap: '1rem',
        }}
      >
        <header>
          <h2 style={{ margin: 0 }}>Latest outputs</h2>
          <p className="card-caption">
            Recent renders and in-progress portraits will appear here once the backend wiring is in
            place.
          </p>
        </header>
        <div
          style={{
            minHeight: '180px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '14px',
            border: '1px dashed rgba(148, 163, 184, 0.4)',
            background: 'rgba(148, 163, 184, 0.08)',
            color: 'var(--muted)',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          Portrait gallery placeholder.
        </div>
      </section>
    </>
  );
}
