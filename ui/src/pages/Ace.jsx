import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton.jsx";
import PrimaryButton from "../components/PrimaryButton.jsx";
import JobQueuePanel from "../components/JobQueuePanel.jsx";
import { useJobQueue } from "../lib/useJobQueue.js";
import { fileSrc } from "../lib/paths.js";
import "./Ace.css";

const SONG_TEMPLATES = [
  {
    value: "cinematic-rise",
    label: "Cinematic Rise",
    description: "Slow-building orchestral pop with soaring finales.",
    stylePrompt:
      "cinematic pop orchestration, warm strings, hybrid synth pulses, uplifting drums, big anthemic choruses, emotional swells",
    songForm: [
      "[intro]",
      "[pulse]",
      "[verse 1]",
      "[pre-chorus]",
      "[chorus]",
      "[drop]",
      "[verse 2]",
      "[bridge]",
      "[final chorus]",
      "[outro]",
    ].join("\n"),
    bpm: 98,
    guidance: 1.08,
  },
  {
    value: "midnight-club",
    label: "Midnight Club",
    description: "Neon-soaked electronic groove with dynamic breakdowns.",
    stylePrompt:
      "retro synthwave, analog bass, gated reverb drums, glittering arps, midnight highway energy, cinematic sidechain",
    songForm: [
      "[intro]",
      "[verse 1]",
      "[pre-chorus]",
      "[chorus]",
      "[breakdown]",
      "[build]",
      "[chorus]",
      "[outro stabs]",
    ].join("\n"),
    bpm: 112,
    guidance: 0.96,
  },
  {
    value: "glimmer-pop",
    label: "Glimmer Pop",
    description: "Sparkling upbeat pop with chopped fills and drops.",
    stylePrompt:
      "glitter pop, bright guitars, shimmering plucks, tight drums, playful vocal chops, feel-good festival energy",
    songForm: [
      "[count-in]",
      "[verse 1]",
      "[pre-chorus]",
      "[chorus]",
      "[turnaround]",
      "[verse 2]",
      "[bridge breakdown]",
      "[double chorus]",
      "[tag outro]",
    ].join("\n"),
    bpm: 118,
    guidance: 1.02,
  },
  {
    value: "lofi-narrative",
    label: "Lo-Fi Narrative",
    description: "Cozy storytelling beat with sectional mood shifts.",
    stylePrompt:
      "lofi chillhop, dusty drums, warm electric piano, mellow guitar chops, cassette noise, intimate storytelling vibe",
    songForm: [
      "[intro textures]",
      "[verse 1]",
      "[chorus]",
      "[instrumental break]",
      "[verse 2]",
      "[bridge]",
      "[final chorus]",
      "[coda]",
    ].join("\n"),
    bpm: 82,
    guidance: 0.92,
  },
  {
    value: "future-rnb",
    label: "Future R&B",
    description: "Silky grooves with halftime flips and vocal drops.",
    stylePrompt:
      "future r&b, soulful pads, subby bass, syncopated drums, airy vocal chops, halftime transitions, glossy textures",
    songForm: [
      "[intro sweep]",
      "[verse 1]",
      "[chorus]",
      "[halftime switch]",
      "[verse 2]",
      "[bridge]",
      "[chorus]",
      "[outro fade]",
    ].join("\n"),
    bpm: 94,
    guidance: 1.1,
  },
];

const ACE_DEFAULT_GUIDANCE = 0.99;
const ACE_DEFAULT_BPM = 120;

