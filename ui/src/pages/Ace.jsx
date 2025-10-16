import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton.jsx";
import PrimaryButton from "../components/PrimaryButton.jsx";
import JobQueuePanel from "../components/JobQueuePanel.jsx";
import { useJobQueue } from "../lib/useJobQueue.js";
import { fileSrc } from "../lib/paths.js";
import "./Ace.css";

const ACE_SONGFORM = {
  id: "ace-songform",
  label: "ACE SongForm · Kawaii Instrumental Storyboard",
  workflow: "audio_ace_step_1_t2a_instrumentals.json",
  logline:
    "Kawaii pop instrumental derived from the ACE-Step text-to-audio workflow; upbeat hooks, glitter percussion, and chopped ear candy.",
  stylePrompt:
    "kawaii pop instrumental, cute j-pop hooks, bouncy drums, percussive piano, plucky synth arps, glitter fx, upbeat, cheerful, lighthearted",
  bpm: 120,
  guidance: 0.99,
  sections: [
    {
      id: "count-in",
      tag: "[count-in sparkle]",
      label: "Count-In Sparkle",
      bars: 4,
      energy: "1 -> 2",
      focus: [
        "Preview the tempo with filtered noise swells, stick clicks, and glitter transitions.",
        "Hint at the main hook through distant plucks drenched in shimmer reverb.",
      ],
    },
    {
      id: "instrumental-hook",
      tag: "[instrumental hook]",
      label: "Instrumental Hook",
      bars: 16,
      energy: "3",
      focus: [
        "Stack bright pluck leads with toy piano to anchor the hook.",
        "Keep a four-on-the-floor kick and sidechained bass pushing momentum.",
      ],
    },
    {
      id: "verse-a",
      tag: "[verse bounce a]",
      label: "Verse Bounce A",
      bars: 16,
      energy: "3 -> 4",
      focus: [
        "Switch to syncopated rim-click drums and handclaps to freshen the groove.",
        "Trade phrases between clean guitar chops and square-wave counter melodies.",
      ],
    },
    {
      id: "breakdown",
      tag: "[breakdown shimmer]",
      label: "Breakdown Shimmer",
      bars: 8,
      energy: "2",
      focus: [
        "Low-pass the rhythm bed, leaving pads, bell swells, and vinyl noise textures.",
        "Automate delay throws and gentle bitcrush sweeps to build anticipation.",
      ],
    },
    {
      id: "drum-fill",
      tag: "[drum fill]",
      label: "Drum Fill Launch",
      bars: 4,
      energy: "4",
      focus: [
        "Fire tom runs and snare rushes that rise in pitch toward the drop.",
        "Accent transitions with anime shout FX or cymbal swells for extra hype.",
      ],
    },
    {
      id: "chorus-a",
      tag: "[chorus lift]",
      label: "Chorus Lift",
      bars: 16,
      energy: "5",
      focus: [
        "Layer saw leads, octave guitars, and glittering arps for the full hook.",
        "Glue the mix with pumping sidechain and crisp crash punctuation.",
      ],
    },
    {
      id: "verse-b",
      tag: "[verse bounce b]",
      label: "Verse Bounce B",
      bars: 16,
      energy: "3",
      focus: [
        "Drop into halftime drums for four bars before snapping back to full pace.",
        "Introduce fresh ear candy such as kalimba plucks or mallet hits to evolve the story.",
      ],
    },
    {
      id: "chops",
      tag: "[chopped samples]",
      label: "Chopped Samples Drop",
      bars: 8,
      energy: "4",
      focus: [
        "Let ACE-Step glitch the hook with stuttered vocal chops and tape stop tricks.",
        "Keep drums sparse so the resampled textures take the spotlight.",
      ],
    },
    {
      id: "chorus-b",
      tag: "[chorus finale]",
      label: "Chorus Finale",
      bars: 16,
      energy: "5",
      focus: [
        "Return with full instrumentation plus octave stacks and counter-hooks.",
        "Widen leads and add cymbal flourishes to signal the climax.",
      ],
    },
    {
      id: "outro",
      tag: "[outro sparkle]",
      label: "Outro Sparkle",
      bars: 8,
      energy: "2 -> 1",
      focus: [
        "Fade to bell arps, pads, and softened drums for a gentle landing.",
        "Let delay and reverb tails linger to close on a dreamy texture.",
      ],
    },
  ],
  transitions: [
    {
      cue: "[instrumental hook] -> [verse bounce a]",
      note: "Soften the lead into bell layers while drums add syncopation to open space for the verse groove.",
    },
    {
      cue: "[breakdown shimmer] -> [drum fill]",
      note: "Mute the low end during the breakdown so the tom run and snare rush erupt cleanly into the drop.",
    },
    {
      cue: "[chopped samples] -> [chorus finale]",
      note: "Bounce between chopped motifs and full-kit hits, then fire a final snare roll to sling back into the closing chorus.",
    },
  ],
  highlights: [
    "Keep one descriptive tag per line (for example, `[verse bounce a]` and `[breakdown shimmer]`) to guide ACE-Step.",
    "Blend clean guitar plucks, kawaii synth leads, bubbly percussion, and glitter FX to stay on palette.",
    "Drop `[chopped samples]` before `[chorus finale]` to request glitch edits ahead of the last lift.",
  ],
};

