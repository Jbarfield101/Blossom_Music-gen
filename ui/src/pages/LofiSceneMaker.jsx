
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
const DEFAULT_FILE_PREFIX = 'LofiScene';

const SEED_BEHAVIOR_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'increment', label: 'Increment' },
  { value: 'decrement', label: 'Decrement' },
  { value: 'randomize', label: 'Randomize' },
];

const TEXTAREA_BASE_STYLE = Object.freeze({
  width: '100%',
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
  if (typeof direct === 'string') {
    return direct;
  }
  if (typeof direct === 'number') {
    return String(direct);
  }
  const snakeKey = key.replace(/([A-Z])/g, '_').toLowerCase();
  const fallback = result[snakeKey];
  if (typeof fallback === 'string') {
    return fallback;
  }
  if (typeof fallback === 'number') {
    return String(fallback);
  }
  return '';
}

function isImagePath(path) {
  if (typeof path !== 'string') return false;
  const lower = path.toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].some((ext) => lower.endsWith(ext));
}

export default function LofiSceneMaker() {
  const location = useLocation();
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : '';
  const navPromptRef = useRef(initialPrompt);
  const statusIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const jobIdRef = useRef(null);
  const previewUrlsRef = useRef(new Map());

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [filePrefix, setFilePrefix] = useState(DEFAULT_FILE_PREFIX);
  const [seed, setSeed] = useState('0');
  const [seedBehavior, setSeedBehavior] = useState('fixed');
  const [steps, setSteps] = useState('20');
  const [batchSize, setBatchSize] = useState('1');
  const [cfg, setCfg] = useState('2.5');
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

  const [imageOutputs, setImageOutputs] = useState([]);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [previewedOutput, setPreviewedOutput] = useState(null);

  useEffect(() => {
    if (!previewedOutput) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreviewedOutput(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewedOutput]);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

  const cleanupPreviews = useCallback(() => {
    for (const url of previewUrlsRef.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup errors
      }
    }
    previewUrlsRef.current.clear();
  }, []);

  useEffect(() => () => {
    cleanupPreviews();
  }, [cleanupPreviews]);

  const buildImageEntry = useCallback(
    async (name, path) => {
      if (!path) {
        return { filename: name, path: '', url: '' };
      }

      let fallbackUrl = '';
      try {
        fallbackUrl = fileSrc(path);
      } catch {
        fallbackUrl = '';
      }

      const inferMime = (p) => {
        const ext = p.split('.').pop()?.toLowerCase();
        switch (ext) {
          case 'png':
            return 'image/png';
          case 'jpg':
          case 'jpeg':
            return 'image/jpeg';
          case 'gif':
            return 'image/gif';
          case 'webp':
            return 'image/webp';
          case 'bmp':
            return 'image/bmp';
          case 'svg':
            return 'image/svg+xml';
          default:
            return 'application/octet-stream';
        }
      };

      try {
        const bytes = await invoke('read_file_bytes', { path });
        const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const blob = new Blob([array], { type: inferMime(path) });
        const objectUrl = URL.createObjectURL(blob);
        previewUrlsRef.current.set(path, objectUrl);
        return { filename: name, path, url: objectUrl };
      } catch (err) {
        console.warn('Failed to build preview for image output', path, err);
        return { filename: name, path, url: fallbackUrl };
      }
    },
    [],
  );

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

  const loadImageOutputs = useCallback(async () => {
    if (!isTauriEnv) return;
    setOutputsLoading(true);
    try {
      const result = await invoke('lofi_scene_output_files', { limit: 12 });
      const entries = Array.isArray(result) ? result : [];
      const filtered = entries
        .map((entry) => {
          const path = typeof entry?.path === 'string' ? entry.path : '';
          if (!path || !isImagePath(path)) {
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
      cleanupPreviews();
      const hydrated = [];
      for (const item of deduped) {
        hydrated.push(await buildImageEntry(item.filename, item.path));
      }
      setImageOutputs(hydrated);
    } catch (err) {
      console.warn('Failed to load Lofi Scene Maker outputs', err);
    } finally {
      setOutputsLoading(false);
    }
  }, [buildImageEntry, cleanupPreviews, isTauriEnv]);

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
          setError('Lofi Scene Maker workflow editing is only available in the desktop shell.');
          setLoading(false);
          return;
        }

        const promptsResult = await invoke('get_lofi_scene_prompts');
        if (cancelled) return;
        const fetchedPrompt = extractPromptField(promptsResult, 'prompt');
        const fetchedNegative = extractPromptField(promptsResult, 'negativePrompt');
        const fetchedPrefix = extractPromptField(promptsResult, 'fileNamePrefix');
        const fetchedSeed = extractPromptField(promptsResult, 'seed');
        const fetchedSeedBehavior = extractPromptField(promptsResult, 'seedBehavior');
        const fetchedSteps = extractPromptField(promptsResult, 'steps');
        const fetchedCfg = extractPromptField(promptsResult, 'cfg');
        const fetchedBatchSize = extractPromptField(promptsResult, 'batchSize');
        const cardPrompt = (navPromptRef.current || '').trim();
        setPrompt(cardPrompt || fetchedPrompt);
        navPromptRef.current = '';
        setNegativePrompt(fetchedNegative);
        setFilePrefix(fetchedPrefix || DEFAULT_FILE_PREFIX);
        setSeed(fetchedSeed || '0');
        const behaviorNormalized = (fetchedSeedBehavior || 'fixed').toLowerCase();
        setSeedBehavior(
          SEED_BEHAVIOR_OPTIONS.some((option) => option.value === behaviorNormalized)
            ? behaviorNormalized
            : 'fixed',
        );
        setSteps(fetchedSteps || '20');
        setBatchSize(fetchedBatchSize || '1');
        setCfg(fetchedCfg || '2.5');
        setError('');
        setStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || 'Failed to load Lofi Scene Maker workflow prompts.');
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
      await loadImageOutputs();
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
      cleanupPreviews();
      clearJobPolling();
      jobIdRef.current = null;
    };
  }, [cleanupPreviews, clearJobPolling, isTauriEnv, loadComfySettings, loadImageOutputs, refreshStatus]);

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
          typeof progressInfo.queue_position === 'number'
            ? progressInfo.queue_position
            : null,
        );
        setQueueEtaSeconds(
          typeof progressInfo.queue_eta_seconds === 'number'
            ? progressInfo.queue_eta_seconds
            : null,
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
        const imageArtifacts = artifacts.filter((artifact) => {
          const path = artifact?.path;
          return typeof path === 'string' && isImagePath(path);
        });

        const outputs = [];
        for (const artifact of imageArtifacts) {
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
            const fallback = await invoke('lofi_scene_output_files', { limit: 8 });
            if (Array.isArray(fallback)) {
              fallback.forEach((entry) => {
                if (typeof entry?.path !== 'string') return;
                const path = entry.path;
                if (!isImagePath(path)) return;
                const name =
                  (typeof entry?.name === 'string' && entry.name) ||
                  path.split(/[\\/]/).pop() ||
                  path;
                outputs.push({ filename: name, path });
              });
            }
          } catch (err) {
            console.warn('Failed to enumerate Lofi Scene Maker outputs', err);
          }
        }

        cleanupPreviews();
        const resolved = [];
        for (const output of dedupeOutputs(outputs)) {
          resolved.push(await buildImageEntry(output.filename, output.path));
        }
        setImageOutputs(resolved);

        const cancelled = status === 'cancelled' || Boolean(data?.cancelled);
        if (status === 'completed') {
          setRenderStatus(progressInfo.message || 'ComfyUI render complete.');
          setRenderError('');
        } else if (cancelled) {
          setRenderStatus('Lofi Scene Maker job cancelled.');
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
            lastError = 'Lofi Scene Maker job failed.';
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
    [buildImageEntry, cleanupPreviews, clearJobPolling, refreshQueue, refreshStatus],
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
      const cleanedSeed = seed.trim();
      const normalizedSeedBehavior = seedBehavior.trim().toLowerCase();
      const cleanedSteps = steps.trim();
      const cleanedCfg = cfg.trim();
      const cleanedBatchSize = batchSize.trim();

      if (!cleanedPrompt) {
        setError('Prompt cannot be empty.');
        return false;
      }

      const parsedSeed = Number.parseInt(cleanedSeed, 10);
      if (!cleanedSeed || Number.isNaN(parsedSeed)) {
        setError('Seed must be an integer.');
        return false;
      }

      if (!SEED_BEHAVIOR_OPTIONS.some((option) => option.value === normalizedSeedBehavior)) {
        setError('Seed behavior must be Fixed, Increment, Decrement, or Randomize.');
        return false;
      }

      const parsedSteps = Number.parseFloat(cleanedSteps);
      if (!Number.isFinite(parsedSteps) || parsedSteps <= 0) {
        setError('Steps must be a positive number.');
        return false;
      }

      const parsedCfg = Number.parseFloat(cleanedCfg);
      if (!Number.isFinite(parsedCfg) || parsedCfg <= 0) {
        setError('CFG must be a positive number.');
        return false;
      }

      const parsedBatchSize = Number.parseInt(cleanedBatchSize, 10);
      if (!cleanedBatchSize || Number.isNaN(parsedBatchSize) || parsedBatchSize <= 0) {
        setError('Batch size must be a positive integer.');
        return false;
      }

      const payload = {
        prompt: cleanedPrompt,
        negativePrompt: cleanedNegative,
        fileNamePrefix: cleanedFilePrefix,
        seed: parsedSeed,
        seedBehavior: normalizedSeedBehavior,
        steps: parsedSteps,
        cfg: parsedCfg,
        batchSize: parsedBatchSize,
      };

      setSaving(true);
      try {
        const result = await invoke('update_lofi_scene_prompts', { payload });
        const savedPrompt = extractPromptField(result, 'prompt') || cleanedPrompt;
        const savedNegative = extractPromptField(result, 'negativePrompt') || cleanedNegative;
        const savedPrefix = extractPromptField(result, 'fileNamePrefix') || cleanedFilePrefix;
        const savedSeed = extractPromptField(result, 'seed') || String(parsedSeed);
        const savedSeedBehavior =
          extractPromptField(result, 'seedBehavior') || normalizedSeedBehavior;
        const savedSteps = extractPromptField(result, 'steps') || String(parsedSteps);
        const savedCfg = extractPromptField(result, 'cfg') || String(parsedCfg);
        const savedBatchSize =
          extractPromptField(result, 'batchSize') || String(parsedBatchSize);

        setPrompt(savedPrompt);
        setNegativePrompt(savedNegative);
        setFilePrefix(savedPrefix);
        setSeed(savedSeed);
        const savedBehaviorNormalized = savedSeedBehavior.toLowerCase();
        setSeedBehavior(
          SEED_BEHAVIOR_OPTIONS.some((option) => option.value === savedBehaviorNormalized)
            ? savedBehaviorNormalized
            : normalizedSeedBehavior,
        );
        setSteps(savedSteps);
        setCfg(savedCfg);
        setBatchSize(savedBatchSize);
        if (!silent) {
          setStatusMessage('Workflow prompt settings updated.');
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Failed to update Lofi Scene Maker workflow.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      batchSize,
      cfg,
      filePrefix,
      isTauriEnv,
      negativePrompt,
      prompt,
      seed,
      seedBehavior,
      steps,
    ],
  );

  const handleRender = useCallback(async () => {
    if (!isTauriEnv || rendering) return;
    setRenderStatus('Queuing Lofi Scene Maker job...');
    setRenderError('');
    setImageOutputs([]);
    setJobProgress(0);
    setJobStage('queued');
    setCurrentJobId('');

    const persisted = await persistPrompts(true);
    if (!persisted) {
      setRenderStatus('');
      return;
    }

    try {
      const id = await invoke('queue_lofi_scene_job');
      if (typeof id !== 'number' && typeof id !== 'string') {
        throw new Error('Unexpected response when queuing Lofi Scene Maker job.');
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
      setRenderError(message || 'Failed to queue Lofi Scene Maker job.');
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

  const disabled = loading || saving;
  const seedValid = seed.trim().length > 0 && Number.isFinite(Number.parseInt(seed.trim(), 10));
  const behaviorValid = SEED_BEHAVIOR_OPTIONS.some(
    (option) => option.value === seedBehavior.trim().toLowerCase(),
  );
  const stepsValue = Number.parseFloat(steps.trim());
  const stepsValid = steps.trim().length > 0 && Number.isFinite(stepsValue) && stepsValue > 0;
  const cfgValue = Number.parseFloat(cfg.trim());
  const cfgValid = cfg.trim().length > 0 && Number.isFinite(cfgValue) && cfgValue > 0;
  const batchSizeValue = Number.parseInt(batchSize.trim(), 10);
  const batchSizeValid =
    batchSize.trim().length > 0 && Number.isFinite(batchSizeValue) && batchSizeValue > 0;
  const submitDisabled =
    disabled ||
    !isTauriEnv ||
    !prompt.trim() ||
    !seedValid ||
    !behaviorValid ||
    !stepsValid ||
    !cfgValid ||
    !batchSizeValid;
  const renderDisabled = !isTauriEnv || rendering;

  return (
    <>
      <BackButton />
      <h1>Lofi Scene Maker</h1>

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
          <label htmlFor="lofi-scene-prefix" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Filename Prefix</span>
            <input
              id="lofi-scene-prefix"
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
          <label htmlFor="lofi-scene-seed" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Seed</span>
            <input
              id="lofi-scene-seed"
              type="number"
              step="1"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
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
          <label htmlFor="lofi-seed-behavior" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Seed Behavior</span>
            <select
              id="lofi-seed-behavior"
              value={seedBehavior}
              onChange={(event) => setSeedBehavior(event.target.value)}
              disabled={disabled}
              style={{
                minWidth: '160px',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            >
              {SEED_BEHAVIOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="lofi-scene-steps" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Steps</span>
            <input
              id="lofi-scene-steps"
              type="number"
              min="1"
              step="1"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '160px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="lofi-scene-batch-size" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Batch Size</span>
            <input
              id="lofi-scene-batch-size"
              type="number"
              min="1"
              step="1"
              value={batchSize}
              onChange={(event) => setBatchSize(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '160px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="lofi-scene-cfg" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>CFG</span>
            <input
              id="lofi-scene-cfg"
              type="number"
              min="0"
              step="0.05"
              value={cfg}
              onChange={(event) => setCfg(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '160px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          {comfyStatus.pending > 0 && (
            <span className="card-caption" style={{ fontWeight: 600 }}>
              Pending ComfyUI tasks: {comfyStatus.pending}
            </span>
          )}
        </div>
        <label htmlFor="lofi-scene-prompt" className="form-label">
          Prompt
        </label>
        <textarea
          id="lofi-scene-prompt"
          placeholder="Describe the scene you want to render..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={10}
          style={{
            ...TEXTAREA_BASE_STYLE,
            width: 'min(95vw, 1100px)',
            minHeight: '18rem',
            fontSize: '1.05rem',
            lineHeight: 1.6,
          }}
          disabled={disabled}
        />
        <label htmlFor="lofi-scene-negative" className="form-label">
          Negative Prompt
        </label>
        <textarea
          id="lofi-scene-negative"
          placeholder="Optional negative prompt"
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          rows={6}
          style={{
            ...TEXTAREA_BASE_STYLE,
            width: 'min(95vw, 1100px)',
            minHeight: '12rem',
            fontSize: '1.0rem',
            lineHeight: 1.5,
          }}
          disabled={disabled}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <PrimaryButton type="submit" className="mt-sm" loading={saving} loadingText="Saving prompts..." disabled={submitDisabled}>
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
          <h2>Recent Images</h2>
          <PrimaryButton
            type="button"
            className="mt-sm"
            onClick={loadImageOutputs}
            loading={outputsLoading}
            loadingText="Refreshing..."
            disabled={!isTauriEnv}
          >
            Refresh
          </PrimaryButton>
        </div>
        {imageOutputs.length === 0 ? (
          <p className="card-caption">
            Images rendered through ComfyUI will appear here once a job finishes.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '1rem',
            }}
          >
            {imageOutputs.map((output, index) => (
              <figure
                key={`${output.path ?? 'image'}-${index}`}
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
                {output.url ? (
                  <button
                    type="button"
                    onClick={() => setPreviewedOutput(output)}
                    style={{
                      border: 'none',
                      padding: 0,
                      background: 'transparent',
                      cursor: 'zoom-in',
                      width: '100%',
                      display: 'block',
                    }}
                  >
                    <img
                      src={output.url}
                      alt={output.filename}
                      style={{ width: '100%', height: 'auto', borderRadius: '8px', display: 'block' }}
                    />
                  </button>
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

      {previewedOutput && (
        <div
          role="presentation"
          onClick={() => setPreviewedOutput(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'grid',
            placeItems: 'center',
            padding: '2rem',
            zIndex: 1000,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={previewedOutput.filename}
            onClick={(event) => event.stopPropagation()}
            style={{
              maxWidth: 'min(90vw, 1200px)',
              maxHeight: '90vh',
              display: 'grid',
              gap: '0.75rem',
              background: 'var(--card-bg)',
              padding: '1rem',
              borderRadius: '12px',
              boxShadow: '0 12px 40px rgba(15, 23, 42, 0.4)',
            }}
          >
            <img
              src={previewedOutput.url}
              alt={previewedOutput.filename}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                borderRadius: '8px',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-caption" style={{ wordBreak: 'break-word' }}>
                <strong>{previewedOutput.filename}</strong>
                {previewedOutput.path && <div>{previewedOutput.path}</div>}
              </div>
              <PrimaryButton type="button" onClick={() => setPreviewedOutput(null)}>
                Close
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
