import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { fileSrc } from '../lib/paths.js';
import { listen } from '@tauri-apps/api/event';
import { useJobQueue } from '../lib/useJobQueue.js';

export default function Riffusion() {
  const { queue, refresh } = useJobQueue(2000);
  const [prompt, setPrompt] = useState('solo grand piano, intimate room, warm tone, gentle dynamics, soft reverb, lo-fi character');
  const [negative, setNegative] = useState('voice, vocals, drums, distortion, noise, glitch');
  const [preset, setPreset] = useState('piano');
  const [seed, setSeed] = useState(12345);
  const [steps, setSteps] = useState(32);
  const [guidance, setGuidance] = useState(7.0);
  const [duration, setDuration] = useState(180);
  const [crossfade, setCrossfade] = useState(0.25);
  const [img2img, setImg2img] = useState(false);
  const [strength, setStrength] = useState(0.5);
  const [audioPath, setAudioPath] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [eta, setEta] = useState('');
  const [consoleText, setConsoleText] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [jobId, setJobId] = useState(null);
  const jobListenRef = useRef(null);
  const pollTimerRef = useRef(null);
  const [mixing, setMixing] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [outputName, setOutputName] = useState('');

  // Persist output preferences between sessions
  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('riffusion.json');
        const dir = await store.get('outputDir');
        const name = await store.get('outputName');
        if (typeof dir === 'string' && dir) setOutputDir(dir);
        if (typeof name === 'string' && name) setOutputName(name);
      } catch (_) {}
    })();
  }, []);

  const persistPref = async (key, value) => {
    try {
      const store = await Store.load('riffusion.json');
      await store.set(key, value);
      await store.save();
    } catch (_) {}
  };

  const onCancel = useCallback(async (id) => {
    try {
      await invoke('cancel_job', { jobId: id });
    } catch (err) {
      console.error('failed to cancel job', err);
    } finally {
      refresh();
    }
  }, [refresh]);

  useEffect(() => () => {
    if (jobListenRef.current) {
      jobListenRef.current();
      jobListenRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startJob = async (e) => {
    e?.preventDefault?.();
    setError('');
    setAudioPath('');
    setProgress(0);
    setStatus('Queued');
    try {
      const options = {
        prompt,
        negative,
        preset,
        seed,
        steps,
        guidance,
        duration: Number(duration),
        crossfadeSecs: Number(crossfade),
        outputDir: outputDir || undefined,
        outputName: outputName || undefined,
      };
      // Backend expects snake_case keys per RiffusionJobRequest; tauri will map camelCase -> snakeCase automatically for serde(rename_all)
      const id = await invoke('queue_riffusion_job', { options });
      setJobId(id);
      refresh();
      if (jobListenRef.current) {
        jobListenRef.current();
        jobListenRef.current = null;
      }
      jobListenRef.current = await listen(`progress::${id}`, async (event) => {
        const { percent, message, stage, eta: etaText } = event.payload || {};
        if (typeof percent === 'number') setProgress(percent);
        if (message) setStatus(message);
        else if (stage) setStatus(stage);
        if (etaText) setEta(etaText);
        // Pull latest stdout/stderr excerpts for an inline console
        try {
          const details = await invoke('job_status', { jobId: id });
          const stdoutLines = Array.isArray(details?.stdout) ? details.stdout : [];
          const stderrLines = Array.isArray(details?.stderr) ? details.stderr : [];
          const combined = [...stdoutLines, ...stderrLines];
          setConsoleText(combined.join('\n'));
        } catch {}
        if (typeof percent === 'number' && percent >= 100) {
          try {
            const details = await invoke('job_details', { jobId: id });
            const wav = details?.artifacts?.find?.((a) => typeof a?.path === 'string' && a.path.toLowerCase().endsWith('.wav'));
            if (wav?.path) setAudioPath(wav.path);
          } catch (e3) {
            // ignore
          }
        }
      });
      // Also start a light poll to fetch logs/status in early stage before events arrive
      if (!pollTimerRef.current) {
        const poll = async () => {
          if (!id) return;
          try {
            const details = await invoke('job_status', { jobId: id });
            const stdoutLines = Array.isArray(details?.stdout) ? details.stdout : [];
            const stderrLines = Array.isArray(details?.stderr) ? details.stderr : [];
            const combined = [...stdoutLines, ...stderrLines];
            if (combined.length) setConsoleText(combined.join('\n'));
            const s = details?.status;
            if (s && typeof s === 'string' && ['completed','error','cancelled'].includes(s)) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
          } catch {}
        };
        pollTimerRef.current = setInterval(poll, 1500);
        // Do an immediate poll once
        try {
          const details = await invoke('job_status', { jobId: id });
          const stdoutLines = Array.isArray(details?.stdout) ? details.stdout : [];
          const stderrLines = Array.isArray(details?.stderr) ? details.stderr : [];
          const combined = [...stdoutLines, ...stderrLines];
          if (combined.length) setConsoleText(combined.join('\n'));
        } catch {}
      }
    } catch (e2) {
      console.error('queue_riffusion_job failed', e2);
      setError(String(e2));
    }
  };

  const startSoundscape = async () => {
    setError('');
    setAudioPath('');
    setProgress(0);
    setStatus('Queued');
    setMixing(true);
    try {
      const options = {
        preset: 'dark_ambience',
        duration: Number(duration),
        seed,
        steps,
        guidance,
        crossfadeSecs: Number(crossfade),
        outputDir: outputDir || undefined,
        outputName: outputName || undefined,
      };
      const id = await invoke('queue_riffusion_soundscape_job', { options });
      setJobId(id);
      refresh();
      if (jobListenRef.current) { jobListenRef.current(); jobListenRef.current = null; }
      jobListenRef.current = await listen(`progress::${id}`, async (event) => {
        const { percent, message, stage, eta: etaText } = event.payload || {};
        if (typeof percent === 'number') setProgress(percent);
        if (message) setStatus(message);
        else if (stage) setStatus(stage);
        if (etaText) setEta(etaText);
        try {
          const details = await invoke('job_status', { jobId: id });
          const stdoutLines = Array.isArray(details?.stdout) ? details.stdout : [];
          const stderrLines = Array.isArray(details?.stderr) ? details.stderr : [];
          const combined = [...stdoutLines, ...stderrLines];
          setConsoleText(combined.join('\n'));
        } catch {}
        if (typeof percent === 'number' && percent >= 100) {
          try {
            const details = await invoke('job_details', { jobId: id });
            const wav = details?.artifacts?.find?.((a) => typeof a?.path === 'string' && a.path.toLowerCase().endsWith('.wav'));
            if (wav?.path) setAudioPath(wav.path);
          } catch (_) {}
          setMixing(false);
        }
      });
    } catch (e2) {
      console.error('queue_riffusion_soundscape_job failed', e2);
      setError(String(e2));
      setMixing(false);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Riffusion Music Generation</h1>
      <div className="route-fade" style={{ maxWidth: 1000, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <JobQueuePanel queue={queue} onCancel={onCancel} activeId={jobId || undefined} />
        <form className="card" style={{ alignItems: 'stretch', textAlign: 'left' }} onSubmit={startJob}>
          <h2>Hello, Piano</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Style Preset
              <select className="mt-sm" value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: '100%' }}>
                <option value="piano">Piano</option>
                <option value="ambience">Ambience</option>
                <option value="rock_riff">Rock Riff</option>
                <option value="lo_fi">Lo-Fi</option>
                <option value="edm">EDM</option>
                <option value="cinematic">Cinematic</option>
              </select>
            </label>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Negative Prompt
              <input value={negative} onChange={(e) => setNegative(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Prompt</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ fontWeight: 600, display: 'block' }}>Seed</label>
              <input type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value || '0', 10))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontWeight: 600, display: 'block' }}>Steps</label>
              <input type="number" min={20} max={50} value={steps} onChange={(e) => setSteps(parseInt(e.target.value || '30', 10))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontWeight: 600, display: 'block' }}>Guidance</label>
              <input type="number" step="0.1" min={3} max={12} value={guidance} onChange={(e) => setGuidance(parseFloat(e.target.value || '7'))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontWeight: 600, display: 'block' }}>Duration (sec)</label>
              <input type="number" min={6} max={600} value={duration} onChange={(e) => setDuration(parseInt(e.target.value || '180', 10))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontWeight: 600, display: 'block' }}>Crossfade (sec)</label>
              <input type="number" step="0.05" min={0} max={3} value={crossfade} onChange={(e) => setCrossfade(parseFloat(e.target.value || '0.25'))} style={{ width: '100%' }} />
            </div>
          </div>

          <details className="mt-sm">
            <summary>Advanced</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={img2img} onChange={(e) => setImg2img(e.target.checked)} /> Img2Img
              </label>
              <div>
                <label style={{ fontWeight: 600, display: 'block' }}>Strength</label>
                <input type="range" min={0} max={1} step={0.01} value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginTop: 12, alignItems: 'center' }}>
              <div>
                <label style={{ fontWeight: 600, display: 'block' }}>Output Folder</label>
                <input type="text" value={outputDir} onChange={(e) => { setOutputDir(e.target.value); persistPref('outputDir', e.target.value); }} placeholder="Default (App Data)" style={{ width: '100%' }} />
              </div>
              <div>
                <button type="button" className="back-button" onClick={async () => {
                  try {
                    const res = await openDialog({ directory: true, multiple: false, defaultPath: outputDir || undefined });
                    if (!res) return;
                    const path = Array.isArray(res) ? (typeof res[0] === 'string' ? res[0] : res[0]?.path) : (typeof res === 'string' ? res : res?.path);
                    if (path) { setOutputDir(path); persistPref('outputDir', path); }
                  } catch (err) {
                    console.error('Folder selection failed', err);
                  }
                }}>Browse</button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              <label style={{ fontWeight: 600, display: 'block' }}>Output Name (optional)</label>
              <input type="text" value={outputName} onChange={(e) => { setOutputName(e.target.value); persistPref('outputName', e.target.value); }} placeholder="e.g. dark_ambience" />
              <small className="muted">Do not include extension. Master and stems will use this base name.</small>
            </div>
          </details>

          <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
            <button className="back-button" type="submit">
              Generate {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}
            </button>
            {jobId && (
              <button type="button" className="back-button" onClick={() => onCancel(jobId)}>
                Cancel
              </button>
            )}
            <button type="button" className="back-button" onClick={startSoundscape} disabled={mixing}>
              {mixing ? 'Rendering Soundscape…' : 'One‑click: Dark Ambience'}
            </button>
          </div>

          <div className="mt-sm" style={{ display: 'grid', gap: 6 }}>
            <progress value={Math.max(0, Math.min(100, progress || 0))} max="100" />
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>
              {status}
              {eta ? ` • ETA: ${eta}` : ''}
            </div>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <button type="button" className="back-button" onClick={() => setShowLogs((v) => !v)} disabled={!consoleText}>
                  {showLogs ? 'Hide Logs' : 'Show Full Logs'}
                </button>
                <button
                  type="button"
                  className="back-button"
                  disabled={!consoleText}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(consoleText || '');
                    } catch (e) {
                      console.warn('Clipboard write failed', e);
                    }
                  }}
                >
                  Copy Logs
                </button>
                {!consoleText && (
                  <span className="muted" style={{ opacity: 0.8 }}>No logs yet</span>
                )}
              </div>
              {showLogs && consoleText && (
                <pre
                  style={{
                    margin: 0,
                    padding: '0.5rem',
                    background: 'var(--card-hover-bg)',
                    borderRadius: 6,
                    maxHeight: 360,
                    overflow: 'auto',
                    fontSize: '0.8rem',
                    lineHeight: 1.3,
                  }}
                >
                  {consoleText}
                </pre>
              )}
            </div>
            {error && (
              <p className="card-caption" style={{ color: 'tomato' }}>{error}</p>
            )}
          </div>
        </form>

        {audioPath && (
          <div className="card" style={{ alignItems: 'stretch' }}>
            <h2>Preview</h2>
            <audio controls src={fileSrc(audioPath)} />
          </div>
        )}
      </div>
    </>
  );
}
