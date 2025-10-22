import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton.jsx";
import { synthWithPiper } from "../lib/piperSynth";
import { listPiperVoices } from "../lib/piperVoices";
import { fileSrc } from "../lib/paths";
import "./GeneralChat.css";

const TARGET_SAMPLE_RATE = 16000;
const MIN_SPEECH_DURATION_SEC = 0.6;
const SILENCE_HOLD_SEC = 0.3;
const MAX_BUFFERED_SAMPLES = TARGET_SAMPLE_RATE * 12;

export default function GeneralChat() {
  const [modelOptions, setModelOptions] = useState([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content }
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [missingModel, setMissingModel] = useState("");
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState("");
  const [persona, setPersona] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const [liveDebug, setLiveDebug] = useState([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [voicePaths, setVoicePaths] = useState({ model: "", config: "" });

  const listRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const decodeAudioCtxRef = useRef(null);
  const chunkPromiseRef = useRef(Promise.resolve());
  const voiceQueueRef = useRef([]);
  const liveEnabledRef = useRef(liveEnabled);
  const voiceEnabledRef = useRef(voiceEnabled);
  const voicePathsRef = useRef(voicePaths);
  const lastStatusAtRef = useRef(Date.now());
  const vadStateRef = useRef({
    noiseFloor: 0.01,
    initialized: false,
    collecting: false,
    speechDuration: 0,
    silenceDuration: 0,
  });
  const speechBufferRef = useRef({ parts: [], totalSamples: 0 });
  const lastTranscriptRef = useRef(lastTranscript);

  const appendLiveDebug = useCallback((entry) => {
    setLiveDebug((prev) => {
      const next = prev.concat({
        at: Date.now(),
        ...entry,
      });
      const limit = 80;
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
  }, []);

  const resetVadState = useCallback(() => {
    vadStateRef.current = {
      noiseFloor: 0.01,
      initialized: false,
      collecting: false,
      speechDuration: 0,
      silenceDuration: 0,
    };
    speechBufferRef.current = { parts: [], totalSamples: 0 };
    lastStatusAtRef.current = Date.now();
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const appendMessage = useCallback(
    (message) => {
      setMessages((prev) => prev.concat(message));
      scrollToBottom();
    },
    [scrollToBottom]
  );

  useEffect(() => {
    liveEnabledRef.current = liveEnabled;
    if (!liveEnabled) {
      setLiveStatus("");
      setLastTranscript("");
      lastTranscriptRef.current = "";
      setLiveDebug([]);
      resetVadState();
      return;
    }
    resetVadState();
  }, [liveEnabled, resetVadState]);

  useEffect(() => {
    if (!liveEnabled) return;
    lastStatusAtRef.current = Date.now();
  }, [liveEnabled]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) {
      if (audioPlayerRef.current) {
        try {
          audioPlayerRef.current.pause();
        } catch {}
        audioPlayerRef.current = null;
      }
      setLiveStatus((prev) =>
        prev && (prev.startsWith("Speaking") || prev.startsWith("Voice playback failed"))
          ? ""
          : prev
      );
    }
    try {
      localStorage.setItem(
        "blossom.voiceRepliesEnabled",
        voiceEnabled ? "1" : "0"
      );
    } catch (e) {
      console.warn("Failed to persist voice reply preference", e);
    }
  }, [voiceEnabled]);

  useEffect(() => {
    voicePathsRef.current = voicePaths;
  }, [voicePaths]);

  useEffect(() => {
    lastTranscriptRef.current = lastTranscript;
  }, [lastTranscript]);

  useEffect(() => {
    if (!liveStatus) return;
    appendLiveDebug({ type: "status", status: liveStatus });
  }, [appendLiveDebug, liveStatus]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        const info = await invoke("list_llm");
        const opts = Array.isArray(info?.options) ? info.options : [];
        setModelOptions(opts);
        if (typeof info?.selected === "string" && info.selected) {
          setModel(info.selected);
        } else if (opts.length) {
          setModel(opts[0]);
        }
      } catch (e) {
        console.error("Failed to load LLM models", e);
      }
    };
    loadModels();
    // Load persona from a simple user store (users.json)
    (async () => {
      try {
        const cached = localStorage.getItem("blossom.currentUser");
        if (cached && typeof cached === "string") {
          setPersona(cached);
          return;
        }
        const { Store } = await import("@tauri-apps/plugin-store");
        const store = await Store.load("users.json");
        const current = await store.get("currentUser");
        const name = typeof current === "string" ? current : "";
        if (name) {
          localStorage.setItem("blossom.currentUser", name);
          setPersona(name);
        }
      } catch (e) {
        console.warn("Failed to load persona", e);
      }
    })();
    try {
      const saved = localStorage.getItem("blossom.liveChatEnabled");
      if (saved === "1") {
        setLiveEnabled(true);
      }
    } catch (e) {
      console.warn("Failed to read live chat preference", e);
    }
    try {
      const savedVoice = localStorage.getItem("blossom.voiceRepliesEnabled");
      if (savedVoice === "0") {
        setVoiceEnabled(false);
      }
    } catch (e) {
      console.warn("Failed to read voice reply preference", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("blossom.liveChatEnabled", liveEnabled ? "1" : "0");
    } catch (e) {
      console.warn("Failed to persist live chat preference", e);
    }
  }, [liveEnabled]);

  const changeModel = async (value) => {
    setModel(value);
    try {
      await invoke("set_llm", { model: value });
    } catch (e) {
      console.error("Failed to set model", e);
    }
  };

  const refreshVoiceSelection = useCallback(async () => {
    try {
      const [selection, voices] = await Promise.all([
        invoke("list_piper"),
        listPiperVoices(),
      ]);
      let selectedId = "";
      if (selection && typeof selection === "object") {
        const maybe = selection.selected;
        if (typeof maybe === "string" && maybe) {
          selectedId = maybe;
        }
      }
      let chosen = voices.find((voice) => voice.id === selectedId);
      if (!chosen && voices.length) {
        chosen = voices[0];
      }
      if (!chosen) {
        setVoicePaths({ model: "", config: "" });
        return;
      }
      let modelPath = "";
      let configPath = "";
      try {
        modelPath = await invoke("resolve_resource", { path: chosen.modelPath });
        configPath = await invoke("resolve_resource", { path: chosen.configPath });
      } catch (err) {
        modelPath = chosen.modelPath;
        configPath = chosen.configPath;
      }
      if (!modelPath || !configPath) {
        setVoicePaths({ model: "", config: "" });
        return;
      }
      setVoicePaths({ model: modelPath, config: configPath });
    } catch (err) {
      console.warn("Failed to refresh Piper voice", err);
      setVoicePaths({ model: "", config: "" });
    }
  }, []);

  useEffect(() => {
    refreshVoiceSelection();
  }, [refreshVoiceSelection]);

  useEffect(() => {
    if (liveEnabled || voiceEnabled) {
      refreshVoiceSelection();
    }
  }, [liveEnabled, voiceEnabled, refreshVoiceSelection]);

  const speakWithPiper = useCallback(
    async (text) => {
      if (!voiceEnabledRef.current) return;
      let { model: modelPath, config: configPath } = voicePathsRef.current;
      if (!modelPath || !configPath) {
        await refreshVoiceSelection();
        ({ model: modelPath, config: configPath } = voicePathsRef.current);
      }
      if (!modelPath || !configPath) {
        return;
      }
      try {
        setLiveStatus("Speaking…");
        const path = await synthWithPiper(text, modelPath, configPath, {});
        const url = fileSrc(path);
        if (!url) return;
        if (audioPlayerRef.current) {
          try {
            audioPlayerRef.current.pause();
          } catch {}
        }
        const audio = new Audio(url);
        audio.volume = 1.0;
        audioPlayerRef.current = audio;
        audio.addEventListener("ended", () => {
          if (liveEnabledRef.current) {
            setLiveStatus("Listening…");
          } else {
            setLiveStatus("");
          }
        });
        audio.play().catch((err) => {
          console.warn("Failed to play Piper audio", err);
          setLiveStatus((prev) =>
            prev && prev.startsWith("Voice playback failed")
              ? prev
              : `Voice playback failed: ${err?.message || err}`
          );
        });
      } catch (err) {
        console.warn("Failed to synthesize with Piper", err);
        const message = err instanceof Error ? err.message : String(err);
        setLiveStatus(`Voice playback failed: ${message}`);
      }
    },
    [refreshVoiceSelection]
  );

  const sendPrompt = useCallback(
    async (promptText) => {
      const prompt = (promptText || "").trim();
      if (!prompt || pending) return;
      setMissingModel("");
      setStatus("");
      setPending(true);
      appendMessage({ role: "user", content: prompt });
      try {
        const system = persona
          ? `You are Blossom, a helpful on-device AI assistant named Blossom. The user's name is ${persona}. Refer to yourself as "Blossom" and address the user by their name when appropriate. Be concise, friendly, and proactive.`
          : `You are Blossom, a helpful on-device AI assistant named Blossom. Be concise, friendly, and proactive.`;
        const reply = await invoke("generate_llm", { prompt, system });
        const text = typeof reply === "string" ? reply : String(reply || "");
        appendMessage({ role: "assistant", content: text });
        speakWithPiper(text);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const m =
          /model '([^']+)' not found/i.exec(err) ||
          /model\s+([^\s]+)\s+not\s+found/i.exec(err);
        if (m && m[1]) {
          const name = m[1];
          setMissingModel(name);
          setStatus(`Model '${name}' not found. Click Install to pull it.`);
        }
        appendMessage({ role: "assistant", content: `Error: ${err}` });
      } finally {
        setPending(false);
        scrollToBottom();
      }
    },
    [appendMessage, pending, persona, scrollToBottom, speakWithPiper]
  );

  const flushVoiceQueue = useCallback(async () => {
    if (pending) return;
    const next = voiceQueueRef.current.shift();
    if (!next) return;
    await sendPrompt(next);
    flushVoiceQueue();
  }, [pending, sendPrompt]);

  useEffect(() => {
    if (!pending) {
      flushVoiceQueue();
    }
  }, [pending, flushVoiceQueue]);

  const handleTranscript = useCallback(
    (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed) {
        if (liveEnabledRef.current) {
          setLiveStatus("Listening…");
        }
        return;
      }
      if (trimmed === lastTranscriptRef.current) {
        if (liveEnabledRef.current) {
          setLiveStatus("Listening…");
        }
        return;
      }
      lastTranscriptRef.current = trimmed;
      setLastTranscript(trimmed);
      voiceQueueRef.current.push(trimmed);
      if (!pending) {
        flushVoiceQueue();
      }
    },
    [flushVoiceQueue, pending]
  );

  const ensureDecodeContext = useCallback(async () => {
    let ctx = decodeAudioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      const AudioContextImpl =
        globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextImpl) {
        throw new Error("AudioContext not supported");
      }
      ctx = new AudioContextImpl();
      decodeAudioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    return ctx;
  }, []);

  const convertBlobToPCM = useCallback(
    async (blob) => {
      if (!blob || !blob.size) return null;
      const ctx = await ensureDecodeContext();
      const arrayBuffer = await blob.arrayBuffer();
      let decoded;
      try {
        decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch (err) {
        console.warn("Failed to decode audio", err);
        return null;
      }
      const OfflineContext =
        globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      if (!OfflineContext) {
        throw new Error("OfflineAudioContext not supported");
      }
      const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
      const offline = new OfflineContext(1, length, TARGET_SAMPLE_RATE);
      const source = offline.createBufferSource();
      let monoBuffer;
      if (decoded.numberOfChannels === 1) {
        monoBuffer = offline.createBuffer(1, decoded.length, decoded.sampleRate);
        monoBuffer.copyToChannel(decoded.getChannelData(0), 0);
      } else {
        const mix = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const data = decoded.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) {
            mix[i] += data[i];
          }
        }
        for (let i = 0; i < mix.length; i += 1) {
          mix[i] /= decoded.numberOfChannels;
        }
        monoBuffer = offline.createBuffer(1, mix.length, decoded.sampleRate);
        monoBuffer.copyToChannel(mix, 0);
      }
      source.buffer = monoBuffer;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const pcm = new Int16Array(samples.length);
      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < samples.length; i += 1) {
        let sample = samples[i];
        if (sample > 1) sample = 1;
        if (sample < -1) sample = -1;
        peak = Math.max(peak, Math.abs(sample));
        sumSquares += sample * sample;
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
      const durationSec = samples.length / TARGET_SAMPLE_RATE;
      return { pcm, peak, rms, durationSec };
    },
    [ensureDecodeContext]
  );

  const processAudioChunk = useCallback(
    async (blob) => {
      if (!liveEnabledRef.current) return;
      try {
        const result = await convertBlobToPCM(blob);
        if (!result) return;
        const { pcm, peak, rms, durationSec } = result;
        if (!pcm?.length) {
          return;
        }
        const state = vadStateRef.current;
        const logChunk = (stage, extra = {}) => {
          lastStatusAtRef.current = Date.now();
          appendLiveDebug({
            type: "chunk",
            stage,
            rms,
            peak,
            durationSec,
            noiseFloor: state.noiseFloor,
            speechDuration: state.speechDuration,
            silenceDuration: state.silenceDuration,
            ...extra,
          });
        };
        if (!state.initialized) {
          state.noiseFloor = Math.max(0.005, rms || peak || 0.005);
          state.initialized = true;
        }
        const noiseFloor = state.noiseFloor;
        const speechThreshold = noiseFloor * 1.8 + 0.003;
        const peakThreshold = Math.max(0.02, noiseFloor * 4);
        const isSpeech = rms > speechThreshold || peak > peakThreshold;

        if (!isSpeech) {
          state.noiseFloor = noiseFloor * 0.9 + rms * 0.1;
          if (!state.collecting) {
            if (liveEnabledRef.current) {
              setLiveStatus("Listening…");
            }
            logChunk("silence");
            return;
          }
          state.silenceDuration += durationSec;
          if (
            state.speechDuration >= MIN_SPEECH_DURATION_SEC &&
            state.silenceDuration >= SILENCE_HOLD_SEC
          ) {
            const buffered = speechBufferRef.current;
            speechBufferRef.current = { parts: [], totalSamples: 0 };
            state.collecting = false;
            state.speechDuration = 0;
            state.silenceDuration = 0;
            if (!buffered.totalSamples) {
              if (liveEnabledRef.current) {
                setLiveStatus("Listening…");
              }
              logChunk("silence");
              return;
            }
            const merged = new Int16Array(buffered.totalSamples);
            let offset = 0;
            for (const part of buffered.parts) {
              merged.set(part, offset);
              offset += part.length;
            }
            setLiveStatus("Transcribing…");
            logChunk("transcribing", { bufferedSamples: merged.length });
            const bytes = new Uint8Array(merged.buffer);
            const audio = Array.from(bytes);
            const text = await invoke("transcribe_whisper", { audio });
            const transcript = typeof text === "string" ? text.trim() : "";
            if (!transcript) {
              setLiveStatus("Listening…");
              appendLiveDebug({ type: "whisper", result: "empty" });
              return;
            }
            setLiveStatus(`Heard: ${transcript}`);
            appendLiveDebug({
              type: "whisper",
              result: "transcript",
              transcript,
            });
            handleTranscript(transcript);
            setTimeout(() => {
              if (liveEnabledRef.current) {
                setLiveStatus("Listening…");
              }
            }, 1500);
            return;
          }
          if (state.silenceDuration >= SILENCE_HOLD_SEC) {
            speechBufferRef.current = { parts: [], totalSamples: 0 };
            state.collecting = false;
            state.speechDuration = 0;
            state.silenceDuration = 0;
            if (liveEnabledRef.current) {
              setLiveStatus("Listening…");
            }
            logChunk("reset");
          } else if (liveEnabledRef.current) {
            setLiveStatus("Speech detected…");
          }
          logChunk("silence");
          return;
        }

        state.collecting = true;
        state.speechDuration += durationSec;
        state.silenceDuration = 0;
        state.noiseFloor = noiseFloor * 0.995 + rms * 0.005;
        const buffer = speechBufferRef.current;
        buffer.parts.push(pcm);
        buffer.totalSamples += pcm.length;
        if (buffer.totalSamples > MAX_BUFFERED_SAMPLES) {
          let totalKept = 0;
          const retained = [];
          for (let i = buffer.parts.length - 1; i >= 0; i -= 1) {
            const part = buffer.parts[i];
            if (retained.length && totalKept + part.length > MAX_BUFFERED_SAMPLES) {
              break;
            }
            retained.unshift(part);
            totalKept += part.length;
          }
          buffer.parts = retained;
          buffer.totalSamples = totalKept;
        }
        if (liveEnabledRef.current) {
          setLiveStatus("Speech detected…");
        }
        logChunk("speech", { bufferedSamples: buffer.totalSamples });
      } catch (err) {
        console.error("Transcription failed", err);
        const message = err instanceof Error ? err.message : String(err);
        setLiveStatus(`Transcription failed: ${message}`);
        appendLiveDebug({ type: "error", message });
        lastStatusAtRef.current = Date.now();
      }
    },
    [appendLiveDebug, convertBlobToPCM, handleTranscript]
  );

  const queueAudioChunk = useCallback(
    (blob) => {
      if (!blob || !blob.size) return;
      if (!liveEnabledRef.current) return;
      chunkPromiseRef.current = chunkPromiseRef.current
        .catch(() => {})
        .then(() => processAudioChunk(blob));
    },
    [processAudioChunk]
  );

  const liveDebugString = useMemo(() => {
    const formatNumber = (value) =>
      typeof value === "number" && Number.isFinite(value)
        ? value.toFixed(value >= 1 ? 2 : 4)
        : "n/a";
    return liveDebug
      .map((entry) => {
        const stamp = new Date(entry.at).toLocaleTimeString(undefined, {
          hour12: false,
        });
        if (entry.type === "chunk") {
          const buffered = entry.bufferedSamples ? ` buffered=${entry.bufferedSamples}` : "";
          return `${stamp} chunk:${entry.stage} dur=${formatNumber(entry.durationSec)}s rms=${formatNumber(entry.rms)} peak=${formatNumber(entry.peak)} noise=${formatNumber(entry.noiseFloor)} speech=${formatNumber(entry.speechDuration)}s silence=${formatNumber(entry.silenceDuration)}s${buffered}`;
        }
        if (entry.type === "whisper") {
          if (entry.result === "transcript") {
            return `${stamp} whisper: ${entry.transcript}`;
          }
          return `${stamp} whisper: (empty result)`;
        }
        if (entry.type === "error") {
          return `${stamp} error: ${entry.message}`;
        }
        if (entry.type === "status") {
          return `${stamp} status: ${entry.status}`;
        }
        if (entry.type === "watchdog") {
          return `${stamp} watchdog: elapsed=${formatNumber(
            entry.elapsedMs / 1000
          )}s threshold=${formatNumber(entry.thresholdMs / 1000)}s`;
        }
        return `${stamp} ${JSON.stringify(entry)}`;
      })
      .join("\n");
  }, [liveDebug]);

  const hasLiveDebug = liveDebugString.length > 0;

  const copyLiveDebug = useCallback(async () => {
    if (!hasLiveDebug) return;
    try {
      await navigator.clipboard.writeText(liveDebugString);
    } catch (err) {
      console.error("Failed to copy diagnostics", err);
    }
  }, [hasLiveDebug, liveDebugString]);

  const stopLiveResources = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      mediaStreamRef.current = null;
    }
    if (decodeAudioCtxRef.current) {
      try {
        decodeAudioCtxRef.current.close();
      } catch {}
      decodeAudioCtxRef.current = null;
    }
    chunkPromiseRef.current = Promise.resolve();
    resetVadState();
  }, [resetVadState]);

  useEffect(() => {
    if (!liveEnabled) return undefined;
    const intervalMs = 1000;
    const thresholdMs = SILENCE_HOLD_SEC * 1000 * 2.5;
    const intervalId = setInterval(() => {
      if (!liveEnabledRef.current) return;
      const last = lastStatusAtRef.current || 0;
      const now = Date.now();
      if (last && now - last > thresholdMs) {
        lastStatusAtRef.current = now;
        const state = vadStateRef.current;
        state.collecting = false;
        state.speechDuration = 0;
        state.silenceDuration = 0;
        speechBufferRef.current = { parts: [], totalSamples: 0 };
        if (liveEnabledRef.current) {
          setLiveStatus("Listening…");
        }
        appendLiveDebug({
          type: "watchdog",
          elapsedMs: now - last,
          thresholdMs,
        });
      }
    }, intervalMs);
    return () => {
      clearInterval(intervalId);
    };
  }, [appendLiveDebug, liveEnabled]);

  useEffect(() => {
    if (!liveEnabled) {
      stopLiveResources();
      return;
    }
    let cancelled = false;
    const start = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setLiveStatus("Microphone not available");
        setLiveEnabled(false);
        appendLiveDebug({ type: "error", message: "Microphone not available" });
        return;
      }
      try {
        setLiveStatus("Requesting microphone…");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1 },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
        const options = {};
        const preferred = "audio/webm;codecs=opus";
        if (
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported &&
          MediaRecorder.isTypeSupported(preferred)
        ) {
          options.mimeType = preferred;
        }
        const recorder =
          Object.keys(options).length > 0
            ? new MediaRecorder(stream, options)
            : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size) {
            queueAudioChunk(event.data);
          }
        });
        recorder.addEventListener("error", (event) => {
          const message = event?.error?.message || "Recording error";
          setLiveStatus(`Recording error: ${message}`);
          appendLiveDebug({ type: "error", message });
        });
        recorder.addEventListener("stop", () => {
          if (liveEnabledRef.current) {
            setLiveStatus("Listening…");
          }
        });
        recorder.start(3500);
        setLiveStatus("Listening…");
      } catch (err) {
        console.error("Failed to access microphone", err);
        const message = err instanceof Error ? err.message : String(err);
        setLiveStatus(`Microphone error: ${message}`);
        setLiveEnabled(false);
        appendLiveDebug({ type: "error", message });
      }
    };
    start();
    return () => {
      cancelled = true;
      stopLiveResources();
    };
  }, [appendLiveDebug, liveEnabled, queueAudioChunk, stopLiveResources]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      stopLiveResources();
      if (audioPlayerRef.current) {
        try {
          audioPlayerRef.current.pause();
        } catch {}
        audioPlayerRef.current = null;
      }
    };
  }, [stopLiveResources]);

  const send = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || pending) return;
    setInput("");
    sendPrompt(prompt);
  }, [input, pending, sendPrompt]);

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  return (
    <div className="m-md" style={{ display: "grid", gap: "0.75rem" }}>
      <BackButton />
      <h1>General Chat</h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <label>
          Model
          <select
            className="ml-sm"
            value={model}
            onChange={(e) => changeModel(e.target.value)}
          >
            {modelOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        {missingModel && (
          <button
            type="button"
            className="p-sm"
            disabled={installing}
            onClick={async () => {
              try {
                setInstalling(true);
                setStatus(`Installing '${missingModel}'… This can take several minutes.`);
                await invoke("pull_llm", { model: missingModel });
                setStatus(`Installed '${missingModel}'. Select it and try again.`);
                try {
                  const info = await invoke("list_llm");
                  const opts = Array.isArray(info?.options) ? info.options : [];
                  setModelOptions(opts);
                } catch {}
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setStatus(`Install failed: ${msg}`);
              } finally {
                setInstalling(false);
              }
            }}
          >
            {installing ? "Installing…" : `Install '${missingModel}'`}
          </button>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(event) => setVoiceEnabled(event.target.checked)}
          />
          Speak replies
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={liveEnabled}
            onChange={(event) => setLiveEnabled(event.target.checked)}
          />
          Listen to me (Live Chat)
        </label>
      </div>
      {status && <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>{status}</div>}
      {(liveEnabled || liveStatus || lastTranscript) && (
        <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>
          {liveStatus || (liveEnabled ? "Listening…" : "")}
          {lastTranscript && (
            <div style={{ marginTop: "0.2rem", opacity: 0.85 }}>
              Last transcript: <em>{lastTranscript}</em>
            </div>
          )}
        </div>
      )}
      <div className="live-debug-card">
        <div className="live-debug-card__header">
          <span className="live-debug-card__title">Live diagnostics</span>
          <button
            type="button"
            className="live-debug-card__copy"
            onClick={copyLiveDebug}
            disabled={!hasLiveDebug}
          >
            Copy
          </button>
        </div>
        <pre className="live-debug-card__content">{hasLiveDebug ? liveDebugString : "No diagnostics captured yet."}</pre>
      </div>
      <div
        ref={listRef}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.75rem",
          minHeight: 240,
          maxHeight: 420,
          overflowY: "auto",
          background: "var(--card-bg)",
        }}
      >
        {persona && (
          <div style={{ marginBottom: "0.5rem", fontSize: "0.9rem", opacity: 0.8 }}>
            User: <strong>{persona}</strong> • Assistant: <strong>Blossom</strong>
          </div>
        )}
        {messages.length === 0 ? (
          <div style={{ opacity: 0.7 }}>Start a conversation with the model.</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`chat-message chat-message--${m.role}`}>
              <div className="chat-message__role">
                {m.role === "user" ? "You" : "Blossom"}
              </div>
              <div className="chat-message__content">{m.content}</div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.5rem" }}>
        <textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message…"
          disabled={pending}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div>
          <button type="submit" className="p-sm" disabled={pending || !input.trim()}>
            {pending ? "Thinking…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