function formatEta(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createAudioEntry(path, nameHint) {
  if (typeof path !== "string" || !path) return null;
  try {
    const url = fileSrc(path);
    return {
      path,
      url,
      name: nameHint || path.split(/[/\\]/).pop() || "audio",
    };
  } catch (err) {
    console.warn("Failed to build audio URL", err);
    return {
      path,
      url: "",
      name: nameHint || path.split(/[/\\]/).pop() || "audio",
    };
  }
}

export default function Ace() {
  const [stylePrompt, setStylePrompt] = useState("");
  const [songForm, setSongForm] = useState("");
  const [bpm, setBpm] = useState(ACE_DEFAULT_BPM);
  const [guidance, setGuidance] = useState(ACE_DEFAULT_GUIDANCE);
  const [selectedTemplate, setSelectedTemplate] = useState("cinematic-rise");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState("");
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);
  const [comfyStatus, setComfyStatus] = useState({ running: false, pending: 0, runningCount: 0 });
  const [statusError, setStatusError] = useState("");
  const [outputsLoading, setOutputsLoading] = useState(false);

  const pollTimeoutRef = useRef(null);
  const jobIdRef = useRef(null);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

  const activeTemplate = useMemo(
    () => SONG_TEMPLATES.find((template) => template.value === selectedTemplate) || null,
    [selectedTemplate],
  );

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const refreshComfyStatus = useCallback(
    async (ensureLaunch = false) => {
      if (!isTauriEnv) return;
      try {
        const result = await invoke("comfyui_status", { ensureRunning: ensureLaunch });
        if (!result) return;
        setComfyStatus({
          running: Boolean(result.running),
          pending: Number(result.pending || 0),
          runningCount: Number(result.runningCount || 0),
        });
        setStatusError("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusError(message);
        setComfyStatus((prev) => ({ ...prev, running: false }));
      }
    },
    [isTauriEnv],
  );

  const loadRecentOutputs = useCallback(
    async (limit = 6) => {
      if (!isTauriEnv) return;
      try {
        setOutputsLoading(true);
        const files = await invoke("ace_output_files", { limit });
        if (!Array.isArray(files)) return;
        const mapped = files
          .map((item) => createAudioEntry(item.path, item.name))
          .filter(Boolean);
        setAudioOutputs(mapped);
      } catch (err) {
        console.warn("Failed to load ACE outputs", err);
      } finally {
        setOutputsLoading(false);
      }
    },
    [isTauriEnv],
  );

  const pollJobStatus = useCallback(
    async (id) => {
      if (!id || jobIdRef.current !== id) return;
      try {
        const data = await invoke("job_status", { jobId: id });
        if (jobIdRef.current !== id) {
          return;
        }
        const status = typeof data?.status === "string" ? data.status : "";
        const progressInfo = data?.progress || {};
        const percent =
          typeof progressInfo.percent === "number"
            ? progressInfo.percent
            : status === "completed"
            ? 100
            : 0;
        setJobProgress(percent);
        setJobStage(progressInfo.stage || status || "");
        setStatusMessage(progressInfo.message || "");
        setQueuePosition(
          typeof progressInfo.queue_position === "number" ? progressInfo.queue_position : null,
        );
        setQueueEtaSeconds(
          typeof progressInfo.queue_eta_seconds === "number"
            ? progressInfo.queue_eta_seconds
            : null,
        );
        refreshQueue();

        if (status === "queued" || status === "running") {
          clearPollTimeout();
          pollTimeoutRef.current = setTimeout(() => {
            pollJobStatus(id);
          }, 1200);
          return;
        }

        clearPollTimeout();
        setRendering(false);
        setCurrentJobId(null);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        jobIdRef.current = null;

        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        const mapped = artifacts
          .map((item) => createAudioEntry(item.path, item.name))
          .filter(Boolean);
        if (mapped.length > 0) {
          setAudioOutputs(mapped);
        } else {
          await loadRecentOutputs();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusMessage(message);
        clearPollTimeout();
        setRendering(false);
        setCurrentJobId(null);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        jobIdRef.current = null;
      }
    },
    [clearPollTimeout, loadRecentOutputs, refreshQueue],
  );

  const startPolling = useCallback(
    (id) => {
      if (!id) return;
      clearPollTimeout();
      jobIdRef.current = id;
      pollTimeoutRef.current = setTimeout(() => pollJobStatus(id), 150);
    },
    [clearPollTimeout, pollJobStatus],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const tauri = await isTauri();
        if (cancelled) return;
        setIsTauriEnv(tauri);
        if (!tauri) {
          setError("ACE workflow editing requires the desktop app.");
          setLoading(false);
          return;
        }
        const result = await invoke("get_ace_workflow_prompts");
        if (cancelled) return;
        if (result) {
          if (typeof result.stylePrompt === "string") {
            setStylePrompt(result.stylePrompt);
          }
          if (typeof result.songForm === "string") {
            setSongForm(result.songForm);
          }
          if (typeof result.bpm === "number" && Number.isFinite(result.bpm)) {
            setBpm(result.bpm);
          }
          if (typeof result.guidance === "number" && Number.isFinite(result.guidance)) {
            setGuidance(result.guidance);
          }
        }
        setError("");
        setStatusMessage("");
        await refreshComfyStatus(false);
        await loadRecentOutputs();
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || "Failed to load ACE workflow prompts.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();

    const statusInterval = setInterval(() => {
      refreshComfyStatus(false);
    }, 10000);

    return () => {
      cancelled = true;
      clearPollTimeout();
      clearInterval(statusInterval);
      jobIdRef.current = null;
    };
  }, [clearPollTimeout, loadRecentOutputs, refreshComfyStatus]);

  const prepareSubmission = useCallback(() => {
    const trimmedStyle = stylePrompt.trim();
    if (!trimmedStyle) {
      setError("Describe the style or instrumentation for the track.");
      return null;
    }
    const cleanedForm = songForm
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
    if (!cleanedForm) {
      setError("Provide at least one section in the song form (e.g., [intro], [chorus]).");
      return null;
    }
    const bpmValue = Number.parseFloat(String(bpm));
    if (!Number.isFinite(bpmValue) || bpmValue <= 0) {
      setError("Tempo must be a positive number.");
      return null;
    }
    const guidanceValue = Number.parseFloat(String(guidance));
    const clampedGuidance = Number.isFinite(guidanceValue)
      ? Math.min(Math.max(guidanceValue, 0.05), 2)
      : ACE_DEFAULT_GUIDANCE;
    return {
      stylePrompt: trimmedStyle,
      songForm: cleanedForm,
      bpm: bpmValue,
      guidance: clampedGuidance,
    };
  }, [stylePrompt, songForm, bpm, guidance]);

  const handleApplyTemplate = useCallback((template) => {
    if (!template) return;
    setSelectedTemplate(template.value);
    setStylePrompt(template.stylePrompt);
    setSongForm(template.songForm);
    if (typeof template.bpm === "number") {
      setBpm(template.bpm);
    }
    if (typeof template.guidance === "number") {
      setGuidance(template.guidance);
    }
    setStatusMessage(`Loaded ${template.label} template.`);
    setError("");
  }, []);

  const handleSave = useCallback(
    async (event) => {
      event?.preventDefault();
      setStatusMessage("");
      setError("");
      if (!isTauriEnv) {
        setError("Saving requires the desktop shell.");
        return;
      }
      const payload = prepareSubmission();
      if (!payload) return;
      setSaving(true);
      try {
        const result = await invoke("update_ace_workflow_prompts", {
          update: payload,
        });
        if (result) {
          if (typeof result.stylePrompt === "string") {
            setStylePrompt(result.stylePrompt);
          }
          if (typeof result.songForm === "string") {
            setSongForm(result.songForm);
          }
          if (typeof result.bpm === "number" && Number.isFinite(result.bpm)) {
            setBpm(result.bpm);
          }
          if (typeof result.guidance === "number" && Number.isFinite(result.guidance)) {
            setGuidance(result.guidance);
          }
        }
        setStatusMessage("ACE workflow settings saved.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || "Failed to update ACE workflow prompts.");
      } finally {
        setSaving(false);
      }
    },
    [isTauriEnv, prepareSubmission],
  );

  const handleRender = useCallback(
    async (event) => {
      event?.preventDefault();
      setStatusMessage("");
      setError("");
      if (!isTauriEnv || rendering) return;
      const payload = prepareSubmission();
      if (!payload) return;
      try {
        setRendering(true);
        setJobProgress(0);
        setJobStage("preparing");
        setCurrentJobId(null);
        setAudioOutputs([]);
        await invoke("update_ace_workflow_prompts", { update: payload });
        await refreshComfyStatus(true);
        const id = await invoke("queue_ace_audio_job");
        if (typeof id !== "number" && typeof id !== "string") {
          throw new Error("Unexpected response when queuing ACE workflow.");
        }
        const numericId = typeof id === "number" ? id : Number.parseInt(id, 10);
        const resolvedId = Number.isNaN(numericId) ? id : numericId;
        setCurrentJobId(resolvedId);
        setStatusMessage("ACE workflow queued. Tracking progress...");
        refreshQueue();
        startPolling(resolvedId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || "Failed to queue ACE workflow.");
        setRendering(false);
        setCurrentJobId(null);
      }
    },
    [isTauriEnv, prepareSubmission, refreshComfyStatus, refreshQueue, rendering, startPolling],
  );

  const handleCancelJob = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke("cancel_job", { jobId: id });
      } catch (err) {
        console.warn("Failed to cancel job", err);
      } finally {
        refreshQueue();
      }
    },
    [refreshQueue],
  );

  const comfyStatusText = useMemo(() => {
    if (!isTauriEnv) return "Unavailable outside desktop app";
    if (comfyStatus.running) {
      const pendingPart = comfyStatus.pending > 0 ? ` · ${comfyStatus.pending} pending` : "";
      const activePart = comfyStatus.runningCount > 0 ? ` · ${comfyStatus.runningCount} active` : "";
      return `Online${pendingPart}${activePart}`;
    }
    return "Offline";
  }, [comfyStatus, isTauriEnv]);

  return (
    <div className="ace-page">
      <BackButton />
      <header className="ace-header">
        <h1>ACE Instrumental Studio</h1>
        <p className="ace-subtitle">
          Craft ACE-Step instrumental blueprints, queue renders through ComfyUI, and audition the latest outputs without leaving
          Blossom.
        </p>
      </header>

      <section className="ace-status">
        <div className="ace-status-card" role="status">
          <span className={`ace-dot ${comfyStatus.running ? "is-online" : "is-offline"}`} aria-hidden="true" />
          <div>
            <strong>ComfyUI</strong>
            <div>{comfyStatusText}</div>
            {statusError && <div className="ace-warning">{statusError}</div>}
          </div>
          <PrimaryButton
            type="button"
            className="ace-button-sm"
            onClick={() => refreshComfyStatus(true)}
            disabled={!isTauriEnv}
          >
            Refresh
          </PrimaryButton>
        </div>
      </section>

      <div className="ace-layout">
        <section className="card ace-card">
          <form onSubmit={handleSave} className="ace-form" autoComplete="off">
            <div className="ace-field">
              <label htmlFor="ace-template">Song Template</label>
              <select
                id="ace-template"
                value={selectedTemplate}
                onChange={(event) => {
                  const next = SONG_TEMPLATES.find((template) => template.value === event.target.value);
                  if (next) {
                    handleApplyTemplate(next);
                  } else {
                    setSelectedTemplate(event.target.value);
                  }
                }}
                disabled={loading || saving || rendering}
              >
                {SONG_TEMPLATES.map((template) => (
                  <option key={template.value} value={template.value}>
                    {template.label}
                  </option>
                ))}
                <option value="custom">Custom arrangement</option>
              </select>
            </div>

            <div className="ace-field">
              <label htmlFor="ace-style">Style & Instrumentation</label>
              <textarea
                id="ace-style"
                rows={4}
                value={stylePrompt}
                onChange={(event) => setStylePrompt(event.target.value)}
                placeholder="Describe the palette (e.g., lush synthwave pads, punchy analog drums, glassy arps)"
                disabled={loading || saving || rendering}
              />
            </div>

            <div className="ace-field">
              <label htmlFor="ace-form">Song Form Blueprint</label>
              <textarea
                id="ace-form"
                rows={10}
                value={songForm}
                onChange={(event) => setSongForm(event.target.value)}
                placeholder="[intro]\n[verse 1]\n[pre-chorus]\n[chorus]\n[bridge]\n[outro]"
                disabled={loading || saving || rendering}
              />
              <p className="ace-hint">
                Each section should stay on its own line using the ACE bracket syntax. Add supporting cues such as [breakdown] or
                [drum fill] to influence transitions.
              </p>
            </div>

            <div className="ace-field-row">
              <div className="ace-field">
                <label htmlFor="ace-bpm">Tempo (BPM)</label>
                <input
                  id="ace-bpm"
                  type="number"
                  min="40"
                  max="400"
                  step="1"
                  value={bpm}
                  onChange={(event) => setBpm(event.target.value)}
                  disabled={loading || saving || rendering}
                />
              </div>
              <div className="ace-field">
                <label htmlFor="ace-guidance">Guidance</label>
                <input
                  id="ace-guidance"
                  type="range"
                  min="0.05"
                  max="2"
                  step="0.01"
                  value={guidance}
                  onChange={(event) => setGuidance(Number.parseFloat(event.target.value))}
                  disabled={loading || saving || rendering}
                />
                <div className="ace-range-value">{guidance.toFixed(2)}</div>
              </div>
            </div>

            <div className="ace-actions">
              <PrimaryButton type="submit" loading={saving} disabled={loading || rendering}>
                Save Blueprint
              </PrimaryButton>
              <PrimaryButton
                type="button"
                loading={rendering}
                disabled={loading || saving}
                onClick={handleRender}
              >
                Render via ComfyUI
              </PrimaryButton>
            </div>
          </form>
        </section>

        <aside className="card ace-card ace-template-card">
          <h2>Arrangement Ideas</h2>
          <p className="ace-hint">
            ACE-Step responds to bracketed sections such as [intro], [verse], [breakdown], and [drum fill]. Mix and match sections
            to storyboard energy changes across the track.
          </p>
          <div className="ace-template-list">
            {SONG_TEMPLATES.map((template) => (
              <div key={template.value} className={`ace-template${selectedTemplate === template.value ? " is-active" : ""}`}>
                <div>
                  <strong>{template.label}</strong>
                  <p className="ace-hint">{template.description}</p>
                  <ul className="ace-form-preview">
                    {template.songForm.split("\n").map((line, idx) => (
                      <li key={`${template.value}-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
                <PrimaryButton
                  type="button"
                  className="ace-button-sm"
                  onClick={() => handleApplyTemplate(template)}
                  disabled={loading || saving || rendering}
                >
                  Use Template
                </PrimaryButton>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {(statusMessage || jobStage || currentJobId || queuePosition !== null) && (
        <section className="card ace-card" role="status">
          <h2>Job Status</h2>
          {currentJobId && <p className="ace-hint">Job {currentJobId}</p>}
          {jobStage && <p className="ace-hint">Stage · {jobStage}</p>}
          {statusMessage && <p className="ace-hint">{statusMessage}</p>}
          {Number.isFinite(jobProgress) && jobProgress > 0 && jobProgress < 100 && (
            <progress max={100} value={jobProgress} />
          )}
          {queuePosition !== null && (
            <p className="ace-hint">
              Queue position {queuePosition + 1}
              {queueEtaSeconds !== null && ` · ETA ${formatEta(queueEtaSeconds)}`}
            </p>
          )}
        </section>
      )}

      {(error || statusError) && (
        <section className="card ace-card ace-error" role="alert">
          {error && <p>{error}</p>}
          {statusError && <p>{statusError}</p>}
        </section>
      )}

      <section className="card ace-card" aria-live="polite">
        <div className="ace-audio-header">
          <h2>Latest Renders</h2>
          <PrimaryButton
            type="button"
            className="ace-button-sm"
            onClick={() => loadRecentOutputs()}
            disabled={!isTauriEnv || outputsLoading}
            loading={outputsLoading}
          >
            Refresh
          </PrimaryButton>
        </div>
        {audioOutputs.length === 0 ? (
          <p className="ace-hint">Rendered audio will appear here once ComfyUI finishes a job.</p>
        ) : (
          <div className="ace-audio-grid">
            {audioOutputs.map((output, index) => (
              <div key={`${output.path}-${index}`} className="ace-audio-item">
                <strong>{output.name}</strong>
                <audio controls src={output.url || (output.path ? fileSrc(output.path) : undefined)} />
                <span className="ace-path">{output.path}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <JobQueuePanel queue={queue} onCancel={handleCancelJob} activeId={currentJobId} />
    </div>
  );
}
