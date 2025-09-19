import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { readFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import BackButton from "../components/BackButton.jsx";
import { useSharedState, DEFAULT_MUSICGEN_FORM } from "../lib/sharedState.jsx";

const MODEL_OPTIONS = [
  { value: "small", label: "MusicGen Small" },
  { value: "medium", label: "MusicGen Medium" },
  { value: "melody", label: "MusicGen Melody" },
];

export default function MusicGen() {
  const [prompt, setPrompt] = useState(DEFAULT_MUSICGEN_FORM.prompt);
  const [duration, setDuration] = useState(DEFAULT_MUSICGEN_FORM.duration);
  const [temperature, setTemperature] = useState(DEFAULT_MUSICGEN_FORM.temperature);
  const [modelName, setModelName] = useState(DEFAULT_MUSICGEN_FORM.modelName);
  const [name, setName] = useState(DEFAULT_MUSICGEN_FORM.name);
  const [audioSrc, setAudioSrc] = useState(null);
  const [audios, setAudios] = useState([]); // [{ url, path }]
  const [melodyPath, setMelodyPath] = useState(DEFAULT_MUSICGEN_FORM.melodyPath);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [device, setDevice] = useState("");
  const [forceCpu, setForceCpu] = useState(DEFAULT_MUSICGEN_FORM.forceCpu);
  const [forceGpu, setForceGpu] = useState(DEFAULT_MUSICGEN_FORM.forceGpu);
  const [useFp16, setUseFp16] = useState(DEFAULT_MUSICGEN_FORM.useFp16);
  const [envInfo, setEnvInfo] = useState(null);
  const [outputDir, setOutputDir] = useState("");
  const [outputDirError, setOutputDirError] = useState("");
  const [count, setCount] = useState(DEFAULT_MUSICGEN_FORM.count);
  const [fallbackMsg, setFallbackMsg] = useState("");
  const [formError, setFormError] = useState("");
  const storeRef = useRef(null);
  const { ready: sharedReady, state: sharedState, updateSection } = useSharedState();
  const restoredRef = useRef(false);
  const jobIdRef = useRef(null);

  const melodyFileName = melodyPath
    ? melodyPath.split(/[\\/]/).filter(Boolean).pop() || melodyPath
    : "";

  const createBlobUrlForPath = useCallback(async (absPath) => {
    if (typeof absPath !== "string" || !absPath) return "";
    try {
      const data = await readFile(absPath);
      const blob = new Blob([data], { type: "audio/wav" });
      return URL.createObjectURL(blob);
    } catch {}

    try {
      const base = await appDataDir();
      const norm = (s) => String(s || "").replace(/\\\\/g, "/").toLowerCase();
      const nBase = norm(base);
      const nPath = norm(absPath);
      if (nPath.startsWith(nBase)) {
        const rel = nPath.substring(nBase.length);
        const data = await readFile(rel, { baseDir: BaseDirectory.AppData });
        const blob = new Blob([data], { type: "audio/wav" });
        return URL.createObjectURL(blob);
      }
    } catch {}

    try {
      const bytes = await invoke("read_file_bytes", { path: absPath });
      if (bytes) {
        const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
        return URL.createObjectURL(blob);
      }
    } catch {}

    if (typeof fetch === "function") {
      try {
        const src = convertFileSrc(absPath);
        const response = await fetch(src);
        if (response.ok) {
          const blob = await response.blob();
          return URL.createObjectURL(blob);
        }
      } catch {}
    }

    return "";
  }, []);

  useEffect(() => {
    if (!sharedReady || restoredRef.current) return undefined;

    const saved = sharedState?.musicgen || {};
    const form = saved.form || {};
    const formPrompt = typeof form.prompt === "string" ? form.prompt : DEFAULT_MUSICGEN_FORM.prompt;
    const formDuration =
      typeof form.duration === "number" && Number.isFinite(form.duration)
        ? form.duration
        : DEFAULT_MUSICGEN_FORM.duration;
    const formTemperature =
      typeof form.temperature === "number" && Number.isFinite(form.temperature)
        ? form.temperature
        : DEFAULT_MUSICGEN_FORM.temperature;
    const formModel = typeof form.modelName === "string" && form.modelName ? form.modelName : DEFAULT_MUSICGEN_FORM.modelName;
    const formName = typeof form.name === "string" ? form.name : DEFAULT_MUSICGEN_FORM.name;
    const formMelody = typeof form.melodyPath === "string" ? form.melodyPath : DEFAULT_MUSICGEN_FORM.melodyPath;
    const formCount =
      typeof form.count === "number" && Number.isFinite(form.count) && form.count > 0
        ? form.count
        : DEFAULT_MUSICGEN_FORM.count;

    setPrompt(formPrompt);
    setDuration(formDuration);
    setTemperature(formTemperature);
    setModelName(formModel);
    setName(formName);
    setMelodyPath(formMelody);
    setForceCpu(Boolean(form.forceCpu));
    setForceGpu(Boolean(form.forceGpu));
    setUseFp16(Boolean(form.useFp16));
    setCount(formCount);

    const job = saved.job || null;
    const lastSummary = saved.lastSummary || null;
    if (job?.id) {
      jobIdRef.current = job.id;
    } else if (saved.activeJobId) {
      jobIdRef.current = saved.activeJobId;
    } else {
      jobIdRef.current = null;
    }

    if (job?.status === "running" && saved.activeJobId) {
      setGenerating(true);
    } else {
      setGenerating(false);
    }

    const summary =
      job?.status === "running"
        ? lastSummary
        : job?.summary || lastSummary;

    if (summary) {
      setDevice(summary.device || "");
      setFallbackMsg(summary.fallbackMsg || "");
      setError(summary.error ?? null);
    } else {
      setDevice("");
      setFallbackMsg("");
      setError(null);
    }

    let cancelled = false;
    const savedPaths = Array.isArray(summary?.paths) ? summary.paths : [];
    if (savedPaths.length) {
      (async () => {
        const entries = [];
        for (const path of savedPaths) {
          const url = await createBlobUrlForPath(path);
          if (url) {
            entries.push({ url, path });
          }
        }
        if (!cancelled) {
          setAudios(entries);
          setAudioSrc(entries[0]?.url || null);
        } else {
          entries.forEach((entry) => URL.revokeObjectURL(entry.url));
        }
      })();
    } else {
      setAudios([]);
      setAudioSrc(null);
    }

    restoredRef.current = true;

    return () => {
      cancelled = true;
    };
  }, [sharedReady, sharedState, createBlobUrlForPath]);

  // Load persisted outputDir on mount
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const store = await Store.load("ui-settings.json");
        if (disposed) {
          try {
            await store.close();
          } catch {
            // ignore
          }
          return;
        }
        storeRef.current = store;
        const saved = await store.get("musicgen.outputDir");
        if (typeof saved === "string" && saved) setOutputDir(saved);
        const savedModel = await store.get("musicgen.modelName");
        if (typeof savedModel === "string" && savedModel) setModelName(savedModel);
        const savedCount = await store.get("musicgen.count");
        if (typeof savedCount === "number" && !Number.isNaN(savedCount)) setCount(savedCount);
      } catch {
        // ignore
      }
    })();

    return () => {
      disposed = true;
      if (storeRef.current) {
        const toClose = storeRef.current;
        storeRef.current = null;
        (async () => {
          try {
            await toClose.close();
          } catch {
            // ignore
          }
        })();
      }
    };
  }, []);

  // Persist outputDir whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        if (outputDir) {
          await storeRef.current.set("musicgen.outputDir", outputDir);
        } else {
          await storeRef.current.delete("musicgen.outputDir");
        }
        await storeRef.current.save();
      } catch {
        // ignore
      }
    })();
  }, [outputDir]);

  // Persist modelName whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        if (modelName) {
          await storeRef.current.set("musicgen.modelName", modelName);
          await storeRef.current.save();
        }
      } catch {}
    })();
  }, [modelName]);

  // Persist count whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        const n = Number(count) || 1;
        await storeRef.current.set("musicgen.count", n);
        await storeRef.current.save();
      } catch {}
    })();
  }, [count]);

  useEffect(() => {
    if (!sharedReady || !restoredRef.current) return;
    const safeDuration = Number.isFinite(duration)
      ? duration
      : DEFAULT_MUSICGEN_FORM.duration;
    const safeTemperature = Number.isFinite(temperature)
      ? temperature
      : DEFAULT_MUSICGEN_FORM.temperature;
    const safeCount =
      Number.isFinite(count) && count > 0 ? count : DEFAULT_MUSICGEN_FORM.count;
    updateSection("musicgen", (prev) => ({
      form: {
        ...prev.form,
        prompt,
        duration: safeDuration,
        temperature: safeTemperature,
        modelName,
        name,
        melodyPath,
        forceCpu,
        forceGpu,
        useFp16,
        count: safeCount,
      },
    }));
  }, [
    sharedReady,
    updateSection,
    prompt,
    duration,
    temperature,
    modelName,
    name,
    melodyPath,
    forceCpu,
    forceGpu,
    useFp16,
    count,
  ]);

  useEffect(() => {
    if (modelName === "melody") {
      setFormError(
        melodyPath
          ? ""
          : "Select a melody clip before generating with the melody model."
      );
    } else {
      setFormError("");
    }
  }, [modelName, melodyPath]);

  const generate = async (e) => {
    e.preventDefault();
    if (modelName === "melody" && !melodyPath) {
      const message = "Select a melody clip before generating with the melody model.";
      setFormError(message);
      setError(null);
      return;
    }
    setFormError("");
    setError(null);

    const safeDuration = Number.isFinite(duration)
      ? duration
      : DEFAULT_MUSICGEN_FORM.duration;
    const safeTemperature = Number.isFinite(temperature)
      ? temperature
      : DEFAULT_MUSICGEN_FORM.temperature;
    const safeCount =
      Number.isFinite(count) && count > 0 ? count : DEFAULT_MUSICGEN_FORM.count;

    const jobId = `musicgen-${Date.now()}`;
    const startedAt = new Date().toISOString();
    jobIdRef.current = jobId;

    setGenerating(true);
    if (audios?.length) {
      audios.forEach((a) => URL.revokeObjectURL(a.url));
      setAudios([]);
    }
    setAudioSrc(null);
    const initialDevice = forceCpu ? "cpu" : "";
    setDevice(initialDevice);
    setFallbackMsg("");

    if (sharedReady) {
      updateSection("musicgen", () => ({
        activeJobId: jobId,
        job: {
          id: jobId,
          status: "running",
          startedAt,
          finishedAt: null,
          summary: {
            prompt,
            duration: safeDuration,
            temperature: safeTemperature,
            modelName,
            name,
            melodyPath: modelName === "melody" ? melodyPath || "" : "",
            count: safeCount,
            outputDir: outputDir || "",
            device: initialDevice,
            fallback: false,
            fallbackReason: "",
            fallbackMsg: "",
            paths: [],
            success: false,
            error: null,
          },
        },
      }));
    }

    try {
      const result = await invoke("generate_musicgen", {
        prompt,
        duration: safeDuration,
        modelName,
        temperature: safeTemperature,
        forceCpu: !!forceCpu,
        forceGpu: !!forceGpu && !forceCpu,
        useFp16: !!useFp16,
        outputDir: outputDir || undefined,
        outputName: name || undefined,
        count: safeCount,
        melodyPath: modelName === "melody" ? melodyPath || undefined : undefined,
      });

      const path = typeof result === "string" ? result : result?.path;
      const rawPaths = Array.isArray(result?.paths)
        ? result.paths
        : path
        ? [path]
        : [];
      const normalizedPaths = rawPaths.filter((p) => typeof p === "string" && p);
      try {
        const base = await appDataDir();
        // eslint-disable-next-line no-console
        console.log("MusicGen result.path:", path);
        // eslint-disable-next-line no-console
        console.log("appDataDir():", base);
      } catch {}
      const dev = typeof result === "object" && result?.device ? result.device : "";
      if (dev) {
        setDevice(dev);
      }
      const fb = Boolean(result?.fallback);
      const fr =
        typeof result === "object" && result?.fallback_reason
          ? String(result.fallback_reason)
          : "";
      const fallbackText = fb ? `Fell back to CPU: ${fr.slice(0, 180)}` : "";
      setFallbackMsg(fallbackText);

      const blobUrls = [];
      for (const p of normalizedPaths) {
        const blobUrl = await createBlobUrlForPath(p);
        if (blobUrl) {
          blobUrls.push({ url: blobUrl, path: p });
        }
      }
      setAudios(blobUrls);
      setAudioSrc(blobUrls[0]?.url || null);

      const completedAt = new Date().toISOString();
      if (sharedReady) {
        updateSection("musicgen", (prev) => {
          const prevJob = prev.job || {};
          const summary = {
            prompt,
            duration: safeDuration,
            temperature: safeTemperature,
            modelName,
            name,
            melodyPath: modelName === "melody" ? melodyPath || "" : "",
            count: safeCount,
            outputDir: outputDir || "",
            device: dev || initialDevice,
            fallback: fb,
            fallbackReason: fr,
            fallbackMsg: fallbackText,
            paths: normalizedPaths,
            success: true,
            error: null,
            completedAt,
          };
          return {
            activeJobId: null,
            job: {
              id: jobId,
              status: "completed",
              startedAt: prevJob.id === jobId ? prevJob.startedAt : startedAt,
              finishedAt: completedAt,
              summary,
            },
            lastSummary: summary,
          };
        });
      }
    } catch (err) {
      console.error("music generation failed", err);
      const message = String(err);
      setError(message);
      const completedAt = new Date().toISOString();
      if (sharedReady) {
        updateSection("musicgen", (prev) => {
          const prevJob = prev.job || {};
          const prevSummary = prevJob.summary || {};
          const summary = {
            prompt,
            duration: safeDuration,
            temperature: safeTemperature,
            modelName,
            name,
            melodyPath: modelName === "melody" ? melodyPath || "" : "",
            count: safeCount,
            outputDir: outputDir || "",
            device: prevSummary.device || initialDevice,
            fallback: prevSummary.fallback ?? false,
            fallbackReason: prevSummary.fallbackReason || "",
            fallbackMsg: prevSummary.fallbackMsg || "",
            paths: Array.isArray(prevSummary.paths) ? prevSummary.paths : [],
            success: false,
            error: message,
            completedAt,
          };
          return {
            activeJobId: null,
            job: {
              id: jobId,
              status: "error",
              startedAt: prevJob.id === jobId ? prevJob.startedAt : startedAt,
              finishedAt: completedAt,
              summary,
            },
            lastSummary: summary,
          };
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const download = (url, idx = 0) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = idx === 0 ? "musicgen.wav" : `musicgen_${idx + 1}.wav`;
    link.click();
  };

  useEffect(() => {
    return () => {
      if (audios?.length) {
        audios.forEach((a) => URL.revokeObjectURL(a.url));
      }
    };
  }, [audios]);

  return (
    <>
      <BackButton />
      <h1 className="mb-md">MusicGen</h1>
      <form
        onSubmit={generate}
        className="p-md"
        style={{ background: "var(--card-bg)", color: "var(--text)" }}
      >
        <label className="mb-md" style={{ display: "block" }}>
          Name (optional)
          <input
            type="text"
            className="mt-sm p-sm"
            placeholder="My Awesome Track"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label className="mb-md" style={{ display: "block" }}>
          Prompt
          <textarea
            rows={5}
            className="mt-sm p-sm"
            placeholder="Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ width: "100%", resize: "vertical" }}
          />
        </label>
        <label className="mb-md">
          Duration: {duration}s
          <input
            type="range"
            min="15"
            max="120"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-sm"
          />
        </label>
        <label className="mb-md">
          Model
          <select
            id="model-select"
            className="mt-sm p-sm"
            value={modelName}
            onChange={(e) => {
              const value = e.target.value;
              setModelName(value);
              if (value === "melody") {
                setFormError(
                  melodyPath
                    ? ""
                    : "Select a melody clip before generating with the melody model."
                );
              } else {
                setFormError("");
              }
            }}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {modelName === "melody" && (
          <div className="mb-md">
            <div style={{ marginBottom: "0.25rem" }}>Melody Reference</div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="p-sm"
                onClick={async () => {
                  try {
                    const res = await open({
                      multiple: false,
                      filters: [
                        {
                          name: "Audio Clip",
                          extensions: ["wav", "mp3"],
                        },
                      ],
                    });
                    if (!res) return;
                    const selected = Array.isArray(res)
                      ? typeof res[0] === "string"
                        ? res[0]
                        : res[0]?.path
                      : typeof res === "string"
                      ? res
                      : res?.path;
                    if (selected) {
                      setMelodyPath(selected);
                      setFormError("");
                    } else {
                      const message = "Could not determine the selected file. Please try again.";
                      console.error(message, res);
                      setFormError(message);
                    }
                  } catch (err) {
                    console.error("Melody picker failed", err);
                    setFormError("Failed to open the file picker. Please try again.");
                  }
                }}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                {melodyPath ? "Change Clip" : "Choose Clip"}
              </button>
              {melodyPath ? (
                <span style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>
                  {melodyFileName}
                </span>
              ) : (
                <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>No clip selected</span>
              )}
              {melodyPath && (
                <button
                  type="button"
                  className="p-sm"
                  onClick={() => {
                    setMelodyPath("");
                    setFormError("Select a melody clip before generating with the melody model.");
                  }}
                  style={{ background: "var(--button-bg)", color: "var(--text)" }}
                >
                  Clear
                </button>
              )}
            </div>
            <div style={{ marginTop: "0.25rem", fontSize: "0.85rem", opacity: 0.7 }}>
              A WAV or MP3 clip is required for melody guidance. Only the first 30 seconds will be used.
            </div>
            {formError && (
              <div className="error" style={{ marginTop: "0.5rem" }}>
                {formError}
              </div>
            )}
          </div>
        )}
        <label className="mb-md">
        Temperature: {temperature}
        <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="mt-sm"
          />
        </label>
        <label className="mb-md">
          Count: {count}
          <input
            type="range"
            min="1"
            max="5"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="mt-sm"
          />
        </label>
        <div className="mb-md">
          <div style={{ marginBottom: "0.25rem" }}>Output Folder</div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => {
                setOutputDir(e.target.value);
                if (outputDirError) setOutputDirError("");
              }}
              className="p-sm"
              placeholder="Default (App Data directory)"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="p-sm"
              onClick={async () => {
                try {
                  setOutputDirError("");
                  const res = await open({ directory: true, multiple: false, defaultPath: outputDir || undefined });
                  if (!res) return;
                  const path =
                    Array.isArray(res)
                      ? typeof res[0] === "string"
                        ? res[0]
                        : res[0]?.path
                      : typeof res === "string"
                      ? res
                      : res?.path;
                  if (path) {
                    setOutputDir(path);
                  } else {
                    const message = "Failed to determine output directory from selection";
                    console.error(message, res);
                    setOutputDirError("Could not determine the selected folder. Please try again.");
                  }
                } catch (err) {
                  console.error('Folder selection failed', err);
                  setOutputDirError("Failed to open the folder picker. Please try again.");
                }
              }}
              style={{ background: "var(--button-bg)", color: "var(--text)" }}
            >
              Browse…
            </button>
            {outputDir && (
              <button
                type="button"
                className="p-sm"
                onClick={() => setOutputDir("")}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                Use Default
              </button>
            )}
          </div>
          {outputDirError && (
            <div className="error" style={{ marginTop: "0.5rem" }}>
              {outputDirError}
            </div>
          )}
        </div>
        <label className="mb-md" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={forceCpu}
            onChange={(e) => setForceCpu(e.target.checked)}
          />
          Force CPU
        </label>
        <div className="mb-md" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={forceGpu}
              onChange={(e) => setForceGpu(e.target.checked)}
              disabled={forceCpu}
            />
            Force GPU
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={useFp16}
              onChange={(e) => setUseFp16(e.target.checked)}
              disabled={forceCpu}
            />
            Use FP16 on GPU (lower VRAM)
          </label>
        </div>
        <button
          type="submit"
          disabled={
            generating || (modelName === "melody" && !melodyPath)
          }
          className="mt-md p-sm"
          style={{ background: "var(--button-bg)", color: "var(--text)" }}
        >
          Generate
        </button>
        <div id="progress-placeholder" className="mt-md mb-md">
          {generating && (
            <>
              <progress />
              <span style={{ marginLeft: "0.5rem", opacity: 0.8 }}>
                {device ? `Using ${device.toUpperCase()}` : "Detecting device..."}
              </span>
            </>
          )}
          {!generating && device && (
            <span style={{ marginLeft: "0.5rem", opacity: 0.8 }}>
              Using {device.toUpperCase()}
            </span>
          )}
          {!generating && fallbackMsg && (
            <div className="mt-sm" style={{ color: "var(--accent)", fontSize: "0.9rem" }}>
              {fallbackMsg}
            </div>
          )}
        </div>
      </form>
      <div className="mt-sm" style={{ background: "var(--card-bg)", padding: "var(--space-sm)" }}>
        <button
          type="button"
          className="p-sm"
          onClick={async () => {
            try {
              const info = await invoke("musicgen_env");
              setEnvInfo(info);
              if (info?.device) setDevice(info.device);
            } catch (e) {
              setEnvInfo({ error: String(e) });
            }
          }}
          style={{ background: "var(--button-bg)", color: "var(--text)" }}
        >
          Check Environment
        </button>
        {envInfo && (
          <div className="mt-sm" style={{ fontSize: "0.9rem", opacity: 0.9 }}>
            <div>Device: {envInfo.device?.toUpperCase?.() || ""}</div>
            {envInfo.cuda_available && (
              <>
                <div>GPU: {envInfo.name || "Unknown"}</div>
                <div>
                  CUDA: {envInfo.cuda_version || "Unknown"} • Torch: {envInfo.torch || ""}
                </div>
                {(envInfo.total_mem != null) && (
                  <div>
                    VRAM: {Math.round(envInfo.total_mem / (1024 ** 3))} GB total, {Math.round(envInfo.free_mem / (1024 ** 3))} GB free
                  </div>
                )}
              </>
            )}
            {envInfo.error && (
              <div style={{ color: "var(--accent)" }}>Error: {envInfo.error}</div>
            )}
          </div>
        )}
      </div>
      {audios?.length > 0 && (
        <div className="mt-sm" style={{ display: "grid", gap: "0.5rem" }}>
          {audios.map((a, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <audio src={a.url} controls />
              <button
                type="button"
                className="p-sm"
                onClick={() => download(a.url, idx)}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                Download {idx + 1}
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div
          className="mt-md"
          role="alert"
          style={{ color: "var(--accent)", background: "var(--card-bg)", padding: "var(--space-sm)" }}
        >
          <strong>Something went wrong:</strong> {error}
        </div>
      )}
    </>
  );
}

