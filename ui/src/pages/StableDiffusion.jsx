import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { fileSrc } from '../lib/paths.js';
import { useJobQueue } from '../lib/useJobQueue.js';

const WORKFLOW_PATH = 'assets/workflows/stable_audio.json';
const STATUS_POLL_INTERVAL_MS = 5000;
const JOB_POLL_INTERVAL_MS = 1500;
const DEFAULT_FILE_PREFIX = 'audio/ComfyUI';
const DEFAULT_SECONDS = '120';

const PROMPT_TEMPLATE_FIELDS = [
  { key: 'format', label: 'Format' },
  { key: 'genre', label: 'Genre' },
  { key: 'subGenre', label: 'Sub-Genre' },
  { key: 'instruments', label: 'Instruments' },
  { key: 'mood', label: 'Mood' },
  { key: 'style', label: 'Style' },
  { key: 'tempoDescriptor', label: 'Tempo Descriptor' },
  { key: 'bpm', label: 'BPM' },
];

const DEFAULT_PROMPT_BUILDER_VALUES = Object.freeze({
  format: 'Song',
  genre: 'Electronic',
  subGenre: 'Synthwave',
  instruments: 'Analog polysynths, punchy drum machines, warm bass guitar, airy pads',
  mood: 'Uplifting and nostalgic with a confident energy',
  style: 'Cinematic retro-futuristic production with modern polish',
  tempoDescriptor: 'Driving four-on-the-floor groove with shimmering textures',
  bpm: '118',
});

const LABEL_TO_FIELD_KEY = PROMPT_TEMPLATE_FIELDS.reduce((map, field) => {
  map[field.label.toLowerCase()] = field.key;
  return map;
}, {});

function composeStableAudioPrompt(values) {
  return PROMPT_TEMPLATE_FIELDS.map(({ key, label }) => `${label}: ${values[key] ?? ''}`).join('\n');
}

function parseStableAudioPrompt(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ...DEFAULT_PROMPT_BUILDER_VALUES };
  }

  const result = { ...DEFAULT_PROMPT_BUILDER_VALUES };
  const lines = text.split(/\r?\n/);

  lines.forEach((line) => {
    if (!line) return;
    const [rawLabel, ...rest] = line.split(':');
    if (!rawLabel || rest.length === 0) return;
    const label = rawLabel.trim().toLowerCase();
    const key = LABEL_TO_FIELD_KEY[label];
    if (!key) return;
    const value = rest.join(':').trim();
    result[key] = value;
  });

  return result;
}

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

