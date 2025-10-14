import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { fileSrc } from '../lib/paths.js';

const WORKFLOW_PATH = 'assets/workflows/stable_audio.json';
const STATUS_POLL_INTERVAL_MS = 5000;
const JOB_POLL_INTERVAL_MS = 1500;

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
  const snakeKey = key.replace(/([A-Z])/g, '_').toLowerCase();
  const fallback = result[snakeKey];
  return typeof fallback === 'string' ? fallback : '';
}

function extractDialogPath(selection) {
  if (!selection) return '';
  if (typeof selection === 'string') return selection;
  if (Array.isArray(selection)) {
    const first = selection[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && typeof first.path === 'string') return first.path;
    return '';
  }
  if (typeof selection === 'object' && typeof selection.path === 'string') {
    return selection.path;
  }
  return '';
}

export default function StableDiffusion() {
  const location = useLocation();
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : '';
  const navPromptRef = useRef(initialPrompt);
  const statusIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState(null);
  const [executableInput, setExecutableInput] = useState('');
  const [workingDirInput, setWorkingDirInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [outputDirInput, setOutputDirInput] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(true);

  const [comfyStatus, setComfyStatus] = useState({ running: false, pending: 0, runningCount: 0 });
  const [statusError, setStatusError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState('');
  const [renderError, setRenderError] = useState('');
  const [currentPromptId, setCurrentPromptId] = useState('');
  const [audioOutputs, setAudioOutputs] = useState([]);

  useEffect(() => {
    if (!comfySettings) return;
    setExecutableInput(comfySettings.executable_path || '');
    setWorkingDirInput(comfySettings.working_directory || '');
    setBaseUrlInput(comfySettings.base_url || 'http://127.0.0.1:8188');
    setOutputDirInput(comfySettings.output_dir || '');
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
        const cardPrompt = (navPromptRef.current || '').trim();
        setPrompt(cardPrompt ? cardPrompt : fetchedPrompt);
        navPromptRef.current = '';
        setNegativePrompt(fetchedNegative);
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
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isTauriEnv, loadComfySettings, refreshStatus]);

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

  const handleBrowseExecutable = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const selection = await openDialog({ title: 'Select ComfyUI executable', multiple: false });
      const path = extractDialogPath(selection);
      if (path) {
        setExecutableInput(path);
        await updateComfySettings({ executablePath: path });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv, updateComfySettings]);

  const handleBrowseWorkingDir = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const selection = await openDialog({ title: 'Select working directory', directory: true, multiple: false });
      const path = extractDialogPath(selection);
      if (path) {
        setWorkingDirInput(path);
        await updateComfySettings({ workingDirectory: path });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv, updateComfySettings]);

  const handleBrowseOutputDir = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const selection = await openDialog({ title: 'Select ComfyUI output directory', directory: true, multiple: false });
      const path = extractDialogPath(selection);
      if (path) {
        setOutputDirInput(path);
        await updateComfySettings({ outputDir: path });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv, updateComfySettings]);

  const handleBaseUrlBlur = useCallback(async () => {
    if (!isTauriEnv) return;
    const value = baseUrlInput.trim();
    if (!value) return;
    await updateComfySettings({ baseUrl: value });
  }, [isTauriEnv, baseUrlInput, updateComfySettings]);

  const handleOutputDirBlur = useCallback(async () => {
    if (!isTauriEnv) return;
    const value = outputDirInput.trim();
    if (!value) return;
    await updateComfySettings({ outputDir: value });
  }, [isTauriEnv, outputDirInput, updateComfySettings]);

  const toggleAutoLaunch = useCallback(async () => {
    if (!isTauriEnv) return;
    const next = !autoLaunch;
    setAutoLaunch(next);
    await updateComfySettings({ autoLaunch: next });
  }, [autoLaunch, isTauriEnv, updateComfySettings]);

  const clearJobPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollJobStatus = useCallback(async (promptId) => {
    if (!isTauriEnv) return;
    try {
      const result = await invoke('comfyui_job_status', { promptId });
      if (!result) return;
      setComfyStatus({
        running: true,
        pending: Number(result.pending || 0),
        runningCount: Number(result.running || 0),
      });
      if (Array.isArray(result.outputs)) {
        setAudioOutputs(result.outputs);
      }
      if (result.status === 'completed') {
        setRenderStatus('ComfyUI render complete.');
        setRenderError('');
        setRendering(false);
        clearJobPolling();
        refreshStatus(false);
      } else if (result.status === 'error') {
        setRenderError(result.message || 'ComfyUI reported an error while rendering.');
        setRenderStatus('');
        setRendering(false);
        clearJobPolling();
        refreshStatus(false);
      } else if (result.status === 'offline') {
        setRenderError(result.message || 'ComfyUI is offline.');
        setRendering(false);
        setComfyStatus({ running: false, pending: 0, runningCount: 0 });
        clearJobPolling();
      } else {
        setRenderStatus(result.status === 'running' ? 'ComfyUI is rendering…' : 'ComfyUI job is queued…');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message);
      setRendering(false);
      clearJobPolling();
    }
  }, [clearJobPolling, isTauriEnv, refreshStatus]);

  const startJobPolling = useCallback((promptId) => {
    clearJobPolling();
    pollIntervalRef.current = setInterval(() => {
      pollJobStatus(promptId);
    }, JOB_POLL_INTERVAL_MS);
  }, [clearJobPolling, pollJobStatus]);

  const handleRender = useCallback(async () => {
    if (!isTauriEnv || rendering) return;
    setRenderStatus('Submitting workflow to ComfyUI…');
    setRenderError('');
    setAudioOutputs([]);
    setRendering(true);
    try {
      const response = await invoke('comfyui_submit_stable_audio');
      const promptId = response?.prompt_id || response?.promptId;
      if (promptId) {
        setCurrentPromptId(promptId);
        setRenderStatus('ComfyUI job queued. Waiting for completion…');
        await refreshStatus(true);
        startJobPolling(promptId);
      } else {
        throw new Error('ComfyUI submission returned no prompt id.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message || 'Failed to submit workflow to ComfyUI.');
      setRenderStatus('');
      setRendering(false);
    }
  }, [isTauriEnv, rendering, refreshStatus, startJobPolling]);

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

    if (!cleanedPrompt) {
      setError('Prompt cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      const result = await invoke('update_stable_audio_prompts', {
        prompt: cleanedPrompt,
        negativePrompt: cleanedNegative,
      });
      const savedPrompt = extractPromptField(result, 'prompt') || cleanedPrompt;
      const savedNegative = extractPromptField(result, 'negativePrompt') || cleanedNegative;
      setPrompt(savedPrompt);
      setNegativePrompt(savedNegative);
      setStatusMessage('Prompts updated in ' + WORKFLOW_PATH + '.');
      refreshStatus(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to update Stable Diffusion workflow.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;
  const submitDisabled = disabled || !isTauriEnv || !prompt.trim();
  const renderDisabled = !isTauriEnv || rendering || !comfyStatus.running;

  return (
    <>
      <BackButton />
      <h1>Stable Diffusion</h1>

      <section className="card" style={{ display: 'grid', gap: '0.75rem' }}>
        <h2>ComfyUI Integration</h2>
        <p className="card-caption">
          Status: {comfyStatus.running ? 'Online' : 'Offline'}{' '}
          {comfyStatus.pending > 0 && `Pending tasks: ${comfyStatus.pending}`}{' '}
          {comfyStatus.runningCount > 0 && `Running: ${comfyStatus.runningCount}`}
        </p>
        {statusError && (
          <p className="card-caption" style={{ color: 'var(--accent)' }}>{statusError}</p>
        )}
        <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
          <label style={{ display: 'grid', gap: '0.25rem' }}>
            <span>Executable</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={executableInput}
                onChange={(event) => setExecutableInput(event.target.value)}
                onBlur={() => executableInput && updateComfySettings({ executablePath: executableInput.trim() })}
                placeholder="Path to ComfyUI executable"
                style={{ flex: 1 }}
                disabled={!isTauriEnv}
              />
              <button type="button" className="back-button" onClick={handleBrowseExecutable} disabled={!isTauriEnv}>
                Browse
              </button>
            </div>
          </label>
          <label style={{ display: 'grid', gap: '0.25rem' }}>
            <span>Working Directory</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={workingDirInput}
                onChange={(event) => setWorkingDirInput(event.target.value)}
                onBlur={() => workingDirInput && updateComfySettings({ workingDirectory: workingDirInput.trim() })}
                placeholder="Optional working directory"
                style={{ flex: 1 }}
                disabled={!isTauriEnv}
              />
              <button type="button" className="back-button" onClick={handleBrowseWorkingDir} disabled={!isTauriEnv}>
                Browse
              </button>
            </div>
          </label>
          <label style={{ display: 'grid', gap: '0.25rem' }}>
            <span>Output Directory</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                value={outputDirInput}
                onChange={(event) => setOutputDirInput(event.target.value)}
                onBlur={handleOutputDirBlur}
                placeholder="Defaults to &lt;ComfyUI&gt;/output"
                style={{ flex: 1 }}
                disabled={!isTauriEnv}
              />
              <button type="button" className="back-button" onClick={handleBrowseOutputDir} disabled={!isTauriEnv}>
                Browse
              </button>
            </div>
          </label>
          <label style={{ display: 'grid', gap: '0.25rem' }}>
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrlInput}
              onChange={(event) => setBaseUrlInput(event.target.value)}
              onBlur={handleBaseUrlBlur}
              placeholder="http://127.0.0.1:8188"
              disabled={!isTauriEnv}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="back-button" onClick={() => refreshStatus(true)} disabled={!isTauriEnv || isLaunching}>
            {isLaunching ? 'Starting…' : 'Ensure ComfyUI Running'}
          </button>
          <button type="button" className="back-button" onClick={toggleAutoLaunch} disabled={!isTauriEnv}>
            Auto-launch: {autoLaunch ? 'On' : 'Off'}
          </button>
          {currentPromptId && (
            <span className="card-caption">Last prompt id: {currentPromptId}</span>
          )}
        </div>
      </section>

      <p className="page-intro">
        Update the Stable Diffusion workflow prompts used by the audio pipeline. Changes are written to{' '}
        <code style={{ marginLeft: '0.25rem' }}>{WORKFLOW_PATH}</code> when you save.
      </p>

      <form
        className="card stable-diffusion-form"
        onSubmit={handleSubmit}
        style={{ display: 'grid', gap: '1rem', maxWidth: '960px' }}
      >
        {comfyStatus.pending > 0 && (
          <div style={{ fontWeight: 600 }}>Pending ComfyUI tasks: {comfyStatus.pending}</div>
        )}
        <label htmlFor="stable-diffusion-prompt" className="form-label">
          Prompt
        </label>
        <textarea
          id="stable-diffusion-prompt"
          placeholder="Enter audio prompt..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={10}
          style={{ ...TEXTAREA_BASE_STYLE, minHeight: '18rem' }}
          disabled={disabled}
        />
        <label htmlFor="stable-diffusion-negative" className="form-label">
          Negative Prompt
        </label>
        <textarea
          id="stable-diffusion-negative"
          placeholder="Optional negative prompt"
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          rows={6}
          style={{ ...TEXTAREA_BASE_STYLE, minHeight: '12rem' }}
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
            loadingText="Rendering…"
            disabled={renderDisabled}
            onClick={handleRender}
          >
            Render via ComfyUI
          </PrimaryButton>
        </div>
      </form>

      {(statusMessage || renderStatus) && (
        <div className="card" role="status">
          {statusMessage && <p className="card-caption">{statusMessage}</p>}
          {renderStatus && <p className="card-caption">{renderStatus}</p>}
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
            <div key={${output.node_id}--} style={{ display: 'grid', gap: '0.35rem' }}>
              <strong>{output.filename}</strong>
              <audio controls src={output.local_path ? fileSrc(output.local_path) : undefined} />
              {output.local_path && (
                <span className="card-caption" style={{ wordBreak: 'break-all' }}>{output.local_path}</span>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
