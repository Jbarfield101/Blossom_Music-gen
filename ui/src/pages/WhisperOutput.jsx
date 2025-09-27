import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';

export default function WhisperOutput() {
  const [channelId, setChannelId] = useState('');
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState('');
  const [available, setAvailable] = useState([]);
  const [logs, setLogs] = useState([]);
  const unlistenRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const info = await invoke('list_whisper');
        const sel = info?.selected || '';
        const opts = Array.isArray(info?.options) ? info.options : [];
        setAvailable(opts);
        setModel(sel || (opts[0] || ''));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    let unsubscribe = null;
    listen('whisper::segment', (event) => {
      const payload = event?.payload || {};
      const line = typeof payload?.text === 'string' ? payload : null;
      if (!line) return;
      setLogs((prev) => {
        const next = prev.slice(-199);
        next.push({
          text: payload.text,
          final: Boolean(payload.is_final),
          speaker: payload.speaker || 'unknown',
          t: payload.timestamp || 0,
        });
        return next;
      });
    }).then((un) => {
      unsubscribe = un;
      unlistenRef.current = un;
    });
    return () => {
      try { unsubscribe?.(); } catch {}
      unlistenRef.current = null;
    };
  }, []);

  const handleStart = useCallback(async () => {
    const idNum = Number(channelId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    try {
      await invoke('set_whisper', { model });
      await invoke('discord_listen_start', { channelId: idNum });
      setRunning(true);
    } catch (err) {
      setLogs((prev) => prev.concat([{ text: String(err?.message || err), final: true, speaker: 'system', t: Date.now() }]));
    }
  }, [channelId, model]);

  const handleStop = useCallback(async () => {
    try {
      await invoke('discord_listen_stop');
      setRunning(false);
    } catch (err) {
      setLogs((prev) => prev.concat([{ text: String(err?.message || err), final: true, speaker: 'system', t: Date.now() }]));
    }
  }, []);

  return (
    <>
      <BackButton />
      <h1>Whisper Output</h1>
      <section className="dnd-surface" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            <span>Voice Channel ID</span>
            <input type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="e.g. 123456789012345678" />
          </label>
          <label>
            <span>Whisper Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {available.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          {!running ? (
            <button type="button" onClick={handleStart}>Start Listening</button>
          ) : (
            <button type="button" onClick={handleStop}>Stop</button>
          )}
        </div>
        <div className="inbox-reader" style={{ maxHeight: 360, overflow: 'auto' }}>
          {logs.length === 0 ? (
            <div className="muted">No transcript yet.</div>
          ) : (
            logs.map((line, idx) => (
              <div key={idx}>
                <span className="muted">[{line.speaker}] </span>
                <span>{line.text}</span>
                {line.final ? <span className="muted"> · final</span> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

