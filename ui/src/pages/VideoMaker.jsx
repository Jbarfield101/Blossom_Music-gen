import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { fileSrc } from '../lib/paths.js';
import { useJobQueue } from '../lib/useJobQueue.js';

const STATUS_POLL_INTERVAL_MS = 5000;
const JOB_POLL_INTERVAL_MS = 1500;
const DEFAULT_FILE_PREFIX = 'VideoMaker';
const DEFAULT_FPS = '12';
const TEXTAREA_BASE_STYLE = Object.freeze({
  width: 'min(95vw, 1100px)',
  padding: '1.1rem',
  borderRadius: '14px',
  border: '1px solid rgba(15, 23, 42, 0.2)',
  background: 'var(--card-bg)',
  color: 'var(--text)',
  resize: 'vertical',
  boxShadow: 'inset 0 2px 6px rgba(15, 23, 42, 0.08)',
});

function dedupeOutputs(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const key = typeof item.path === 'string' && item.path ? item.path : item.filename;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractPromptField(result, key) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const direct = result[key];
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }
  const altKey = key.replace(/([A-Z])/g, '_').toLowerCase();
  const fallback = result[altKey];
  if (typeof fallback === 'string' || typeof fallback === 'number') {
    return String(fallback);
  }
  return '';
}

function isVideoPath(path) {
  if (typeof path !== 'string') return false;
  const lower = path.toLowerCase();
  return ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.gif'].some((ext) => lower.endsWith(ext));
}

