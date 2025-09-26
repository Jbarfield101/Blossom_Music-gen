import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import BackButton from '../components/BackButton.jsx';
import { listNpcs, saveNpc } from '../api/npcs.js';
import { listPiperVoices } from '../lib/piperVoices';
import './Dnd.css';

const PROVIDERS = [
  { value: 'piper', label: 'Piper (local)' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const EMPTY_STATUS = Object.freeze({});

const decodeVoiceValue = (value) => {
  if (typeof value !== 'string') {
    return { provider: 'piper', voice: '' };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { provider: 'piper', voice: '' };
  }
  const prefixMatch = trimmed.match(/^(elevenlabs|piper):(.+)$/i);
  if (prefixMatch) {
    return {
      provider: prefixMatch[1].toLowerCase(),
      voice: prefixMatch[2].trim(),
    };
  }
  return { provider: 'piper', voice: trimmed };
};

const parseCommandSummaries = (source) => {
  const pattern = /COMMAND_SUMMARIES\s*=\s*\[(.*?)\]/s;
  const match = pattern.exec(source);
  if (!match) {
    return [];
  }
  const body = match[1];
  const tuple = /\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*\)/gs;
  const entries = [];
  let m;
  while ((m = tuple.exec(body))) {
    entries.push({ syntax: m[2], description: m[4] });
  }
  return entries;
};

export default function DndDiscord() {
  const [npcs, setNpcs] = useState([]);
  const [npcSelections, setNpcSelections] = useState({});
  const [npcSaving, setNpcSaving] = useState({});
  const [npcStatus, setNpcStatus] = useState({});
  const statusTimeouts = useRef({});

  const [voiceOptions, setVoiceOptions] = useState({ piper: [], elevenlabs: [] });
  const [voiceLoading, setVoiceLoading] = useState({ piper: false, elevenlabs: false });
  const [voiceErrors, setVoiceErrors] = useState({ piper: '', elevenlabs: '' });

  const [npcError, setNpcError] = useState('');
  const [loadingNpcs, setLoadingNpcs] = useState(true);

  const [commands, setCommands] = useState([]);
  const [commandsLoading, setCommandsLoading] = useState(true);
  const [commandsError, setCommandsError] = useState('');

  // Bot controls
  const [botPid, setBotPid] = useState(0);
  const [botStatus, setBotStatus] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [logs, setLogs] = useState([]);
  const [tokenSources, setTokenSources] = useState([]);

  const computeSelections = useCallback((items, piperOpts, elevenOpts) => {
    const piperSet = new Set(piperOpts.map((opt) => opt.value));
    const elevenSet = new Set(elevenOpts.map((opt) => opt.value));
    const map = {};
    for (const npc of items) {
      const decoded = decodeVoiceValue(npc.voice || '');
      let provider = decoded.provider;
      let voice = decoded.voice;
      if (!decoded.voice) {
        provider = 'piper';
      } else if (!piperSet.has(decoded.voice) && elevenSet.has(decoded.voice)) {
        provider = 'elevenlabs';
      } else if (!piperSet.has(decoded.voice) && provider === 'piper' && elevenSet.has(decoded.voice)) {
        provider = 'elevenlabs';
      }
      map[npc.name] = { provider, voice };
    }
    return map;
  }, []);

  const loadPiperVoices = useCallback(async () => {
    setVoiceLoading((prev) => ({ ...prev, piper: true }));
    try {
      const list = await listPiperVoices();
      const options = Array.isArray(list)
        ? list.map((voice) => ({ value: voice.id, label: voice.label || voice.id }))
        : [];
      setVoiceOptions((prev) => ({ ...prev, piper: options }));
      setVoiceErrors((prev) => ({ ...prev, piper: '' }));
      return options;
    } catch (err) {
      console.error('Failed to load Piper voices', err);
      const message = err?.message || 'Failed to load Piper voices';
      setVoiceOptions((prev) => ({ ...prev, piper: [] }));
      setVoiceErrors((prev) => ({ ...prev, piper: message }));
      return [];
    } finally {
      setVoiceLoading((prev) => ({ ...prev, piper: false }));
    }
  }, []);

  const loadElevenVoices = useCallback(async () => {
    setVoiceLoading((prev) => ({ ...prev, elevenlabs: true }));
    try {
      const list = await invoke('list_piper_profiles');
      const items = Array.isArray(list) ? list : [];
      const options = items.map((item) => ({
        value: typeof item.name === 'string' ? item.name : '',
        label:
          typeof item.name === 'string'
            ? item.voice_id
              ? `${item.name} (${item.voice_id})`
              : item.name
            : '',
      })).filter((opt) => opt.value);
      setVoiceOptions((prev) => ({ ...prev, elevenlabs: options }));
      setVoiceErrors((prev) => ({ ...prev, elevenlabs: '' }));
      return options;
    } catch (err) {
      console.error('Failed to load ElevenLabs voices', err);
      const message = err?.message || 'Failed to load ElevenLabs voices';
      setVoiceOptions((prev) => ({ ...prev, elevenlabs: [] }));
      setVoiceErrors((prev) => ({ ...prev, elevenlabs: message }));
      return [];
    } finally {
      setVoiceLoading((prev) => ({ ...prev, elevenlabs: false }));
    }
  }, []);

  const ensureVoiceOptions = useCallback(
    async (provider) => {
      if (provider === 'piper') {
        if (voiceOptions.piper.length) return voiceOptions.piper;
        return loadPiperVoices();
      }
      if (provider === 'elevenlabs') {
        if (voiceOptions.elevenlabs.length) return voiceOptions.elevenlabs;
        return loadElevenVoices();
      }
      return [];
    },
    [loadElevenVoices, loadPiperVoices, voiceOptions.elevenlabs.length, voiceOptions.piper.length],
  );

  const refreshNpcList = useCallback(async () => {
    setLoadingNpcs(true);
    setNpcError('');
    try {
      const list = await listNpcs();
      const items = Array.isArray(list) ? [...list] : [];
      items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
      setNpcs(items);
      setNpcSelections(computeSelections(items, voiceOptions.piper, voiceOptions.elevenlabs));
    } catch (err) {
      console.error('Failed to load NPCs', err);
      setNpcError(err?.message || 'Failed to load NPCs');
    } finally {
      setLoadingNpcs(false);
    }
  }, [computeSelections, voiceOptions.elevenlabs, voiceOptions.piper]);

  const persistNpcVoice = useCallback(
    async (npc, voice) => {
      const trimmed = voice.trim();
      setNpcSaving((prev) => ({ ...prev, [npc.name]: true }));
      setNpcStatus((prev) => ({ ...prev, [npc.name]: '' }));
      try {
        await saveNpc({ ...npc, voice: trimmed });
        setNpcs((prev) => prev.map((item) => (item.name === npc.name ? { ...item, voice: trimmed } : item)));
        setNpcStatus((prev) => ({ ...prev, [npc.name]: trimmed ? 'Saved' : 'Cleared' }));
        if (statusTimeouts.current[npc.name]) {
          clearTimeout(statusTimeouts.current[npc.name]);
        }
        statusTimeouts.current[npc.name] = setTimeout(() => {
          setNpcStatus((prev) => {
            const next = { ...prev };
            delete next[npc.name];
            return next;
          });
        }, 2000);
      } catch (err) {
        console.error('Failed to save NPC voice', err);
        setNpcStatus((prev) => ({ ...prev, [npc.name]: err?.message || 'Failed to save voice' }));
      } finally {
        setNpcSaving((prev) => ({ ...prev, [npc.name]: false }));
      }
    },
    [],
  );

  const handleProviderChange = useCallback(
    async (npc, provider) => {
      const current = npcSelections[npc.name];
      if (current?.provider === provider) {
        return;
      }
      const options = await ensureVoiceOptions(provider);
      setNpcSelections((prev) => {
        const existing = prev[npc.name] || { voice: '' };
        const keep = options.some((opt) => opt.value === existing.voice) ? existing.voice : '';
        return { ...prev, [npc.name]: { provider, voice: keep } };
      });
    },
    [ensureVoiceOptions, npcSelections],
  );

  const handleVoiceChange = useCallback(
    async (npc, provider, value) => {
      const trimmed = value.trim();
      setNpcSelections((prev) => ({ ...prev, [npc.name]: { provider, voice: trimmed } }));
      const existing = npcs.find((item) => item.name === npc.name);
      if (!existing || (existing.voice || '') === trimmed) {
        return;
      }
      await persistNpcVoice(existing, trimmed);
    },
    [npcs, persistNpcVoice],
  );

  const loadCommands = useCallback(async () => {
    setCommandsLoading(true);
    setCommandsError('');
    try {
      const candidatePaths = [];
      try {
        const resolved = await invoke('resolve_resource', { path: 'discord_bot.py' });
        if (typeof resolved === 'string' && resolved) {
          candidatePaths.push(resolved);
        }
      } catch (err) {
        console.warn('resolve_resource failed for discord_bot.py', err);
      }
      candidatePaths.push('discord_bot.py', '../discord_bot.py');
      let bytes = null;
      let lastError;
      for (const path of candidatePaths) {
        try {
          const result = await invoke('read_file_bytes', { path });
          if (Array.isArray(result)) {
            bytes = result;
            break;
          }
        } catch (err) {
          lastError = err;
        }
      }
      if (!bytes) {
        throw lastError || new Error('Unable to read discord_bot.py');
      }
      const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
      const entries = parseCommandSummaries(text);
      setCommands(entries);
    } catch (err) {
      console.error('Failed to load Discord command summaries', err);
      setCommands([]);
      setCommandsError(err?.message || 'Failed to load command summaries');
    } finally {
      setCommandsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [npcList, piperOpts, elevenOpts] = await Promise.all([
          listNpcs(),
          loadPiperVoices(),
          loadElevenVoices(),
        ]);
        if (cancelled) return;
        const items = Array.isArray(npcList) ? [...npcList] : [];
        items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
        setNpcs(items);
        setNpcSelections(computeSelections(items, piperOpts, elevenOpts));
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to initialise Discord NPC data', err);
          setNpcError(err?.message || 'Failed to load NPCs');
        }
      } finally {
        if (!cancelled) {
          setLoadingNpcs(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      Object.values(statusTimeouts.current).forEach((timeoutId) => clearTimeout(timeoutId));
    };
  }, [computeSelections, loadElevenVoices, loadPiperVoices]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const handleStartBot = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setBotStatus('');
    try {
      const pid = await invoke('discord_bot_start');
      const num = typeof pid === 'number' ? pid : Number(pid);
      setBotPid(Number.isFinite(num) ? num : 0);
      setBotStatus(Number.isFinite(num) ? `Running (PID ${num})` : 'Started');
    } catch (err) {
      console.error('Failed to start Discord bot', err);
      setBotStatus(err?.message || 'Failed to start bot');
    } finally {
      setStarting(false);
    }
  }, [starting]);

  const handleStopBot = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await invoke('discord_bot_stop');
      setBotPid(0);
      setBotStatus('Stopped');
    } catch (err) {
      console.error('Failed to stop Discord bot', err);
      setBotStatus(err?.message || 'Failed to stop bot');
    } finally {
      setStopping(false);
    }
  }, [stopping]);

  const handleCheckStatus = useCallback(async () => {
    try {
      const status = await invoke('discord_bot_status');
      const pid = typeof status?.pid === 'number' ? status.pid : 0;
      const running = Boolean(status?.running);
      const exit = typeof status?.exit_code === 'number' ? status.exit_code : null;
      setBotPid(running ? pid : 0);
      setBotStatus(running ? `Running (PID ${pid})` : exit === null ? 'Idle' : `Exited (code ${exit})`);
    } catch (err) {
      console.error('Failed to query bot status', err);
    }
  }, []);

  const handleFetchLogs = useCallback(async () => {
    try {
      const lines = await invoke('discord_bot_logs_tail', { lines: 120 });
      setLogs(Array.isArray(lines) ? lines : []);
    } catch (err) {
      console.error('Failed to fetch bot logs', err);
    }
  }, []);

  const handleDetectTokens = useCallback(async () => {
    try {
      const det = await invoke('discord_detect_token_sources');
      setTokenSources(Array.isArray(det) ? det : []);
    } catch (err) {
      console.error('Failed to detect tokens', err);
    }
  }, []);

  const handleResync = useCallback(async () => {
    try {
      await invoke('discord_bot_stop');
    } catch {}
    await handleStartBot();
  }, [handleStartBot]);

  const voiceHint = (provider, options, loading, error) => {
    if (loading) {
      return <span className="muted">Loading voices…</span>;
    }
    if (error) {
      return <span className="npc-voice-hint error">{error}</span>;
    }
    if (!options.length) {
      return (
        <span className="npc-voice-hint muted">
          {provider === 'elevenlabs'
            ? 'Add ElevenLabs voices from Manage Voices to assign NPC dialogue.'
            : 'No Piper voices discovered. Install voice models to use local TTS.'}
        </span>
      );
    }
    return <span className="npc-voice-hint" />;
  };

  const clearNpcStatus = useCallback(() => {
    setNpcStatus(EMPTY_STATUS);
  }, []);

  useEffect(() => {
    if (Object.keys(npcStatus).length === 0) {
      return undefined;
    }
    const id = setTimeout(clearNpcStatus, 4000);
    return () => clearTimeout(id);
  }, [clearNpcStatus, npcStatus]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Discord</h1>
      <main
        className="dashboard"
        style={{ display: 'grid', gap: 'var(--space-lg)', marginTop: 'var(--space-lg)' }}
      >
        <section className="dnd-surface" aria-labelledby="discord-bot-controls-heading">
          <div className="section-head">
            <div>
              <h2 id="discord-bot-controls-heading">Discord Bot</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                Token from <code>secrets.json</code> or selected in <code>Settings → Discord</code>. Commands: <code>/ping</code>, <code>/join</code>, <code>/leave</code>, <code>/say</code>.
              </p>
            </div>
            <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={handleStartBot} disabled={starting}>
                {starting ? 'Starting.' : 'Start Bot'}
              </button>
              <button type="button" onClick={handleStopBot} disabled={stopping}>
                {stopping ? 'Stopping.' : 'Stop Bot'}
              </button>
              <button type="button" onClick={handleCheckStatus}>Check Status</button>
              <button type="button" onClick={handleFetchLogs}>View Logs</button>
            </div>
          </div>
          <div className="muted">
            Status: {botStatus || (botPid ? `Running (PID ${botPid})` : 'Idle')}
          </div>
          <div className="muted">
            Token sources: {tokenSources.length === 0 ? 'Unknown' : tokenSources.map((t) => `${t.source} (${t.length} chars)`).join(', ')}
          </div>
          <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={handleDetectTokens}>Check Token</button>
            <button type="button" onClick={handleResync}>Re-sync Commands</button>
          </div>
          {logs.length > 0 && (
            <pre className="inbox-reader" style={{ maxHeight: 240, overflow: 'auto' }}>
              {logs.join('\n')}
            </pre>
          )}
        </section>
        <section className="dnd-surface" aria-labelledby="npc-voice-selector-heading">
          <div className="section-head">
            <div>
              <h2 id="npc-voice-selector-heading">NPC Voice Selector</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                Map lore NPCs to speaking voices for Discord narration.
              </p>
            </div>
            <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={refreshNpcList} disabled={loadingNpcs}>
                {loadingNpcs ? 'Refreshing…' : 'Reload NPCs'}
              </button>
              <button
                type="button"
                onClick={() => {
                  loadPiperVoices();
                  loadElevenVoices();
                }}
              >
                Refresh Voices
              </button>
            </div>
          </div>
          {npcError && <div className="warning">{npcError}</div>}
          {loadingNpcs ? (
            <div className="muted">Loading NPCs…</div>
          ) : npcs.length === 0 ? (
            <div className="muted">No NPCs discovered yet.</div>
          ) : (
            <div className="npc-voice-table" role="table" aria-label="NPC voice mapping">
              <div className="npc-voice-grid npc-voice-grid--header" role="row">
                <div role="columnheader">NPC</div>
                <div role="columnheader">Provider</div>
                <div role="columnheader">Voice</div>
              </div>
              {npcs.map((npc) => {
                const selection = npcSelections[npc.name] || { provider: 'piper', voice: '' };
                const provider = selection.provider || 'piper';
                const options = voiceOptions[provider] || [];
                const loading = voiceLoading[provider];
                const error = voiceErrors[provider];
                const saving = Boolean(npcSaving[npc.name]);
                const status = npcStatus[npc.name];
                return (
                  <div key={npc.name} className="npc-voice-grid" role="row">
                    <div role="cell">
                      <div className="npc-voice-name">{npc.name}</div>
                      {npc.description && (
                        <div className="npc-voice-description">{npc.description}</div>
                      )}
                    </div>
                    <div role="cell" className="npc-voice-cell">
                      <select
                        value={provider}
                        onChange={(e) => handleProviderChange(npc, e.target.value)}
                        disabled={saving}
                      >
                        {PROVIDERS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div role="cell" className="npc-voice-cell">
                      <select
                        value={selection.voice}
                        onChange={(e) => handleVoiceChange(npc, provider, e.target.value)}
                        disabled={saving || loading || options.length === 0}
                      >
                        <option value="">Select voice</option>
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label || opt.value}
                          </option>
                        ))}
                      </select>
                      <div className="npc-voice-hint-container">
                        {voiceHint(provider, options, loading, error)}
                        {status && !error && !loading && (
                          <span className="npc-voice-hint muted">{status}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="dnd-surface" aria-labelledby="commands-help-heading">
          <div className="section-head">
            <div>
              <h2 id="commands-help-heading">Commands Help</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                Slash commands mirrored from <code>discord_bot.py</code>.
              </p>
              <p className="muted" style={{ marginTop: '0.25rem' }}>
                Token is read from <code>secrets.json</code> (no token input required here).
              </p>
            </div>
            <button type="button" onClick={loadCommands} disabled={commandsLoading}>
              {commandsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {commandsError && <div className="warning">{commandsError}</div>}
          {commandsLoading ? (
            <div className="muted">Loading commands…</div>
          ) : commands.length === 0 ? (
            <div className="muted">No slash commands detected.</div>
          ) : (
            <ul className="commands-list">
              {commands.map((cmd) => (
                <li key={cmd.syntax} className="commands-item">
                  <code className="commands-syntax">{cmd.syntax}</code>
                  <span className="commands-description">{cmd.description}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
