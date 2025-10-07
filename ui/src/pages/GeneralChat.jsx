import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import BackButton from "../components/BackButton.jsx";
import { synthWithPiper } from "../lib/piperSynth";
import { listPiper as apiListPiper } from "../api/models";
import { listPiperVoices } from "../lib/piperVoices";
import { fileSrc } from "../lib/paths";
import "./GeneralChat.css";

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
  const [liveChatEnabled, setLiveChatEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceConfig, setVoiceConfig] = useState(null);
  const listRef = useRef(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const voiceStateRef = useRef(null);
  const lastSpokenIndexRef = useRef(-1);
  const audioRef = useRef(null);

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

  const stopVoice = useCallback(() => {
    const state = voiceStateRef.current;
    if (!state) {
      return;
    }
    voiceStateRef.current = null;
    state.active = false;
    try {
      state.processor?.disconnect();
    } catch {}
    try {
      state.source?.disconnect();
    } catch {}
    try {
      state.gain?.disconnect();
    } catch {}
    if (state.stream) {
      try {
        state.stream.getTracks().forEach((track) => track.stop());
      } catch {}
    }
    if (state.audioContext) {
      try {
        state.audioContext.close();
      } catch {}
    }
    if (mountedRef.current) {
      setVoiceStatus("");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopVoice();
    };
  }, [stopVoice]);

  const startVoice = useCallback(async () => {
    if (voiceStateRef.current) {
      voiceStateRef.current.active = true;
      if (mountedRef.current) {
        setVoiceStatus("Listening for speech…");
      }
      return;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      setVoiceStatus("Microphone capture not supported in this environment.");
      setLiveChatEnabled(false);
      return;
    }
    try {
      if (mountedRef.current) {
        setVoiceStatus("Initializing microphone…");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Web Audio API is unavailable");
      }
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      source.connect(processor);
      processor.connect(gain);
      gain.connect(audioContext.destination);

      const state = {
        stream,
        audioContext,
        source,
        processor,
        gain,
        chunks: [],
        prebuffer: [],
        silenceMs: 0,
        speaking: false,
        sampleRate: audioContext.sampleRate || 16000,
        totalSamples: 0,
        queue: Promise.resolve(),
        active: true,
      };

      const flushChunks = () => {
        if (!state.chunks.length || !mountedRef.current || !state.active) {
          state.chunks = [];
          state.prebuffer = [];
          state.totalSamples = 0;
          state.silenceMs = 0;
          state.speaking = false;
          return;
        }
        const slices = state.chunks.slice();
        state.chunks = [];
        state.prebuffer = [];
        state.totalSamples = 0;
        state.silenceMs = 0;
        state.speaking = false;
        const total = slices.reduce((sum, chunk) => sum + chunk.length, 0);
        if (!total) {
          return;
        }
        const merged = new Int16Array(total);
        let offset = 0;
        for (const chunk of slices) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        const payload = Array.from(new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength));
        const sr = Math.max(8000, Math.min(96000, Math.round(state.sampleRate || 16000)));
        const processChunk = async () => {
          if (!mountedRef.current || !voiceStateRef.current || !voiceStateRef.current.active) {
            return;
          }
          let errorMessage = "";
          try {
            setVoiceStatus("Transcribing voice input…");
            const result = await invoke("transcribe_whisper", { audio: payload, sampleRate: sr });
            const transcript = typeof result === "string" ? result : result?.text;
            const text = typeof transcript === "string" ? transcript.trim() : "";
            if (!text) {
              return;
            }
            if (pendingRef.current) {
              await new Promise((resolve) => {
                const poll = () => {
                  if (!pendingRef.current || !mountedRef.current) {
                    resolve();
                    return;
                  }
                  setTimeout(poll, 120);
                };
                poll();
              });
            }
            await send(text, { keepInput: true });
          } catch (err) {
            errorMessage = err instanceof Error ? err.message : String(err);
            console.error("Whisper transcription failed", err);
            if (mountedRef.current) {
              setVoiceStatus(`Whisper error: ${errorMessage}`);
            }
          } finally {
            if (!mountedRef.current || !voiceStateRef.current || !voiceStateRef.current.active) {
              return;
            }
            if (!errorMessage) {
              setVoiceStatus("Listening for speech…");
            }
          }
        };
        state.queue = state.queue.then(processChunk);
      };

      processor.onaudioprocess = (event) => {
        if (!mountedRef.current || !state.active) {
          return;
        }
        const buffer = event?.inputBuffer;
        if (!buffer) {
          return;
        }
        const channel = buffer.getChannelData(0);
        if (!channel) {
          return;
        }
        const sr = buffer.sampleRate || state.audioContext.sampleRate || state.sampleRate;
        if (!Number.isFinite(sr) || sr <= 0) {
          return;
        }
        state.sampleRate = sr;
        const len = channel.length;
        const chunk = new Int16Array(len);
        let max = 0;
        for (let i = 0; i < len; i += 1) {
          const sample = Math.max(-1, Math.min(1, channel[i] || 0));
          const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
          chunk[i] = intSample;
          const abs = Math.abs(sample);
          if (abs > max) {
            max = abs;
          }
        }
        const threshold = 0.02;
        const durationMs = (len / sr) * 1000;
        if (max > threshold) {
          if (!state.speaking && state.prebuffer.length) {
            for (const pre of state.prebuffer) {
              state.chunks.push(pre);
              state.totalSamples += pre.length;
            }
            state.prebuffer = [];
          }
          state.speaking = true;
          state.silenceMs = 0;
          state.chunks.push(chunk);
          state.totalSamples += chunk.length;
        } else if (state.speaking) {
          state.chunks.push(chunk);
          state.totalSamples += chunk.length;
          state.silenceMs += durationMs;
          if (state.silenceMs >= 600) {
            flushChunks();
          }
        } else {
          state.prebuffer.push(chunk);
          if (state.prebuffer.length > 4) {
            state.prebuffer.shift();
          }
        }
        if (state.speaking && state.totalSamples >= sr * 12) {
          flushChunks();
        }
      };

      voiceStateRef.current = state;
      if (mountedRef.current) {
        setVoiceStatus("Listening for speech…");
      }
    } catch (err) {
      console.error("Failed to initialize microphone", err);
      const message = err instanceof Error ? err.message : String(err);
      if (mountedRef.current) {
        setVoiceStatus(`Microphone error: ${message}`);
        setLiveChatEnabled(false);
      }
    }
  }, [send]);

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
        const cached = localStorage.getItem('blossom.currentUser');
        if (cached && typeof cached === 'string') {
          setPersona(cached);
          return;
        }
        const { Store } = await import("@tauri-apps/plugin-store");
        const store = await Store.load("users.json");
        const current = await store.get("currentUser");
        const name = typeof current === "string" ? current : "";
        if (name) {
          localStorage.setItem('blossom.currentUser', name);
          setPersona(name);
        }
      } catch (e) {
        console.warn("Failed to load persona", e);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("blossom.liveChatEnabled");
      if (stored === "1") {
        setLiveChatEnabled(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("blossom.liveChatEnabled", liveChatEnabled ? "1" : "0");
    } catch {}
  }, [liveChatEnabled]);

  const refreshVoiceConfig = useCallback(async () => {
    try {
      const [piperInfo, voices] = await Promise.all([
        apiListPiper().catch(() => ({})),
        listPiperVoices().catch(() => []),
      ]);
      const selected =
        (piperInfo && typeof piperInfo.selected === "string" ? piperInfo.selected : "") || "";
      const list = Array.isArray(voices) ? voices : [];
      const match = list.find((v) => v.id === selected) || list[0] || null;
      if (mountedRef.current) {
        setVoiceConfig(match);
      }
    } catch (err) {
      console.warn("Failed to load Piper voice configuration", err);
      if (mountedRef.current) {
        setVoiceConfig(null);
      }
    }
  }, []);

  useEffect(() => {
    refreshVoiceConfig();
    let unsubscribe = null;
    listen("settings::models", (event) => {
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "piper")) {
        refreshVoiceConfig();
      }
    })
      .then((un) => {
        unsubscribe = un;
      })
      .catch((err) => {
        console.warn("Failed to listen for settings updates", err);
      });
    return () => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {}
      }
    };
  }, [refreshVoiceConfig]);

  useEffect(() => {
    if (liveChatEnabled) {
      startVoice();
    } else {
      stopVoice();
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {}
        audioRef.current = null;
      }
    }
  }, [liveChatEnabled, startVoice, stopVoice]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {}
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!liveChatEnabled || !voiceConfig || !messages.length) {
      return;
    }
    const idx = messages.length - 1;
    const last = messages[idx];
    if (!last || last.role !== "assistant") {
      return;
    }
    if (lastSpokenIndexRef.current === idx) {
      return;
    }
    if (!voiceConfig.modelPath || !voiceConfig.configPath) {
      return;
    }
    lastSpokenIndexRef.current = idx;
    (async () => {
      try {
        const wavPath = await synthWithPiper(last.content, voiceConfig.modelPath, voiceConfig.configPath, {});
        const url = fileSrc(wavPath);
        if (!url) {
          return;
        }
        if (audioRef.current) {
          try {
            audioRef.current.pause();
          } catch {}
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play().catch(() => {});
      } catch (err) {
        console.warn("Failed to synthesize assistant reply", err);
      }
    })();
  }, [messages, liveChatEnabled, voiceConfig]);

  const changeModel = async (value) => {
    setModel(value);
    try {
      await invoke("set_llm", { model: value });
    } catch (e) {
      console.error("Failed to set model", e);
    }
  };

  const send = useCallback(
    async (promptOverride, options = {}) => {
      const { keepInput = false } = options;
      const raw = typeof promptOverride === "string" ? promptOverride : input;
      const prompt = raw.trim();
      if (!prompt || pendingRef.current) return;
      pendingRef.current = true;
      setMissingModel("");
      setStatus("");
      setPending(true);
      appendMessage({ role: "user", content: prompt });
      if (!promptOverride && !keepInput) {
        setInput("");
      }
      try {
        const system = persona
          ? `You are Blossom, a helpful on-device AI assistant named Blossom. The user's name is ${persona}. Refer to yourself as "Blossom" and address the user by their name when appropriate. Be concise, friendly, and proactive.`
          : `You are Blossom, a helpful on-device AI assistant named Blossom. Be concise, friendly, and proactive.`;
        const reply = await invoke("generate_llm", { prompt, system });
        const text = typeof reply === "string" ? reply : String(reply || "");
        appendMessage({ role: "assistant", content: text });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const m = /model '([^']+)' not found/i.exec(err) || /model\s+([^\s]+)\s+not\s+found/i.exec(err);
        if (m && m[1]) {
          const name = m[1];
          setMissingModel(name);
          setStatus(`Model '${name}' not found. Click Install to pull it.`);
        }
        appendMessage({ role: "assistant", content: `Error: ${err}` });
      } finally {
        pendingRef.current = false;
        setPending(false);
        scrollToBottom();
      }
    },
    [appendMessage, input, persona, scrollToBottom]
  );

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const onSubmit = (e) => {
    e.preventDefault();
    send();
  };

  return (
    <div className="m-md" style={{ display: "grid", gap: "0.75rem" }}>
      <BackButton />
      <h1>General Chat</h1>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <label>
          Model
          <select
            className="ml-sm"
            value={model}
            onChange={(e) => changeModel(e.target.value)}
          >
            {modelOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
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
                // refresh model list
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
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={liveChatEnabled}
            onChange={(e) => setLiveChatEnabled(e.target.checked)}
          />
          <span>Live Chat</span>
        </label>
        {voiceStatus ? (
          <span style={{ fontSize: "0.85rem", opacity: 0.75 }}>{voiceStatus}</span>
        ) : null}
        {liveChatEnabled && !voiceConfig ? (
          <span style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            Select a Piper voice in Settings for spoken replies.
          </span>
        ) : null}
      </div>
      {status && <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>{status}</div>}
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