export default function VideoMaker() {
  const location = useLocation();
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : '';
  const navPromptRef = useRef(initialPrompt);
  const statusIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const jobIdRef = useRef(null);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [filePrefix, setFilePrefix] = useState(DEFAULT_FILE_PREFIX);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState(null);
  const [autoLaunch, setAutoLaunch] = useState(true);

  const [comfyStatus, setComfyStatus] = useState({ running: false, pending: 0, runningCount: 0 });
  const [statusError, setStatusError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState('');
  const [renderError, setRenderError] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState('');
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);

  const [videoOutputs, setVideoOutputs] = useState([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

  const formatEta = useCallback((value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '';
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, []);

  const cancelFromQueue = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke('cancel_job', { jobId: id });
      } catch (err) {
        console.warn('Failed to cancel job', err);
      } finally {
        refreshQueue();
      }
    },
    [refreshQueue],
  );

  const buildVideoEntry = useCallback((name, path) => {
    if (!path) {
      return { filename: name, path: '', src: '' };
    }
    let src = '';
    try {
      src = fileSrc(path);
    } catch (err) {
      console.warn('Failed to resolve video path', path, err);
      src = '';
    }
    return { filename: name, path, src };
  }, []);

  const loadVideoOutputs = useCallback(async () => {
    if (!isTauriEnv) return;
    setOutputsLoading(true);
    try {
      const result = await invoke('video_maker_output_files', { limit: 12 });
      const entries = Array.isArray(result) ? result : [];
      const filtered = entries
        .map((entry) => {
          const path = typeof entry?.path === 'string' ? entry.path : '';
          if (!path || !isVideoPath(path)) {
            return null;
          }
          const name =
            (typeof entry?.name === 'string' && entry.name) ||
            path.split(/[\\/]/).pop() ||
            path;
          return { filename: name, path };
        })
        .filter(Boolean);
      const deduped = dedupeOutputs(filtered);
      const hydrated = deduped.map((item) => buildVideoEntry(item.filename, item.path));
      setVideoOutputs(hydrated);
    } catch (err) {
      console.warn('Failed to load Video Maker outputs', err);
    } finally {
      setOutputsLoading(false);
    }
  }, [buildVideoEntry, isTauriEnv]);

  const refreshStatus = useCallback(
    async (ensureLaunch = false) => {
      if (!isTauriEnv) return;
      try {
        if (ensureLaunch) {
          setIsLaunching(true);
        }
        const result = await invoke('comfyui_status', { ensureRunning: ensureLaunch });
        if (!result) return;
        setComfyStatus({
          running: Boolean(result.running),
          pending: Number(result.pending || 0),
          runningCount: Number(result.runningCount || 0),
        });
        setStatusError('');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusError(message);
        setComfyStatus((prev) => ({ ...prev, running: false }));
      } finally {
        setIsLaunching(false);
      }
    },
    [isTauriEnv],
  );

  const loadComfySettings = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const settings = await invoke('get_comfyui_settings');
      setComfySettings(settings);
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv]);

  const updateComfySettings = useCallback(async (update) => {
    if (!isTauriEnv) return;
    try {
      const settings = await invoke('update_comfyui_settings', { update });
      setComfySettings(settings);
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv]);

  const clearJobPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const tauri = await isTauri();
        if (cancelled) return;
        setIsTauriEnv(tauri);
        if (!tauri) {
          setError('Video Maker workflow editing is only available in the desktop shell.');
          setLoading(false);
          return;
        }

        const promptsResult = await invoke('get_video_maker_prompts');
        if (cancelled) return;
        const fetchedPrompt = extractPromptField(promptsResult, 'prompt');
        const fetchedNegative = extractPromptField(promptsResult, 'negativePrompt');
        const fetchedPrefix = extractPromptField(promptsResult, 'fileNamePrefix');
        const fetchedFps =
          extractPromptField(promptsResult, 'fps') || extractPromptField(promptsResult, 'framesPerSecond');
        const cardPrompt = (navPromptRef.current || '').trim();
        setPrompt(cardPrompt || fetchedPrompt);
        navPromptRef.current = '';
        setNegativePrompt(fetchedNegative);
        setFilePrefix(fetchedPrefix || DEFAULT_FILE_PREFIX);
        setFps(fetchedFps || DEFAULT_FPS);
        setError('');
        setStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || 'Failed to load Video Maker workflow prompts.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadInitial();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!comfySettings) return;
    setAutoLaunch(comfySettings.auto_launch ?? true);
  }, [comfySettings]);

  useEffect(() => {
    if (!isTauriEnv) return undefined;
    let cancelled = false;

    (async () => {
      await loadComfySettings();
      if (cancelled) return;
      await refreshStatus(false);
      if (cancelled) return;
      await loadVideoOutputs();
      if (cancelled) return;
      statusIntervalRef.current = setInterval(() => {
        refreshStatus(false);
      }, STATUS_POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
      clearJobPolling();
      jobIdRef.current = null;
    };
  }, [clearJobPolling, isTauriEnv, loadComfySettings, loadVideoOutputs, refreshStatus]);

  const pollJobStatus = useCallback(
    async (id) => {
      if (!id || jobIdRef.current !== id) return;
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
        setRenderStatus(progressInfo.message || '');
        setQueuePosition(
          typeof progressInfo.queue_position === 'number' ? progressInfo.queue_position : null,
        );
        setQueueEtaSeconds(
          typeof progressInfo.queue_eta_seconds === 'number' ? progressInfo.queue_eta_seconds : null,
        );
        refreshQueue();

        if (status === 'queued' || status === 'running') {
          setRendering(true);
          clearJobPolling();
          pollIntervalRef.current = setTimeout(() => {
            pollJobStatus(id);
          }, JOB_POLL_INTERVAL_MS);
          return;
        }

        clearJobPolling();
        setRendering(false);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        jobIdRef.current = null;
        setJobId(null);
        setCurrentJobId(String(id));

        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        const videoArtifacts = artifacts.filter((artifact) => {
          const path = artifact?.path;
          return typeof path === 'string' && isVideoPath(path);
        });

        const outputs = [];
        for (const artifact of videoArtifacts) {
          const path = artifact.path;
          outputs.push({
            filename:
              (typeof artifact.name === 'string' && artifact.name) ||
              path.split(/[\\/]/).pop() ||
              path,
            path,
          });
        }

        if (outputs.length === 0) {
          try {
            const fallback = await invoke('video_maker_output_files', { limit: 8 });
            if (Array.isArray(fallback)) {
              fallback.forEach((entry) => {
                if (typeof entry?.path !== 'string') return;
                const path = entry.path;
                if (!isVideoPath(path)) return;
                const name =
                  (typeof entry?.name === 'string' && entry.name) ||
                  path.split(/[\\/]/).pop() ||
                  path;
                outputs.push({ filename: name, path });
              });
            }
          } catch (err) {
            console.warn('Failed to enumerate Video Maker outputs', err);
          }
        }

        const deduped = dedupeOutputs(outputs);
        const resolved = deduped.map((output) => buildVideoEntry(output.filename, output.path));
        setVideoOutputs(resolved);

        const cancelled = status === 'cancelled' || Boolean(data?.cancelled);
        if (status === 'completed') {
          setRenderStatus(progressInfo.message || 'Video Maker render complete.');
          setRenderError('');
        } else if (cancelled) {
          setRenderStatus('Video Maker job cancelled.');
          setRenderError('');
        } else {
          const stderrLines = Array.isArray(data?.stderr) ? data.stderr : [];
          let lastError = typeof data?.message === 'string' ? data.message.trim() : '';
          for (let i = stderrLines.length - 1; i >= 0 && !lastError; i -= 1) {
            const line = stderrLines[i];
            if (typeof line === 'string' && line.trim()) {
              lastError = line.trim();
            }
          }
          if (!lastError) {
            lastError = 'Video Maker job failed.';
          }
          setRenderStatus('');
          setRenderError(lastError);
        }

        refreshStatus(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRenderError(message);
        setRendering(false);
        clearJobPolling();
        refreshStatus(false);
      }
    },
    [buildVideoEntry, clearJobPolling, refreshQueue, refreshStatus],
  );

  const startJobPolling = useCallback(
    (id) => {
      if (!id) return;
      clearJobPolling();
      jobIdRef.current = id;
      pollIntervalRef.current = setTimeout(() => {
        pollJobStatus(id);
      }, 50);
    },
    [clearJobPolling, pollJobStatus],
  );

  const persistPrompts = useCallback(
    async (silent = false) => {
      if (!isTauriEnv) {
        setError('Saving prompts requires the desktop app.');
        return false;
      }

      setStatusMessage('');
      setError('');

      const cleanedPrompt = prompt.trim();
      const cleanedNegative = negativePrompt.trim();
      const cleanedFilePrefix = filePrefix.trim() || DEFAULT_FILE_PREFIX;
      const cleanedFps = fps.trim();

      if (!cleanedPrompt) {
        setError('Prompt cannot be empty.');
        return false;
      }

      const parsedFps = Number.parseFloat(cleanedFps);
      if (!Number.isFinite(parsedFps) || parsedFps <= 0) {
        setError('FPS must be a positive number.');
        return false;
      }

      const payload = {
        prompt: cleanedPrompt,
        negativePrompt: cleanedNegative,
        fileNamePrefix: cleanedFilePrefix,
        fps: parsedFps,
      };

      setSaving(true);
      try {
        const result = await invoke('update_video_maker_prompts', { payload });
        const savedPrompt = extractPromptField(result, 'prompt') || cleanedPrompt;
        const savedNegative = extractPromptField(result, 'negativePrompt') || cleanedNegative;
        const savedPrefix = extractPromptField(result, 'fileNamePrefix') || cleanedFilePrefix;
        const savedFps =
          extractPromptField(result, 'fps') || extractPromptField(result, 'framesPerSecond') || String(parsedFps);

        setPrompt(savedPrompt);
        setNegativePrompt(savedNegative);
        setFilePrefix(savedPrefix);
        setFps(savedFps);
        if (!silent) {
          setStatusMessage('Workflow prompt settings updated.');
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Failed to update Video Maker workflow.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [filePrefix, fps, isTauriEnv, negativePrompt, prompt],
  );

  const handleRender = useCallback(async () => {
    if (!isTauriEnv || rendering) return;
    setRenderStatus('Queuing Video Maker job...');
    setRenderError('');
    setVideoOutputs([]);
    setJobProgress(0);
    setJobStage('queued');
    setCurrentJobId('');

    const persisted = await persistPrompts(true);
    if (!persisted) {
      setRenderStatus('');
      return;
    }

    try {
      const id = await invoke('queue_video_maker_job');
      if (typeof id !== 'number' && typeof id !== 'string') {
        throw new Error('Unexpected response when queuing Video Maker job.');
      }
      const numericId = typeof id === 'number' ? id : Number.parseInt(id, 10);
      const resolvedId = Number.isNaN(numericId) ? id : numericId;
      setJobId(resolvedId);
      setRendering(true);
      setRenderStatus('Job queued. Tracking progress...');
      refreshQueue();
      await refreshStatus(true);
      startJobPolling(resolvedId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message || 'Failed to queue Video Maker job.');
      setRenderStatus('');
      setRendering(false);
    }
  }, [isTauriEnv, persistPrompts, refreshQueue, refreshStatus, rendering, startJobPolling]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const saved = await persistPrompts(false);
    if (saved) {
      refreshStatus(false);
    }
  };

  const handleImageUpload = useCallback(
    async (event) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (!file) return;
      if (!isTauriEnv) {
        setError('Uploading reference images requires the desktop app.');
        if (input) {
          input.value = '';
        }
        return;
      }

      setUploading(true);
      setStatusMessage('');
      setError('');

      try {
        const buffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        await invoke('upload_video_maker_image', {
          filename: file.name,
          bytes,
        });
        setStatusMessage(`Uploaded ${file.name} as reference image.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Failed to upload reference image.');
      } finally {
        setUploading(false);
        if (input) {
          input.value = '';
        }
      }
    },
    [isTauriEnv],
  );

  const disabled = loading || saving;
  const fpsValue = Number.parseFloat(fps.trim());
  const fpsValid = fps.trim().length > 0 && Number.isFinite(fpsValue) && fpsValue > 0;
  const submitDisabled = disabled || !isTauriEnv || !prompt.trim() || !fpsValid;
  const renderDisabled = !isTauriEnv || rendering;

  return (
    <>
      <BackButton />
      <h1>Video Maker</h1>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1.25rem',
        }}
      >
        <span className="card-caption" style={{ fontWeight: 600 }}>
          Status: {comfyStatus.running ? 'Online' : 'Offline'}{' '}
          {comfyStatus.pending > 0 && `Pending tasks: ${comfyStatus.pending}`}{' '}
          {comfyStatus.runningCount > 0 && `Running: ${comfyStatus.runningCount}`}
        </span>
        {statusError && (
          <span className="card-caption" style={{ color: 'var(--accent)' }}>{statusError}</span>
        )}
        <button
          type="button"
          className="back-button"
          onClick={() => refreshStatus(true)}
          disabled={!isTauriEnv || isLaunching}
        >
          {isLaunching ? 'Starting...' : 'Activate'}
        </button>
        <button
          type="button"
          className="back-button"
          onClick={async () => {
            const next = !autoLaunch;
            setAutoLaunch(next);
            await updateComfySettings({ autoLaunch: next });
          }}
          disabled={!isTauriEnv}
        >
          Auto-launch: {autoLaunch ? 'On' : 'Off'}
        </button>
        {jobId && (
          <span className="card-caption">
            Active job id: {jobId}
            {queuePosition !== null && ` · Queue position ${queuePosition + 1}`}
            {queueEtaSeconds !== null && ` · ETA ${formatEta(queueEtaSeconds)}`}
            {jobProgress ? ` · ${Math.round(jobProgress)}%` : ''}
          </span>
        )}
        {currentJobId && <span className="card-caption">Last job id: {currentJobId}</span>}
      </div>

      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />

      <form
        className="card"
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gap: '1.25rem',
          alignItems: 'start',
          width: 'min(95vw, 1200px)',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label htmlFor="video-maker-prefix" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Filename Prefix</span>
            <input
              id="video-maker-prefix"
              type="text"
              value={filePrefix}
              onChange={(event) => setFilePrefix(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '320px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="video-maker-fps" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Frames per Second</span>
            <input
              id="video-maker-fps"
              type="number"
              min="1"
              step="0.1"
              value={fps}
              onChange={(event) => setFps(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '200px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="video-maker-reference" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Reference Image</span>
            <input
              id="video-maker-reference"
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              disabled={!isTauriEnv || uploading}
              style={{
                maxWidth: '260px',
                width: '100%',
              }}
            />
            {uploading && <span className="card-caption">Uploading...</span>}
          </label>
        </div>
        <label htmlFor="video-maker-prompt" className="form-label">
          Prompt
        </label>
        <textarea
          id="video-maker-prompt"
          placeholder="Describe the story you want to render..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={10}
          style={{
            ...TEXTAREA_BASE_STYLE,
            minHeight: '18rem',
            fontSize: '1.05rem',
            lineHeight: 1.6,
          }}
          disabled={disabled}
        />
        <label htmlFor="video-maker-negative" className="form-label">
          Negative Prompt
        </label>
        <textarea
          id="video-maker-negative"
          placeholder="Optional negative prompt"
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          rows={6}
          style={{
            ...TEXTAREA_BASE_STYLE,
            minHeight: '12rem',
            fontSize: '1.0rem',
            lineHeight: 1.5,
          }}
          disabled={disabled}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <PrimaryButton
            type="submit"
            className="mt-sm"
            loading={saving}
            loadingText="Saving prompts..."
            disabled={submitDisabled}
          >
            Save Prompts
          </PrimaryButton>
          <PrimaryButton
            type="button"
            className="mt-sm"
            loading={rendering}
            loadingText="Rendering..."
            disabled={renderDisabled}
            onClick={handleRender}
          >
            Render via ComfyUI
          </PrimaryButton>
        </div>
      </form>

      {(statusMessage || renderStatus || jobId || jobStage || queuePosition !== null) && (
        <div className="card" role="status">
          {statusMessage && <p className="card-caption">{statusMessage}</p>}
          {renderStatus && <p className="card-caption">{renderStatus}</p>}
          {(jobId || jobStage || jobProgress || queuePosition !== null || queueEtaSeconds !== null) && (
            <p className="card-caption">
              {jobId && `Job ${jobId}`}
              {jobStage && ` · ${jobStage}`}
              {jobProgress ? ` · ${Math.round(jobProgress)}%` : ''}
              {queuePosition !== null && ` · Queue position ${queuePosition + 1}`}
              {queueEtaSeconds !== null && ` · ETA ${formatEta(queueEtaSeconds)}`}
            </p>
          )}
        </div>
      )}

      {(error || renderError) && (
        <div className="card" role="alert" style={{ border: '1px solid var(--accent)', marginTop: '1rem' }}>
          {error && <p className="card-caption" style={{ color: 'var(--accent)' }}>{error}</p>}
          {renderError && <p className="card-caption" style={{ color: 'var(--accent)' }}>{renderError}</p>}
        </div>
      )}

      <section className="card" style={{ display: 'grid', gap: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <h2>Recent Videos</h2>
          <PrimaryButton
            type="button"
            className="mt-sm"
            onClick={loadVideoOutputs}
            loading={outputsLoading}
            loadingText="Refreshing..."
            disabled={!isTauriEnv}
          >
            Refresh
          </PrimaryButton>
        </div>
        {videoOutputs.length === 0 ? (
          <p className="card-caption">
            Videos rendered through ComfyUI will appear here once a job finishes.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1rem',
            }}
          >
            {videoOutputs.map((output, index) => (
              <figure
                key={`${output.path ?? 'video'}-${index}`}
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  border: '1px solid rgba(15, 23, 42, 0.12)',
                  background: 'var(--card-bg)',
                  padding: '0.5rem',
                }}
              >
                {output.src ? (
                  <video
                    src={output.src}
                    controls
                    loop
                    muted
                    style={{ width: '100%', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.08)' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      padding: '2rem 0',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(15, 23, 42, 0.04)',
                      borderRadius: '8px',
                    }}
                  >
                    <span className="card-caption">Preview unavailable</span>
                  </div>
                )}
                <figcaption className="card-caption" style={{ wordBreak: 'break-word' }}>
                  <strong>{output.filename}</strong>
                  {output.path && <div>{output.path}</div>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />
    </>
  );
}
