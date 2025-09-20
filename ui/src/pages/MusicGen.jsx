import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { readFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import BackButton from "../components/BackButton.jsx";
import JobQueuePanel from "../components/JobQueuePanel.jsx";
import { useJobQueue } from "../lib/useJobQueue.js";
import { useSharedState, DEFAULT_MUSICGEN_FORM } from "../lib/sharedState.jsx";

const MODEL_OPTIONS = [
  { value: "small", label: "MusicGen Small" },
  { value: "medium", label: "MusicGen Medium" },
  { value: "melody", label: "MusicGen Melody" },
];

const TEMPLATE_CUSTOM_VALUE = "custom";

const PROMPT_TEMPLATES = [
  {
    value: "chill-vibes",
    label: "Chill Vibes",
    prompt:
      "Dreamy lofi beat at 70 BPM, warm Rhodes chords, soft vinyl noise, relaxed bass groove, cozy lounge mood",
  },
  {
    value: "late-night-drive",
    label: "Late Night Drive",
    prompt:
      "Smooth synthwave groove, pulsing bass arpeggios, neon-soaked pads, gentle 90 BPM beat, cinematic midnight highway energy",
  },
  {
    value: "sunrise-meditation",
    label: "Sunrise Meditation",
    prompt:
      "Peaceful ambient soundscape with glassy drones, soft bells, distant birds, slow 60 BPM heartbeat kick, uplifting dawn atmosphere",
  },
  {
    value: "summer-festival",
    label: "Summer Festival",
    prompt:
      "Energetic pop dance track at 120 BPM, bright synth leads, crowd claps, tropical plucks, euphoric summer celebration",
  },
  {
    value: "halloween-haunt",
    label: "Halloween Haunt",
    prompt:
      "Dark orchestral tension with eerie strings, whispering choirs, detuned music box, thunder rolls, spooky haunted mansion vibe",
  },
  {
    value: "winter-wonderland",
    label: "Winter Wonderland",
    prompt:
      "Festive orchestral waltz at 100 BPM, glistening sleigh bells, gentle choirs, warm strings, cozy fireplace Christmas mood",
  },
  {
    value: "retro-arcade",
    label: "Retro Arcade",
    prompt:
      "Upbeat chiptune adventure, punchy 8-bit drums, playful square-wave melodies, crunchy bassline, nostalgic pixel energy",
  },
  {
    value: "fantasy-quest",
    label: "Fantasy Quest",
    prompt:
      "Epic orchestral journey, soaring brass fanfare, sweeping strings, bodhran drums, 95 BPM heroic adventure through ancient lands",
  },
  {
    value: "futuristic-metropolis",
    label: "Futuristic Metropolis",
    prompt:
      "Atmospheric cyberpunk score, glitchy percussion, deep sub bass, shimmering synth textures, rain-soaked city skyline at night",
  },
  {
    value: "ocean-dreamscape",
    label: "Ocean Dreamscape",
    prompt:
      "Lush downtempo chillout, flowing pads, resonant marimba, gentle waves, 85 BPM underwater dream journey",
  },
];

const getTemplateValueForPrompt = (text) => {
  if (typeof text !== "string") return "";
  const normalized = text.trim();
  if (!normalized) return "";
  const match = PROMPT_TEMPLATES.find((template) => template.prompt === normalized);
  return match ? match.value : TEMPLATE_CUSTOM_VALUE;
};

export default function MusicGen() {
  const [prompt, setPrompt] = useState(DEFAULT_MUSICGEN_FORM.prompt);
  const [selectedTemplate, setSelectedTemplate] = useState(() =>
    getTemplateValueForPrompt(DEFAULT_MUSICGEN_FORM.prompt)
  );
  const [duration, setDuration] = useState(DEFAULT_MUSICGEN_FORM.duration);
  const [temperature, setTemperature] = useState(DEFAULT_MUSICGEN_FORM.temperature);
  const [modelName, setModelName] = useState(DEFAULT_MUSICGEN_FORM.modelName);
  const [name, setName] = useState(DEFAULT_MUSICGEN_FORM.name);
  const [audios, setAudios] = useState([]); // [{ url, path }]
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);
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
  const [storeReady, setStoreReady] = useState(false);
  const { queue, refresh: refreshQueue } = useJobQueue();
  const storeRef = useRef(null);
  const outputDirDirtyRef = useRef(false);
  const { ready: sharedReady, state: sharedState, updateSection } = useSharedState();
  const restoredRef = useRef(false);
  const jobIdRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const jobRequestRef = useRef(null);

  const formatSeconds = useCallback((value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, []);

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const createBlobUrlForPath = useCallback(async (absPath) => {
    if (typeof absPath !== "string" || !absPath) return "";
    // Prefer direct file URL to avoid large memory copies or fetch hangs.
    try {
      const src = convertFileSrc(absPath);
      if (typeof src === "string" && src) return src;
    } catch {}
    return "";
  }, []);

  const poll = useCallback(
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
        setProgress(percent);
        const stageText = progressInfo.stage || status || "";
        setStage(stageText);
        setStatusMessage(progressInfo.message || "");
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
        refreshQueue();

        if (status === "queued" || status === "running") {
          setGenerating(true);
          clearPollTimeout();
          pollTimeoutRef.current = setTimeout(() => {
            poll(id);
          }, 1000);
          return;
        }

        clearPollTimeout();
        setGenerating(false);
        setQueuePosition(null);
        setQueueEtaSeconds(null);

        const stdoutLines = Array.isArray(data?.stdout) ? data.stdout : [];
        let parsedSummary = null;
        for (let i = stdoutLines.length - 1; i >= 0; i -= 1) {
          const line = stdoutLines[i];
          if (typeof line !== "string") continue;
          const trimmed = line.trim();
          if (trimmed.startsWith("SUMMARY:")) {
            const jsonText = trimmed.slice("SUMMARY:".length).trim();
            if (jsonText) {
              try {
                parsedSummary = JSON.parse(jsonText);
              } catch (err) {
                console.warn("Failed to parse MusicGen summary", err, jsonText);
              }
            }
            break;
          }
        }

        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
        const request = jobRequestRef.current || {};
        const completedAt = new Date().toISOString();

        const baseSummary = {
          prompt: request.prompt || "",
          duration: request.duration ?? DEFAULT_MUSICGEN_FORM.duration,
          temperature: request.temperature ?? DEFAULT_MUSICGEN_FORM.temperature,
          modelName: request.modelName || DEFAULT_MUSICGEN_FORM.modelName,
          name: request.name || "",
          melodyPath: request.melodyPath || "",
          count: request.count ?? DEFAULT_MUSICGEN_FORM.count,
          outputDir: request.outputDir || "",
          forceCpu: Boolean(request.forceCpu),
          forceGpu: Boolean(request.forceGpu),
          useFp16: Boolean(request.useFp16),
          stage: stageText,
          progress: percent,
        };

        const finishJob = (summaryRecord) => {
          jobRequestRef.current = null;
          jobIdRef.current = null;
          setJobId(null);
          if (sharedReady) {
            updateSection("musicgen", (prev) => ({
              activeJobId: null,
              job: {
                id,
                status: summaryRecord.success ? "completed" : summaryRecord.cancelled ? "cancelled" : "error",
                summary: summaryRecord,
                request,
              },
              lastSummary: summaryRecord,
            }));
          }
        };

        if (status === "completed") {
          const audioArtifacts = artifacts.filter((artifact) => {
            const path = artifact?.path;
            return typeof path === "string" && path.toLowerCase().endsWith(".wav");
          });
          const newAudios = [];
          for (const artifact of audioArtifacts) {
            const path = artifact.path;
            const url = await createBlobUrlForPath(path);
            if (url && jobIdRef.current === id) {
              const label =
                typeof artifact.name === "string" && artifact.name
                  ? artifact.name
                  : path;
              newAudios.push({ url, path, name: label });
            }
          }
          if (jobIdRef.current !== id) {
            newAudios.forEach((entry) => URL.revokeObjectURL(entry.url));
            return;
          }
          setAudios((prev) => {
            if (Array.isArray(prev)) {
              prev.forEach((entry) => URL.revokeObjectURL(entry.url));
            }
            return newAudios;
          });

          const deviceInfo =
            (typeof parsedSummary?.device === "string" && parsedSummary.device) ||
            (typeof data?.device === "string" && data.device) ||
            (request.forceCpu ? "cpu" : "");
          setDevice(deviceInfo || "");
          const fallbackReasonRaw =
            parsedSummary?.fallback_reason || parsedSummary?.fallbackReason || "";
          const fallbackReason = fallbackReasonRaw ? String(fallbackReasonRaw) : "";
          const fallbackFlag = Boolean(parsedSummary?.fallback);
          const fallbackText = fallbackFlag
            ? `Fell back to CPU${fallbackReason ? `: ${fallbackReason.slice(0, 180)}` : ""}`
            : "";
          setFallbackMsg(fallbackText);
          setError(null);
          setStage("completed");
          const messageText =
            (typeof parsedSummary?.status_message === "string" && parsedSummary.status_message) ||
            (typeof parsedSummary?.statusMessage === "string" && parsedSummary.statusMessage) ||
            progressInfo.message ||
            "Completed";
          setStatusMessage(messageText);
          setProgress(100);

          const summaryRecord = {
            ...baseSummary,
            device: deviceInfo || "",
            fallback: fallbackFlag,
            fallbackReason,
            fallbackMsg: fallbackText,
            paths: newAudios.map((entry) => entry.path),
            success: true,
            error: null,
            completedAt,
            statusMessage: messageText,
          };
          finishJob(summaryRecord);
          refreshQueue();
          return;
        }

        const stderrLines = Array.isArray(data?.stderr) ? data.stderr : [];
        let stderrMsg = "";
        for (let i = stderrLines.length - 1; i >= 0; i -= 1) {
          const candidate = stderrLines[i];
          if (typeof candidate === "string" && candidate.trim()) {
            stderrMsg = candidate.trim();
            break;
          }
        }
        const summaryError =
          (typeof parsedSummary?.error === "string" && parsedSummary.error.trim()) ||
          "";

        if (status === "cancelled" || data?.cancelled) {
          const cancelDevice =
            (typeof parsedSummary?.device === "string" && parsedSummary.device) ||
            (request.forceCpu ? "cpu" : "");
          setDevice(cancelDevice || "");
          setStage("cancelled");
          setStatusMessage("Job cancelled by user.");
          setFallbackMsg(parsedSummary?.fallbackMsg || "");
          setError(null);
          setAudios((prev) => {
            if (Array.isArray(prev)) {
              prev.forEach((entry) => URL.revokeObjectURL(entry.url));
            }
            return [];
          });
          const summaryRecord = {
            ...baseSummary,
            device: parsedSummary?.device || (request.forceCpu ? "cpu" : ""),
            fallback: Boolean(parsedSummary?.fallback),
            fallbackReason: parsedSummary?.fallback_reason || parsedSummary?.fallbackReason || "",
            fallbackMsg: parsedSummary?.fallbackMsg || "",
            paths: Array.isArray(parsedSummary?.paths) ? parsedSummary.paths : [],
            success: false,
            cancelled: true,
            error: "Job cancelled by user.",
            completedAt,
            statusMessage: "Job cancelled by user.",
          };
          finishJob(summaryRecord);
          refreshQueue();
          return;
        }

        const errorDevice =
          (typeof parsedSummary?.device === "string" && parsedSummary.device) ||
          (request.forceCpu ? "cpu" : "");
        setDevice(errorDevice || "");
        const errorFallbackReason =
          parsedSummary?.fallback_reason || parsedSummary?.fallbackReason || "";
        let errorFallbackMsg = "";
        if (typeof parsedSummary?.fallbackMsg === "string" && parsedSummary.fallbackMsg) {
          errorFallbackMsg = parsedSummary.fallbackMsg;
        } else if (parsedSummary?.fallback) {
          const reasonText = errorFallbackReason ? String(errorFallbackReason).slice(0, 180) : "";
          errorFallbackMsg = `Fell back to CPU${reasonText ? `: ${reasonText}` : ""}`;
        }
        setFallbackMsg(errorFallbackMsg);
        const errorMessage =
          (typeof data?.message === "string" && data.message.trim()) ||
          summaryError ||
          stderrMsg ||
          "Music generation failed.";
        setStage("error");
        setStatusMessage(errorMessage);
        setError(errorMessage);
        setAudios((prev) => {
          if (Array.isArray(prev)) {
            prev.forEach((entry) => URL.revokeObjectURL(entry.url));
          }
          return [];
        });
        const errorSummary = {
          ...baseSummary,
          device: parsedSummary?.device || (request.forceCpu ? "cpu" : ""),
          fallback: Boolean(parsedSummary?.fallback),
          fallbackReason: parsedSummary?.fallback_reason || parsedSummary?.fallbackReason || "",
          fallbackMsg: errorFallbackMsg,
          paths: Array.isArray(parsedSummary?.paths) ? parsedSummary.paths : [],
          success: false,
          error: errorMessage,
          completedAt,
          statusMessage: errorMessage,
        };
        finishJob(errorSummary);
        refreshQueue();
      } catch (err) {
        console.error("failed to fetch job status", err);
        if (jobIdRef.current === id) {
          clearPollTimeout();
          pollTimeoutRef.current = setTimeout(() => {
            poll(id);
          }, 2000);
        }
      }
    },
    [clearPollTimeout, createBlobUrlForPath, refreshQueue, sharedReady, updateSection]
  );

  const melodyFileName = melodyPath
    ? melodyPath.split(/[\\/]/).filter(Boolean).pop() || melodyPath
    : "";

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
    setSelectedTemplate(getTemplateValueForPrompt(formPrompt));
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

    let resolvedJobId = null;
    if (typeof job?.id === "number") {
      resolvedJobId = job.id;
    } else if (typeof saved.activeJobId === "number") {
      resolvedJobId = saved.activeJobId;
    }

    if (resolvedJobId != null) {
      jobIdRef.current = resolvedJobId;
      setJobId(resolvedJobId);
    } else {
      jobIdRef.current = null;
      setJobId(null);
    }

    const jobStatus = typeof job?.status === "string" ? job.status : null;
    const isActive =
      resolvedJobId != null && ["running", "queued"].includes(jobStatus || "");
    setGenerating(isActive);
    if (!isActive) {
      setStage(jobStatus === "completed" ? "completed" : "");
      setStatusMessage("");
      setProgress(jobStatus === "completed" ? 100 : 0);
      setQueuePosition(null);
      setQueueEtaSeconds(null);
    }

    jobRequestRef.current = job?.request || null;

    const summary = job?.summary || lastSummary || null;
    if (summary) {
      setDevice(summary.device || "");
      setFallbackMsg(summary.fallbackMsg || "");
      setError(summary.error ?? null);
      if (typeof summary.progress === "number") {
        setProgress(summary.progress);
      } else if (summary.success) {
        setProgress(100);
      }
      if (typeof summary.stage === "string") {
        setStage(summary.stage);
      }
      if (typeof summary.statusMessage === "string") {
        setStatusMessage(summary.statusMessage);
      }
    } else {
      setDevice("");
      setFallbackMsg("");
      setError(null);
    }

    let cancelled = false;
    const savedPaths = Array.isArray(summary?.paths)
      ? summary.paths.filter((p) => typeof p === "string" && p)
      : [];
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
        } else {
          entries.forEach((entry) => URL.revokeObjectURL(entry.url));
        }
      })();
    } else {
      setAudios([]);
    }

    restoredRef.current = true;

    return () => {
      cancelled = true;
    };
  }, [sharedReady, sharedState, createBlobUrlForPath]);

  useEffect(() => {
    if (!jobId) {
      clearPollTimeout();
      return undefined;
    }
    poll(jobId);
    return () => {
      clearPollTimeout();
    };
  }, [jobId, poll, clearPollTimeout]);

  useEffect(() => () => clearPollTimeout(), [clearPollTimeout]);

  // Load persisted outputDir on mount
  useEffect(() => {
    let disposed = false;
    (async () => {
      let store;
      try {
        store = await Store.load("ui-settings.json");
      } catch {
        if (!disposed) {
          setStoreReady(true);
        }
        return;
      }

      if (disposed) {
        try {
          await store.close();
        } catch {
          // ignore
        }
        return;
      }

      storeRef.current = store;

      let savedOutputDir;
      let savedModel;
      let savedCount;
      try {
        [savedOutputDir, savedModel, savedCount] = await Promise.all([
          store.get("musicgen.outputDir"),
          store.get("musicgen.modelName"),
          store.get("musicgen.count"),
        ]);
      } catch {
        savedOutputDir = undefined;
        savedModel = undefined;
        savedCount = undefined;
      }

      if (disposed) {
        return;
      }

      if (
        !outputDirDirtyRef.current &&
        typeof savedOutputDir === "string" &&
        savedOutputDir
      ) {
        setOutputDir(savedOutputDir);
      }
      if (typeof savedModel === "string" && savedModel) setModelName(savedModel);
      if (typeof savedCount === "number" && !Number.isNaN(savedCount)) setCount(savedCount);
      setStoreReady(true);
    })();

    return () => {
      disposed = true;
      const toClose = storeRef.current;
      storeRef.current = null;
      if (toClose) {
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
    if (!storeReady || !storeRef.current) return;
    (async () => {
      try {
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
  }, [outputDir, storeReady]);

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

  const handleTemplateChange = (event) => {
    const { value } = event.target;
    if (!value) {
      setSelectedTemplate("");
      return;
    }

    if (value === TEMPLATE_CUSTOM_VALUE) {
      setSelectedTemplate(TEMPLATE_CUSTOM_VALUE);
      return;
    }

    const template = PROMPT_TEMPLATES.find((entry) => entry.value === value);
    if (template) {
      setSelectedTemplate(value);
      setPrompt(template.prompt);
    } else {
      setSelectedTemplate(TEMPLATE_CUSTOM_VALUE);
    }
  };

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
    const safeCountRaw = Number.isFinite(count) && count > 0 ? count : DEFAULT_MUSICGEN_FORM.count;
    const safeCount = Math.min(Math.max(1, safeCountRaw), 10);

    clearPollTimeout();
    if (audios?.length) {
      audios.forEach((a) => URL.revokeObjectURL(a.url));
    }
    setAudios([]);
    setGenerating(true);
    setProgress(0);
    setStage("queued");
    setStatusMessage("Queued...");
    setQueuePosition(null);
    setQueueEtaSeconds(null);
    setDevice(forceCpu ? "cpu" : "");
    setFallbackMsg("");

    jobRequestRef.current = {
      prompt,
      duration: safeDuration,
      temperature: safeTemperature,
      modelName,
      name,
      melodyPath: modelName === "melody" ? melodyPath || "" : "",
      count: safeCount,
      outputDir: outputDir || "",
      forceCpu: !!forceCpu,
      forceGpu: !!forceGpu && !forceCpu,
      useFp16: !!useFp16 && !forceCpu,
    };

    const options = {
      prompt,
      duration: safeDuration,
      modelName,
      temperature: safeTemperature,
      forceCpu: !!forceCpu,
      forceGpu: !!forceGpu && !forceCpu,
      useFp16: !!useFp16 && !forceCpu,
      outputDir: outputDir || undefined,
      outputName: name || undefined,
      count: safeCount,
      melodyPath: modelName === "melody" ? melodyPath || undefined : undefined,
    };

    try {
      const id = await invoke("queue_musicgen_job", { options });
      jobIdRef.current = id;
      setJobId(id);
      if (sharedReady) {
        updateSection("musicgen", () => ({
          activeJobId: id,
          job: {
            id,
            status: "queued",
            request: { ...jobRequestRef.current },
          },
        }));
      }
      refreshQueue();
    } catch (err) {
      console.error("failed to enqueue musicgen job", err);
      jobRequestRef.current = null;
      jobIdRef.current = null;
      setJobId(null);
      setGenerating(false);
      setStage("");
      setStatusMessage("");
      setProgress(0);
      setQueuePosition(null);
      setQueueEtaSeconds(null);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (sharedReady) {
        updateSection("musicgen", () => ({ activeJobId: null }));
      }
      refreshQueue();
    }
  };

  const cancelJob = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return;
    try {
      await invoke("cancel_job", { jobId: id });
    } catch (err) {
      console.error("failed to cancel musicgen job", err);
    } finally {
      refreshQueue();
    }
  }, [refreshQueue]);

  const cancelFromQueue = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke("cancel_job", { jobId: id });
      } catch (err) {
        console.error("failed to cancel queued job", err);
      } finally {
        refreshQueue();
      }
    },
    [refreshQueue]
  );

  const download = (entry, idx = 0) => {
    if (!entry || !entry.url) return;
    const link = document.createElement("a");
    link.href = entry.url;
    const fallback = idx === 0 ? "musicgen.wav" : `musicgen_${idx + 1}.wav`;
    const name =
      typeof entry.name === "string" && entry.name
        ? entry.name
        : fallback;
    link.download = name;
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
      <h1 className="mb-md">Sound Lab</h1>
      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />
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
          <select
            className="mt-sm p-sm"
            value={selectedTemplate}
            onChange={handleTemplateChange}
            style={{ width: "100%" }}
          >
            <option value="">Choose a template…</option>
            {PROMPT_TEMPLATES.map((template) => (
              <option key={template.value} value={template.value}>
                {template.label}
              </option>
            ))}
            <option value={TEMPLATE_CUSTOM_VALUE}>Custom</option>
          </select>
          <textarea
            rows={5}
            className="mt-sm p-sm"
            placeholder="Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood"
            value={prompt}
            onChange={(e) => {
              const { value } = e.target;
              setPrompt(value);
              if (selectedTemplate !== TEMPLATE_CUSTOM_VALUE) {
                setSelectedTemplate(TEMPLATE_CUSTOM_VALUE);
              }
            }}
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
                outputDirDirtyRef.current = true;
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
                    outputDirDirtyRef.current = true;
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
                onClick={() => {
                  outputDirDirtyRef.current = true;
                  setOutputDir("");
                }}
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
        <div id="progress-placeholder" className="mt-md mb-md" style={{ display: "grid", gap: "0.5rem" }}>
          {generating ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <progress value={Math.max(0, Math.min(100, progress || 0))} max="100" />
              <div style={{ fontSize: "0.95rem" }}>
                {stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : "Queued"}
                {statusMessage ? ` – ${statusMessage}` : ""}
              </div>
              {typeof queuePosition === "number" && (
                <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
                  Queue position: {queuePosition + 1}
                </div>
              )}
              {typeof queueEtaSeconds === "number" && (
                <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
                  Estimated start: {formatSeconds(queueEtaSeconds)}
                </div>
              )}
              <div style={{ fontSize: "0.9rem", opacity: 0.9 }}>
                {device ? `Device: ${device.toUpperCase()}` : "Detecting device..."}
              </div>
              {fallbackMsg && (
                <div style={{ color: "var(--accent)", fontSize: "0.9rem" }}>{fallbackMsg}</div>
              )}
              <div>
                <button
                  type="button"
                  className="p-sm"
                  onClick={cancelJob}
                  style={{ background: "var(--button-bg)", color: "var(--text)" }}
                >
                  Cancel Job
                </button>
              </div>
            </div>
          ) : (
            <>
              {statusMessage && (
                <div style={{ fontSize: "0.95rem" }}>{statusMessage}</div>
              )}
              {device && (
                <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
                  Device: {device.toUpperCase()}
                </div>
              )}
              {fallbackMsg && (
                <div style={{ color: "var(--accent)", fontSize: "0.9rem" }}>{fallbackMsg}</div>
              )}
            </>
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
              <span style={{ fontSize: "0.9rem" }}>{a.name || `Track ${idx + 1}`}</span>
              <button
                type="button"
                className="p-sm"
                onClick={() => download(a, idx)}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                Download
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