export default function StableDiffusion() {
  const location = useLocation();
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : '';
  const navPromptRef = useRef(initialPrompt);
  const statusIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const jobIdRef = useRef(null);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [filePrefix, setFilePrefix] = useState(DEFAULT_FILE_PREFIX);
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateName, setTemplateName] = useState('');
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
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState('');
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);

  const [isPromptBuilderActive, setIsPromptBuilderActive] = useState(false);
  const [builderFormat, setBuilderFormat] = useState(DEFAULT_PROMPT_BUILDER_VALUES.format);
  const [builderGenre, setBuilderGenre] = useState(DEFAULT_PROMPT_BUILDER_VALUES.genre);
  const [builderSubGenre, setBuilderSubGenre] = useState(DEFAULT_PROMPT_BUILDER_VALUES.subGenre);
  const [builderInstruments, setBuilderInstruments] = useState(DEFAULT_PROMPT_BUILDER_VALUES.instruments);
  const [builderMood, setBuilderMood] = useState(DEFAULT_PROMPT_BUILDER_VALUES.mood);
  const [builderStyle, setBuilderStyle] = useState(DEFAULT_PROMPT_BUILDER_VALUES.style);
  const [builderTempoDescriptor, setBuilderTempoDescriptor] = useState(DEFAULT_PROMPT_BUILDER_VALUES.tempoDescriptor);
  const [builderBpm, setBuilderBpm] = useState(DEFAULT_PROMPT_BUILDER_VALUES.bpm);

  const builderUpdateRef = useRef(false);

  const applyBuilderValues = useCallback((values) => {
    setBuilderFormat(values.format ?? DEFAULT_PROMPT_BUILDER_VALUES.format);
    setBuilderGenre(values.genre ?? DEFAULT_PROMPT_BUILDER_VALUES.genre);
    setBuilderSubGenre(values.subGenre ?? DEFAULT_PROMPT_BUILDER_VALUES.subGenre);
    setBuilderInstruments(values.instruments ?? DEFAULT_PROMPT_BUILDER_VALUES.instruments);
    setBuilderMood(values.mood ?? DEFAULT_PROMPT_BUILDER_VALUES.mood);
    setBuilderStyle(values.style ?? DEFAULT_PROMPT_BUILDER_VALUES.style);
    setBuilderTempoDescriptor(values.tempoDescriptor ?? DEFAULT_PROMPT_BUILDER_VALUES.tempoDescriptor);
    setBuilderBpm(values.bpm ?? DEFAULT_PROMPT_BUILDER_VALUES.bpm);
  }, []);

  useEffect(() => {
    if (!isPromptBuilderActive) {
      return;
    }
    if (builderUpdateRef.current) {
      builderUpdateRef.current = false;
      return;
    }
    applyBuilderValues(parseStableAudioPrompt(prompt));
  }, [prompt, isPromptBuilderActive, applyBuilderValues]);

  useEffect(() => {
    if (!isPromptBuilderActive) {
      return;
    }
    builderUpdateRef.current = true;
    setPrompt(
      composeStableAudioPrompt({
        format: builderFormat,
        genre: builderGenre,
        subGenre: builderSubGenre,
        instruments: builderInstruments,
        mood: builderMood,
        style: builderStyle,
        tempoDescriptor: builderTempoDescriptor,
        bpm: builderBpm,
      }),
    );
  }, [
    isPromptBuilderActive,
    builderFormat,
    builderGenre,
    builderSubGenre,
    builderInstruments,
    builderMood,
    builderStyle,
    builderTempoDescriptor,
    builderBpm,
    setPrompt,
  ]);

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

  useEffect(() => {
    if (!comfySettings) return;
    setAutoLaunch(comfySettings.auto_launch ?? true);
  }, [comfySettings]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const tauri = await isTauri();
        if (cancelled) return;
        setIsTauriEnv(tauri);
        if (!tauri) {
          setError('Stable Diffusion workflow editing is only available in the desktop shell.');
          setLoading(false);
          return;
        }

        const promptsResult = await invoke('get_stable_audio_prompts');
        if (cancelled) return;
        const fetchedPrompt = extractPromptField(promptsResult, 'prompt');
        const fetchedNegative = extractPromptField(promptsResult, 'negativePrompt');
        const fetchedPrefix = extractPromptField(promptsResult, 'fileNamePrefix');
        const fetchedSeconds = extractPromptField(promptsResult, 'seconds');
        const cardPrompt = (navPromptRef.current || '').trim();
        const resolvedPrompt = cardPrompt ? cardPrompt : fetchedPrompt;
        setPrompt(resolvedPrompt);
        if (resolvedPrompt) {
          applyBuilderValues(parseStableAudioPrompt(resolvedPrompt));
        } else {
          applyBuilderValues({ ...DEFAULT_PROMPT_BUILDER_VALUES });
        }
        navPromptRef.current = '';
        setNegativePrompt(fetchedNegative);
        setFilePrefix(fetchedPrefix || DEFAULT_FILE_PREFIX);
        setSeconds(fetchedSeconds || DEFAULT_SECONDS);
        setError('');
        setStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || 'Failed to load Stable Diffusion workflow prompts.');
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

  const refreshStatus = useCallback(async (ensureLaunch = false) => {
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
  }, [isTauriEnv]);

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

  const clearJobPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isTauriEnv) return undefined;
    let cancelled = false;

    (async () => {
      await loadComfySettings();
      if (cancelled) return;
      await refreshStatus(false);
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
  }, [clearJobPolling, isTauriEnv, loadComfySettings, refreshStatus]);

  const normalizeTemplates = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    const normalized = list
      .map((template) => ({
        name: String(template?.name ?? ''),
        prompt: template?.prompt ?? '',
        negativePrompt: template?.negative_prompt ?? template?.negativePrompt ?? '',
        fileNamePrefix: template?.file_name_prefix ?? template?.fileNamePrefix ?? DEFAULT_FILE_PREFIX,
        seconds:
          typeof template?.seconds === 'number'
            ? template.seconds
            : Number.parseFloat(String(template?.seconds ?? DEFAULT_SECONDS)) || Number(DEFAULT_SECONDS),
      }))
      .filter((template) => template.name.trim().length > 0);
      normalized.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return normalized;
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const result = await invoke('get_stable_audio_templates');
      const normalized = normalizeTemplates(result);
      setTemplates(normalized);
      if (normalized.every((template) => template.name !== selectedTemplate)) {
        setSelectedTemplate('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError((prev) => prev || message);
    }
  }, [isTauriEnv, normalizeTemplates, selectedTemplate]);

  useEffect(() => {
    if (!isTauriEnv) return;
    loadTemplates();
  }, [isTauriEnv, loadTemplates]);

  const updateComfySettings = useCallback(async (update) => {
    if (!isTauriEnv) return;
    try {
      const next = await invoke('update_comfyui_settings', { update });
      setComfySettings(next);
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv]);

  const toggleAutoLaunch = useCallback(async () => {
    if (!isTauriEnv) return;
    const next = !autoLaunch;
    setAutoLaunch(next);
    await updateComfySettings({ autoLaunch: next });
  }, [autoLaunch, isTauriEnv, updateComfySettings]);

  const handleTemplateSelect = useCallback(
    (event) => {
      const name = event.target.value;
      setSelectedTemplate(name);
      if (!name) {
        return;
      }
      const template = templates.find((item) => item.name === name);
      if (!template) {
        return;
      }
      const templatePrompt = template.prompt || '';
      setPrompt(templatePrompt);
      if (templatePrompt) {
        applyBuilderValues(parseStableAudioPrompt(templatePrompt));
      }
      setNegativePrompt(template.negativePrompt || '');
      setFilePrefix(template.fileNamePrefix || DEFAULT_FILE_PREFIX);
      setSeconds(String(template.seconds ?? Number(DEFAULT_SECONDS)));
      setTemplateName(template.name);
    },
    [templates, applyBuilderValues],
  );

  const pollJobStatus = useCallback(async (id) => {
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
      const audioArtifacts = artifacts.filter((artifact) => {
        const path = artifact?.path;
        return typeof path === 'string' && path.toLowerCase().endsWith('.flac');
      });

      const outputs = [];
      for (const artifact of audioArtifacts) {
        const path = artifact.path;
        let url = '';
        try {
          url = fileSrc(path);
        } catch (err) {
          console.warn('Failed to resolve audio output path', err, path);
        }
        outputs.push({
          filename:
            (typeof artifact.name === 'string' && artifact.name) ||
            path.split(/[\/]/).pop() ||
            path,
          path,
          url,
        });
      }

      if (outputs.length === 0) {
        try {
          const fallback = await invoke('stable_audio_output_files', { limit: 6 });
          if (Array.isArray(fallback)) {
            fallback.forEach((entry) => {
              if (typeof entry?.path !== 'string') return;
              const path = entry.path;
              const name =
                (typeof entry?.name === 'string' && entry.name) ||
                path.split(/[\/]/).pop() ||
                path;
              let url = '';
              try {
                url = fileSrc(path);
              } catch (err) {
                console.warn('Failed to resolve fallback audio output path', err, path);
              }
              outputs.push({ filename: name, path, url });
            });
          }
        } catch (err) {
          console.warn('Failed to enumerate Stable Diffusion outputs', err);
        }
      }

      setAudioOutputs(outputs);

      const cancelled = status === 'cancelled' || Boolean(data?.cancelled);
      if (status === 'completed') {
        setRenderStatus(progressInfo.message || 'ComfyUI render complete.');
        setRenderError('');
      } else if (cancelled) {
        setRenderStatus('Stable Diffusion job cancelled.');
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
          lastError = 'Stable Diffusion job failed.';
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
  }, [clearJobPolling, refreshQueue, refreshStatus]);

  const startJobPolling = useCallback((id) => {
    if (!id) return;
    clearJobPolling();
    jobIdRef.current = id;
    pollIntervalRef.current = setTimeout(() => {
      pollJobStatus(id);
    }, 50);
  }, [clearJobPolling, pollJobStatus]);

  const handleRender = useCallback(async () => {
    if (!isTauriEnv || rendering) return;
    setRenderStatus('Queuing Stable Diffusion job...');
    setRenderError('');
    setAudioOutputs([]);
    setJobProgress(0);
    setJobStage('queued');
    setCurrentJobId('');
    try {
      const id = await invoke('queue_stable_audio_job');
      if (typeof id !== 'number' && typeof id !== 'string') {
        throw new Error('Unexpected response when queuing Stable Diffusion job.');
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
      setRenderError(message || 'Failed to queue Stable Diffusion job.');
      setRenderStatus('');
      setRendering(false);
    }
  }, [isTauriEnv, refreshQueue, refreshStatus, rendering, startJobPolling]);

const handleSubmit = async (event) => {
    event.preventDefault();
    setStatusMessage('');
    setError('');

    if (!isTauriEnv) {
      setError('Saving prompts requires the desktop app.');
      return;
    }

    const cleanedPrompt = prompt.trim();
    const cleanedNegative = negativePrompt.trim();
    const cleanedFilePrefix = filePrefix.trim() || DEFAULT_FILE_PREFIX;
    const cleanedSeconds = seconds.trim();
    const secondsValue = Number.parseFloat(cleanedSeconds);

    if (!cleanedPrompt) {
      setError('Prompt cannot be empty.');
      return;
    }

    if (!Number.isFinite(secondsValue) || secondsValue <= 0) {
      setError('Seconds must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      const result = await invoke('update_stable_audio_prompts', {
        prompt: cleanedPrompt,
        negativePrompt: cleanedNegative,
        fileNamePrefix: cleanedFilePrefix,
        seconds: secondsValue,
      });
      const savedPrompt = extractPromptField(result, 'prompt') || cleanedPrompt;
      const savedNegative = extractPromptField(result, 'negativePrompt') || cleanedNegative;
      const savedPrefix = extractPromptField(result, 'fileNamePrefix') || cleanedFilePrefix;
      const savedSeconds = extractPromptField(result, 'seconds') || String(secondsValue);
      setPrompt(savedPrompt);
      setNegativePrompt(savedNegative);
      setFilePrefix(savedPrefix);
      setSeconds(savedSeconds);

      const trimmedTemplateName = templateName.trim();
      if (trimmedTemplateName) {
        try {
          const templatesResult = await invoke('save_stable_audio_template', {
            template: {
              name: trimmedTemplateName,
              prompt: savedPrompt,
              negativePrompt: savedNegative,
              fileNamePrefix: savedPrefix,
              seconds: Number.parseFloat(savedSeconds) || secondsValue,
            },
          });
          setTemplates(normalizeTemplates(templatesResult));
          setSelectedTemplate(trimmedTemplateName);
          setTemplateName('');
        } catch (templateErr) {
          const message = templateErr instanceof Error ? templateErr.message : String(templateErr);
          setStatusError(message || 'Failed to save template.');
        }
      }

      setStatusMessage('Workflow prompt settings updated.');
      refreshStatus(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to update Stable Diffusion workflow.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;
  const secondsValueRaw = Number.parseFloat(seconds.trim());
  const secondsValid = Number.isFinite(secondsValueRaw) && secondsValueRaw > 0;
  const submitDisabled = disabled || !isTauriEnv || !prompt.trim() || !secondsValid;
  const renderDisabled = !isTauriEnv || rendering;

  return (
    <>
      <BackButton />
      <h1>Stable Diffusion</h1>

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
        <button type="button" className="back-button" onClick={() => refreshStatus(true)} disabled={!isTauriEnv || isLaunching}>
          {isLaunching ? 'Starting...' : 'Activate'}
        </button>
        <button type="button" className="back-button" onClick={toggleAutoLaunch} disabled={!isTauriEnv}>
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
        {currentJobId && (
          <span className="card-caption">Last job id: {currentJobId}</span>
        )}
      </div>

      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />

      <form
        className="card stable-diffusion-form"
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gap: '1.25rem',
          alignItems: 'start',
          width: 'min(95vw, 1400px)',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label htmlFor="stable-diffusion-template" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Templates</span>
            <select
              id="stable-diffusion-template"
              value={selectedTemplate}
              onChange={handleTemplateSelect}
              disabled={!isTauriEnv || templates.length === 0}
              style={{
                minWidth: '220px',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            >
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.name} value={template.name}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="stable-diffusion-template-name" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Template Name</span>
            <input
              id="stable-diffusion-template-name"
              type="text"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Save current prompts as..."
              disabled={disabled}
              style={{
                maxWidth: '280px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="stable-diffusion-prefix" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Filename Prefix</span>
            <input
              id="stable-diffusion-prefix"
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
          <label htmlFor="stable-diffusion-seconds" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Duration (seconds)</span>
            <input
              id="stable-diffusion-seconds"
              type="number"
              min="1"
              step="0.1"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              disabled={disabled}
              style={{
                width: '140px',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: '1px solid rgba(15, 23, 42, 0.2)',
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
        </div>
        {comfyStatus.pending > 0 && (
          <div style={{ fontWeight: 600 }}>Pending ComfyUI tasks: {comfyStatus.pending}</div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <label
            htmlFor={isPromptBuilderActive ? 'stable-builder-format' : 'stable-diffusion-prompt'}
            className="form-label"
            style={{ marginBottom: 0 }}
          >
            Prompt
          </label>
          <label
            className="form-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: 0,
            }}
          >
            <input
              type="checkbox"
              checked={isPromptBuilderActive}
              onChange={(event) => setIsPromptBuilderActive(event.target.checked)}
              disabled={disabled}
            />
            Build a Prompt
          </label>
        </div>
        {isPromptBuilderActive ? (
          <div
            style={{
              display: 'grid',
              gap: '1rem',
              background: 'var(--card-bg)',
              padding: '1.25rem',
              borderRadius: '14px',
              border: '1px solid rgba(15, 23, 42, 0.15)',
              boxShadow: 'inset 0 2px 6px rgba(15, 23, 42, 0.05)',
            }}
          >
            <label htmlFor="stable-builder-format" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Format</span>
              <input
                id="stable-builder-format"
                type="text"
                value={builderFormat}
                onChange={(event) => setBuilderFormat(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-genre" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Genre</span>
              <input
                id="stable-builder-genre"
                type="text"
                value={builderGenre}
                onChange={(event) => setBuilderGenre(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-subgenre" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Sub-Genre</span>
              <input
                id="stable-builder-subgenre"
                type="text"
                value={builderSubGenre}
                onChange={(event) => setBuilderSubGenre(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-instruments" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Instruments</span>
              <textarea
                id="stable-builder-instruments"
                value={builderInstruments}
                onChange={(event) => setBuilderInstruments(event.target.value)}
                disabled={disabled}
                rows={3}
                style={{
                  ...TEXTAREA_BASE_STYLE,
                  minHeight: '6rem',
                  resize: 'vertical',
                }}
              />
            </label>
            <label htmlFor="stable-builder-mood" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Mood</span>
              <input
                id="stable-builder-mood"
                type="text"
                value={builderMood}
                onChange={(event) => setBuilderMood(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-style" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Style</span>
              <input
                id="stable-builder-style"
                type="text"
                value={builderStyle}
                onChange={(event) => setBuilderStyle(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-tempo" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>Tempo Descriptor</span>
              <input
                id="stable-builder-tempo"
                type="text"
                value={builderTempoDescriptor}
                onChange={(event) => setBuilderTempoDescriptor(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
            <label htmlFor="stable-builder-bpm" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
              <span>BPM</span>
              <input
                id="stable-builder-bpm"
                type="number"
                min="0"
                value={builderBpm}
                onChange={(event) => setBuilderBpm(event.target.value)}
                disabled={disabled}
                style={{
                  padding: '0.7rem 0.85rem',
                  borderRadius: '12px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
          </div>
        ) : (
          <textarea
            id="stable-diffusion-prompt"
            placeholder="Enter audio prompt..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={10}
            style={{
              ...TEXTAREA_BASE_STYLE,
              width: 'min(95vw, 1300px)',
              minHeight: '20rem',
              fontSize: '1.05rem',
              lineHeight: 1.6,
            }}
            disabled={disabled}
          />
        )}
        <label htmlFor="stable-diffusion-negative" className="form-label">
          Negative Prompt
        </label>
        <textarea
          id="stable-diffusion-negative"
          placeholder="Optional negative prompt"
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          rows={8}
          style={{
            ...TEXTAREA_BASE_STYLE,
            width: 'min(95vw, 1300px)',
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

      {audioOutputs.length > 0 && (
        <section className="card" style={{ display: 'grid', gap: '0.75rem' }}>
          <h2>Latest ComfyUI Output</h2>
          {audioOutputs.map((output, index) => (
            <div key={`${output.path ?? 'output'}-${index}`} style={{ display: 'grid', gap: '0.35rem' }}>
              <strong>{output.filename}</strong>
              <audio controls src={output.url || (output.path ? fileSrc(output.path) : undefined)} />
              {output.path && (
                <span className="card-caption" style={{ wordBreak: 'break-all' }}>{output.path}</span>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}


