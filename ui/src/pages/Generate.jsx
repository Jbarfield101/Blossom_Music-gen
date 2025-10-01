import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fileSrc } from "../lib/paths.js";
import BackButton from "../components/BackButton.jsx";
import JobQueuePanel from "../components/JobQueuePanel.jsx";
import { useJobQueue } from "../lib/useJobQueue.js";

export default function AlgorithmicGenerator() {
  const formatSeconds = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
        2,
        "0"
      )}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0"
    )}`;
  };
  const [preset, setPreset] = useState("");
  const [presets, setPresets] = useState([]);
  const [style, setStyle] = useState("");
  const [styles, setStyles] = useState([]);
  const [minutes, setMinutes] = useState("");
  const [sections, setSections] = useState("");
  const [seed, setSeed] = useState(42);
  const [samplerSeed, setSamplerSeed] = useState("");
  const [mixPreset, setMixPreset] = useState("");
  const [name, setName] = useState("output");
  const [outdir, setOutdir] = useState("");
  const [mixConfig, setMixConfig] = useState(null);
  const [arrangeConfig, setArrangeConfig] = useState(null);
  const [drumsModel, setDrumsModel] = useState("");
  const [bassModel, setBassModel] = useState("");
  const [keysModel, setKeysModel] = useState("");
  const [preview, setPreview] = useState("");
  const [bundleStems, setBundleStems] = useState(false);
  const [evalOnly, setEvalOnly] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [keysSfz, setKeysSfz] = useState(null);
  const [padsSfz, setPadsSfz] = useState(null);
  const [bassSfz, setBassSfz] = useState(null);
  const [drumsSfz, setDrumsSfz] = useState(null);
  const [melodyMidi, setMelodyMidi] = useState(null);
  const [arrange, setArrange] = useState("");
  const [outro, setOutro] = useState("");
  const outdirPicker = useRef(null);

  const [drumsOptions, setDrumsOptions] = useState([]);
  const [bassOptions, setBassOptions] = useState([]);
  const [keysOptions, setKeysOptions] = useState([]);

  const [jobId, setJobId] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [eta, setEta] = useState("");
  const [log, setLog] = useState("");
  const [links, setLinks] = useState([]);
  const [summary, setSummary] = useState([]);
  const [metrics, setMetrics] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [completedJobs, setCompletedJobs] = useState([]);
  const { queue, refresh: refreshQueue } = useJobQueue();
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);

  const formatTimestamp = useCallback((value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }, []);

  useEffect(() => {
    async function loadOptions() {
      try {
        const [p, s, m] = await Promise.all([
          fetch("/presets").then((r) => r.json()),
          fetch("/styles").then((r) => r.json()),
          fetch("/models").then((r) => r.json()),
        ]);
        setPresets(p);
        setStyles(s);
        setDrumsOptions(m.filter((x) => x.startsWith("drums")));
        setBassOptions(m.filter((x) => x.startsWith("bass")));
        setKeysOptions(m.filter((x) => x.startsWith("keys")));
      } catch (e) {
        console.error("failed to load options", e);
      }
    }
    loadOptions();
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const jobs = await invoke("list_completed_jobs");
      if (Array.isArray(jobs)) {
        setCompletedJobs(jobs);
      }
      refreshQueue();
    } catch (err) {
      console.error("failed to load jobs", err);
    }
  }, [refreshQueue]);

  useEffect(() => {
    refreshJobs();
    const timer = setInterval(refreshJobs, 5000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  const randomizeSeed = () => setSeed(Math.floor(Math.random() * 1e9));
  const chooseOutdir = () => {
    if (outdirPicker.current) outdirPicker.current.click();
  };
  const outdirChanged = (e) => {
    const file = e.target.files[0];
    if (file) {
      const path = file.webkitRelativePath
        ? file.webkitRelativePath.split("/")[0]
        : file.path;
      setOutdir(path);
    }
  };

  const start = async () => {
    const mixConfigText = mixConfig ? await mixConfig.text() : undefined;
    const arrangeConfigText = arrangeConfig ? await arrangeConfig.text() : undefined;
    const options = {
      preset: preset || undefined,
      style: style || undefined,
      minutes: minutes ? Number(minutes) : undefined,
      sections: sections ? Number(sections) : undefined,
      seed: Number(seed),
      samplerSeed: samplerSeed ? Number(samplerSeed) : undefined,
      mixPreset: mixPreset || undefined,
      name: name || undefined,
      mixConfig: mixConfigText,
      arrangeConfig: arrangeConfigText,
      bundleStems,
      evalOnly,
      dryRun,
      keysSfz: keysSfz?.path || undefined,
      padsSfz: padsSfz?.path || undefined,
      bassSfz: bassSfz?.path || undefined,
      drumsSfz: drumsSfz?.path || undefined,
      melodyMidi: melodyMidi?.path || undefined,
      drumsModel: drumsModel || undefined,
      bassModel: bassModel || undefined,
      keysModel: keysModel || undefined,
      arrange: arrange || undefined,
      outro: outro || undefined,
      preview: preview ? Number(preview) : undefined,
      outdir: outdir || undefined,
    };

    setRunning(true);
    setLog("");
    setShowResults(false);
    setSummary([]);
    setMetrics("");
    setLinks([]);
    setQueuePosition(null);
    setQueueEtaSeconds(null);
    refreshQueue();
    try {
      const id = await invoke("queue_render_job", { options });
      setJobId(id);
      poll(id);
    } catch (err) {
      console.error("failed to start job", err);
      setRunning(false);
      setLog(err instanceof Error ? err.message : String(err));
    }
  };

  const cancelJobById = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke("cancel_job", { jobId: id });
        if (id === jobId) {
          setRunning(false);
          setQueuePosition(null);
          setQueueEtaSeconds(null);
        }
        refreshQueue();
        refreshJobs();
      } catch (err) {
        console.error("failed to cancel job", err);
      }
    },
    [jobId, refreshJobs, refreshQueue]
  );

  const cancel = async () => {
    if (!jobId) return;
    await cancelJobById(jobId);
  };

  const poll = async (id) => {
    if (!id) return;
    try {
      const data = await invoke("job_status", { jobId: id });
      const progressInfo = data?.progress || {};
      setProgress(progressInfo.percent || 0);
      setEta(progressInfo.eta || "");
      setStage(progressInfo.stage || "");
      setQueuePosition(
        typeof progressInfo.queue_position === "number"
          ? progressInfo.queue_position
          : null
      );
      setQueueEtaSeconds(
        typeof progressInfo.queue_eta_seconds === "number"
          ? progressInfo.queue_eta_seconds
          : null
      );
      const stdoutLines = Array.isArray(data.stdout) ? data.stdout : [];
      const stderrLines = Array.isArray(data.stderr) ? data.stderr : [];
      const combined = [...stdoutLines, ...stderrLines];
      setLog(combined.join("\n"));
      const status = data?.status;
      const isCancelled = Boolean(data?.cancelled) || status === "cancelled";
      if (status === "running" || status === "queued") {
        setRunning(true);
        setTimeout(() => poll(id), 1000);
      } else {
        setRunning(false);
        setQueuePosition(null);
        setQueueEtaSeconds(null);
        if (status === "completed") {
          const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
          setLinks(
            artifacts.map((artifact) => {
              const path = artifact.path || "";
              let href = "";
              try {
                href = path ? fileSrc(path) : "";
              } catch (err) {
                console.warn("Unable to convert artifact path", err);
              }
              return {
                name: artifact.name || path || "artifact",
                href,
                path,
              };
            })
          );
          setSummary([]);
          setMetrics("");
          setShowResults(true);
        } else if (isCancelled) {
          setStage("cancelled");
          setShowResults(false);
          setLinks([]);
          setSummary([]);
          setMetrics("");
          setLog((prev) =>
            prev ? `${prev}\nJob cancelled by user.` : "Job cancelled by user."
          );
        } else if (status === "error") {
          setSummary([]);
          setMetrics("");
          if (data.message) {
            setLog((prev) =>
              prev ? `${prev}\n${data.message}` : data.message
            );
          }
        }
        refreshJobs();
        refreshQueue();
      }
    } catch (err) {
      console.error("failed to fetch job status", err);
    }
  };

  return (
    <div>
      <BackButton />
      <JobQueuePanel
        queue={queue}
        onCancel={cancelJobById}
        activeId={jobId || undefined}
      />
      <h1>Music Generator</h1>
      <div>
        <label>
          Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="">Select</option>
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Style
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">(default)</option>
            {styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minutes
          <input
            type="number"
            step="0.1"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label>
          Sections
          <input
            type="number"
            value={sections}
            onChange={(e) => setSections(e.target.value)}
          />
        </label>
        <label>
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
          <button type="button" onClick={randomizeSeed} aria-label="Randomize seed">
            🎲
          </button>
        </label>
        <label>
          Sampler seed
          <input
            type="number"
            value={samplerSeed}
            onChange={(e) => setSamplerSeed(e.target.value)}
          />
        </label>
        <label>
          Mix preset
          <input
            type="text"
            value={mixPreset}
            onChange={(e) => setMixPreset(e.target.value)}
          />
        </label>
        <label>
          Output name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Output folder
          <input type="text" value={outdir} readOnly />
          <input
            type="file"
            ref={outdirPicker}
            style={{ display: "none" }}
            webkitdirectory=""
            directory=""
            onChange={outdirChanged}
          />
          <button type="button" onClick={chooseOutdir} aria-label="Choose output folder">
            📁
          </button>
        </label>
      </div>

      <details>
        <summary>Advanced</summary>
        <label>
          Mix config
          <input type="file" onChange={(e) => setMixConfig(e.target.files[0] || null)} />
        </label>
        <label>
          Arrange config
          <input
            type="file"
            onChange={(e) => setArrangeConfig(e.target.files[0] || null)}
          />
        </label>
        <label>
          Drums model
          <select
            value={drumsModel}
            onChange={(e) => setDrumsModel(e.target.value)}
          >
            <option value="">(default)</option>
            {drumsOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bass model
          <select
            value={bassModel}
            onChange={(e) => setBassModel(e.target.value)}
          >
            <option value="">(default)</option>
            {bassOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Keys model
          <select
            value={keysModel}
            onChange={(e) => setKeysModel(e.target.value)}
          >
            <option value="">(default)</option>
            {keysOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preview bars
          <input
            type="number"
            value={preview}
            onChange={(e) => setPreview(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={bundleStems}
            onChange={(e) => setBundleStems(e.target.checked)}
          />
          Bundle stems
        </label>
        <label>
          <input
            type="checkbox"
            checked={evalOnly}
            onChange={(e) => setEvalOnly(e.target.checked)}
          />
          Eval only
        </label>
        <label>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry run
        </label>
        <label>
          Keys SFZ
          <input type="file" onChange={(e) => setKeysSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Pads SFZ
          <input type="file" onChange={(e) => setPadsSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Bass SFZ
          <input type="file" onChange={(e) => setBassSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Drums SFZ
          <input type="file" onChange={(e) => setDrumsSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Melody MIDI
          <input type="file" onChange={(e) => setMelodyMidi(e.target.files[0] || null)} />
        </label>
        <label>
          Arrange
          <select value={arrange} onChange={(e) => setArrange(e.target.value)}>
            <option value="">(default)</option>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </label>
        <label>
          Outro
          <select value={outro} onChange={(e) => setOutro(e.target.value)}>
            <option value="">(default)</option>
            <option value="hit">hit</option>
            <option value="ritard">ritard</option>
          </select>
        </label>
      </details>

      <div style={{ marginTop: "1rem" }}>
        <button type="button" onClick={start} disabled={running}>
          Start
        </button>
        <button type="button" onClick={cancel} disabled={!running}>
          Cancel
        </button>
        <progress value={progress} max="100" />
        {queuePosition !== null && (
          <div className="queue-status">
            {`In queue: position ${queuePosition + 1}`}
            {queueEtaSeconds != null
              ? ` • ETA ${formatSeconds(queueEtaSeconds)}`
              : ""}
          </div>
        )}
        <span>{stage}</span>
        <span>{eta ? `ETA: ${eta}` : ""}</span>
        {jobId && (
          <div style={{ marginTop: "0.5rem" }}>
            Current job ID: <strong>{jobId}</strong>
          </div>
        )}
      </div>

      <pre
        style={{
          background: "var(--log-bg)",
          color: "var(--log-fg)",
          padding: "var(--space-sm)",
          height: "200px",
          overflowY: "scroll",
        }}
      >
        {log}
      </pre>

      {showResults && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Results</h3>
          <ul>
            {links.map((l) => (
              <li key={`${l.name}-${l.path || l.href}`}> 
                {l.href ? (
                  <a href={l.href} target="_blank" rel="noreferrer">
                    {l.name}
                  </a>
                ) : (
                  <span>{l.name}</span>
                )}
                {l.path && (
                  <small style={{ marginLeft: "0.5rem", color: "#6b7280" }}>
                    {l.path}
                  </small>
                )}
              </li>
            ))}
          </ul>
          <ul>
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <pre>{metrics}</pre>
        </div>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Completed Jobs</h2>
        {completedJobs.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="job-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.label || job.args?.[0] || ""}</td>
                    <td>{formatTimestamp(job.created_at || job.createdAt)}</td>
                    <td>{formatTimestamp(job.finished_at || job.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No completed jobs yet.</p>
        )}
      </section>
    </div>
  );
}

