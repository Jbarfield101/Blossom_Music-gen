import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton.jsx";

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
  const listRef = useRef(null);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  };

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

  const changeModel = async (value) => {
    setModel(value);
    try {
      await invoke("set_llm", { model: value });
    } catch (e) {
      console.error("Failed to set model", e);
    }
  };

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || pending) return;
    setMissingModel("");
    setStatus("");
    setPending(true);
    setMessages((prev) => prev.concat([{ role: "user", content: prompt }]));
    setInput("");
    try {
      const system = persona
        ? `You are Blossom, a helpful on-device AI assistant named Blossom. The user's name is ${persona}. Refer to yourself as "Blossom" and address the user by their name when appropriate. Be concise, friendly, and proactive.`
        : `You are Blossom, a helpful on-device AI assistant named Blossom. Be concise, friendly, and proactive.`;
      const reply = await invoke("generate_llm", { prompt, system });
      const text = typeof reply === "string" ? reply : String(reply || "");
      setMessages((prev) => prev.concat([{ role: "assistant", content: text }]))
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const m = /model '([^']+)' not found/i.exec(err) || /model\s+([^\s]+)\s+not\s+found/i.exec(err);
      if (m && m[1]) {
        const name = m[1];
        setMissingModel(name);
        setStatus(`Model '${name}' not found. Click Install to pull it.`);
      }
      setMessages((prev) => prev.concat([{ role: "assistant", content: `Error: ${err}` }]))
    } finally {
      setPending(false);
      scrollToBottom();
    }
  }, [input, pending]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

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
            <div key={i} style={{ marginBottom: "0.5rem" }}>
              <div style={{ fontWeight: 600, opacity: 0.8 }}>
                {m.role === "user" ? "You" : "Blossom"}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
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