const ACE_SONGFORM_LINES = ACE_SONGFORM.sections.map((section) => section.tag).join("\n");
const ACE_SONGFORM_TOTAL_BARS = ACE_SONGFORM.sections.reduce((sum, section) => sum + section.bars, 0);

const ACE_DEFAULT_GUIDANCE = ACE_SONGFORM.guidance;
const ACE_DEFAULT_BPM = ACE_SONGFORM.bpm;
const ACE_SONGFORM_DURATION_SECONDS = Math.round((ACE_SONGFORM_TOTAL_BARS * 240) / ACE_SONGFORM.bpm);

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
  const [stylePrompt, setStylePrompt] = useState(ACE_SONGFORM.stylePrompt);
  const [songForm, setSongForm] = useState(ACE_SONGFORM_LINES);
  const [bpm, setBpm] = useState(ACE_DEFAULT_BPM);
  const [guidance, setGuidance] = useState(ACE_DEFAULT_GUIDANCE);
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

  const aceSongFormDurationLabel = useMemo(() => formatEta(ACE_SONGFORM_DURATION_SECONDS), []);

  const pollTimeoutRef = useRef(null);
  const jobIdRef = useRef(null);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

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
      setError("Provide at least one section in the song form (e.g., [count-in sparkle], [chorus lift]).");
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

  const handleApplySongForm = useCallback(() => {
    setStylePrompt(ACE_SONGFORM.stylePrompt);
    setSongForm(ACE_SONGFORM_LINES);
    setBpm(ACE_SONGFORM.bpm);
    setGuidance(ACE_SONGFORM.guidance);
    setStatusMessage("Reset to ACE SongForm blueprint.");
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
          Build from the ACE SongForm derived from the ACE-Step workflow, queue renders through ComfyUI, and audition the latest
          outputs without leaving Blossom.
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
              <label htmlFor="ace-style">Style & Instrumentation</label>
              <textarea
                id="ace-style"
                rows={4}
                value={stylePrompt}
                onChange={(event) => setStylePrompt(event.target.value)}
                placeholder={ACE_SONGFORM.stylePrompt}
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
                placeholder={ACE_SONGFORM_LINES}
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

        <aside className="card ace-card ace-songform-card">
          <div className="ace-songform-header">
            <div>
              <h2>ACE SongForm</h2>
              <p className="ace-hint">{ACE_SONGFORM.logline}</p>
              <p className="ace-hint">
                Workflow · <code className="ace-code">{ACE_SONGFORM.workflow}</code>
              </p>
            </div>
            <PrimaryButton
              type="button"
              className="ace-button-sm"
              onClick={handleApplySongForm}
              disabled={loading || saving || rendering}
            >
              Apply to Blueprint
            </PrimaryButton>
          </div>

          <div className="ace-songform-meta">
            <span>{ACE_SONGFORM.bpm} BPM</span>
            <span>Guidance {ACE_SONGFORM.guidance.toFixed(2)}</span>
            <span>
              {ACE_SONGFORM_TOTAL_BARS} bars · ~{aceSongFormDurationLabel}
            </span>
          </div>

          <div className="ace-songform-grid">
            {ACE_SONGFORM.sections.map((section, index) => (
              <article key={section.id} className="ace-songform-section">
                <header className="ace-songform-section-header">
                  <span className="ace-songform-order">{String(index + 1).padStart(2, "0")}</span>
                  <div className="ace-songform-section-meta">
                    <span className="ace-songform-tag">{section.tag}</span>
                    <h3>{section.label}</h3>
                    <div className="ace-songform-stats">
                      <span>{section.bars} bars</span>
                      <span>Energy {section.energy}</span>
                    </div>
                  </div>
                </header>
                <ul className="ace-songform-focus">
                  {section.focus.map((item, focusIndex) => (
                    <li key={`${section.id}-focus-${focusIndex}`}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="ace-songform-details">
            <div>
              <strong>Transitions</strong>
              <ul>
                {ACE_SONGFORM.transitions.map((transition, idx) => (
                  <li key={`transition-${idx}`}>
                    <span className="ace-songform-tag">{transition.cue}</span> · {transition.note}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Highlights</strong>
              <ul>
                {ACE_SONGFORM.highlights.map((highlight, idx) => (
                  <li key={`highlight-${idx}`}>{highlight}</li>
                ))}
              </ul>
            </div>
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
