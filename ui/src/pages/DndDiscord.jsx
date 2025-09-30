import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Store } from '@tauri-apps/plugin-store';
import { writeTextFile } from '@tauri-apps/plugin-fs';

import BackButton from '../components/BackButton.jsx';
import { listNpcs, saveNpc } from '../api/npcs.js';
import { listPiperVoices } from '../lib/piperVoices';
import { listDir } from '../api/dir';
import { readFileBytes } from '../api/files';
import { getConfig } from '../api/config';
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
  const [showBotControls, setShowBotControls] = useState(false);
  const [compact, setCompact] = useState(true);
  const [actOpen, setActOpen] = useState(false);
  const [actRequest, setActRequest] = useState(null);
  const [actNpc, setActNpc] = useState('');
  const [actProvider, setActProvider] = useState('piper');
  const [actVoice, setActVoice] = useState('');
  const [elUsage, setElUsage] = useState({ used: 0, limit: 0, percent: 0 });
  const [elKeyPresent, setElKeyPresent] = useState(false);
  const [listening, setListening] = useState(false);
  const [whisperLogs, setWhisperLogs] = useState([]);
  const lastPartRef = useRef(0);
  const utterRef = useRef('');
  const debounceRef = useRef(null);
  const speakingRef = useRef(false);
  const [portraitUrl, setPortraitUrl] = useState('');

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

  // Prepopulate act modal provider/voice when NPC changes
  useEffect(() => {
    const sel = npcSelections[actNpc];
    if (!sel) return;
    setActProvider(sel.provider || 'piper');
    setActVoice(sel.voice || '');
  }, [actNpc, npcSelections]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  // ElevenLabs usage widget
  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('secrets.json');
        const key = await store.get('elevenlabs.apiKey');
        const apiKey = typeof key === 'string' ? key.trim() : '';
        setElKeyPresent(!!apiKey);
        if (!apiKey) return;
        const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
          headers: { 'xi-api-key': apiKey, 'accept': 'application/json' },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const used = Number(data?.character_count || 0);
        const limit = Number(data?.character_limit || 0);
        const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
        setElUsage({ used, limit, percent });
      } catch {
        // ignore
      }
    })();
  }, []);

  // Whisper listener and 4s debounce to generate + speak
  useEffect(() => {
    let unlisten;
    (async () => {
      try {
        unlisten = await listen('whisper::segment', (event) => {
          const p = event?.payload || {};
          const text = typeof p?.text === 'string' ? p.text : '';
          if (!text) return;
          setWhisperLogs((prev) => prev.concat([{ text, final: !!p.is_final, t: Date.now() }]).slice(-500));
          lastPartRef.current = Date.now();
          if (p.is_final) {
            utterRef.current = (utterRef.current + ' ' + text).trim();
          }
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(async () => {
            const now = Date.now();
            if (now - lastPartRef.current >= 4000) {
              const utter = utterRef.current.trim();
              utterRef.current = '';
              if (!utter || speakingRef.current) return;
              speakingRef.current = true;
              try {
                const npc = npcs.find((n) => n.name === actNpc);
                const sys = [
                  npc?.name ? `You are ${npc.name}, a D&D NPC.` : 'You are a D&D NPC.',
                  npc?.description ? `Description: ${npc.description}` : '',
                  npc?.prompt || '',
                  'Respond in character, concise but vivid.',
                ].filter(Boolean).join('\n');
                const reply = await invoke('generate_llm', { prompt: utter, system: sys });
                const payload = { action: 'say', text: String(reply || ''), nonce: `${Date.now()}` };
                try {
                  const bytes = await invoke('read_file_bytes', { path: 'data/discord_status.json' });
                  if (Array.isArray(bytes) && bytes.length) {
                    const tx = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                    const st = JSON.parse(tx || '{}');
                    if (st && st.channel_id) payload.channel_id = st.channel_id;
                  }
                } catch {}
                await writeTextFile('data/discord_tts.json', JSON.stringify(payload, null, 2));
              } catch (e) {
                console.error('Auto-reply failed', e);
              } finally {
                speakingRef.current = false;
              }
            }
          }, 4200);
        });
      } catch (e) {
        console.warn('whisper listener error', e);
      }
    })();
    return () => {
      if (typeof unlisten === 'function') unlisten();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [actNpc, npcs]);

  // Listen for /act events from the bot
  useEffect(() => {
    let unlisten;
    (async () => {
      try {
        unlisten = await listen('discord::act', (event) => {
          const payload = event?.payload || {};
          setActRequest(payload);
          setActOpen(true);
          // Best-effort preselects
          if (npcs.length > 0) {
            setActNpc(npcs[0]?.name || '');
          }
          setActProvider('piper');
          setActVoice('');
        });
      } catch (err) {
        console.warn('Failed to listen for discord::act events', err);
      }
    })();
    return () => {
      if (typeof unlisten === 'function') unlisten();
    };
  }, [npcs]);

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

  // Auto-start listening when bot is in a voice channel (poll bot status file)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (autoStartRef.current || listening) return;
      try {
        const bytes = await invoke('read_file_bytes', { path: 'data/discord_status.json' });
        if (!Array.isArray(bytes) || !bytes.length) return;
        const tx = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
        const st = JSON.parse(tx || '{}');
        const channelId = Number(st?.channel_id || 0);
        if (Number.isFinite(channelId) && channelId > 0) {
          await invoke('discord_listen_start', { channelId });
          setListening(true);
          autoStartRef.current = true;
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [listening]);

  // Load NPC portrait for the selected actor
  useEffect(() => {
    let cancelled = false;
    const name = (actNpc || '').trim();
    if (!name) { setPortraitUrl(''); return () => {}; }
    (async () => {
      try {
        // Resolve portrait base
        const joinPortraitPath = (...parts) => {
          const segments = [];
          parts.forEach((part, index) => {
            const value = String(part ?? '').replaceAll('\\', '/');
            if (!value) return;
            const trimmed =
              index === 0
                ? value.replace(/[/]+$/, '')
                : value.replace(/^[/]+/, '').replace(/[/]+$/, '');
            if (trimmed) segments.push(trimmed);
          });
          return segments.join('/');
        };
        const toSystemPath = (path) => {
          const str = String(path || '');
          return /^[A-Za-z]:/.test(str) ? str.replaceAll('/', '\\') : str;
        };

        let base = '';
        try {
          const v = await getConfig('vaultPath');
          const vStr = typeof v === 'string' ? v : '';
          if (vStr) {
            base = joinPortraitPath(vStr, '30_Assets', 'Images', 'NPC_Portraits');
          }
        } catch {}
        if (!base) {
          base = joinPortraitPath('D:/Documents/DreadHaven', '30_Assets', 'Images', 'NPC_Portraits');
        }
        let entries = [];
        try { entries = await listDir(toSystemPath(base)); } catch { entries = []; }
        const norm = (s) => String(s||'').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g,'_');
        const target = norm(name);
        let matchPath = '';
        for (const e of entries) {
          if (e.is_dir) continue;
          const nm = norm(e.name||'');
          if (nm === target) { matchPath = e.path; break; }
        }
        if (!matchPath) { setPortraitUrl(''); return; }
        const bytes = await readFileBytes(matchPath);
        if (cancelled) return;
        const ext = (matchPath.split('.').pop()||'').toLowerCase();
        const mime = ext==='png'?'image/png': ext==='jpg'||ext==='jpeg'?'image/jpeg': ext==='gif'?'image/gif': ext==='webp'?'image/webp':'application/octet-stream';
        const blob = new Blob([new Uint8Array(bytes)], { type: mime });
        const url = URL.createObjectURL(blob);
        setPortraitUrl(url);
      } catch { setPortraitUrl(''); }
    })();
    return () => { cancelled = true; };
  }, [actNpc]);

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
      <div className="discord-status-bar muted" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
        <span>Status: {botStatus || (botPid ? `Running (PID ${botPid})` : 'Idle')}</span>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
          Compact view
        </label>
      </div>
      <main
        className="dashboard discord-dashboard"
        style={{ display: 'grid', gap: 'var(--space-lg)', marginTop: 'var(--space-lg)', gridTemplateColumns: compact ? '1fr' : '1fr 1fr' }}
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
              <button
                type="button"
                onClick={() => setShowBotControls((v) => !v)}
                aria-expanded={showBotControls}
                aria-controls="discord-bot-controls"
              >
                {showBotControls ? 'Collapse' : 'Expand'}
              </button>
              <button type="button" onClick={handleStartBot} disabled={starting}>
                {starting ? 'Starting.' : 'Start Bot'}
              </button>
              <button type="button" onClick={handleStopBot} disabled={stopping}>
                {stopping ? 'Stopping.' : 'Stop Bot'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    let channelId = 0;
                    try {
                      const bytes = await invoke('read_file_bytes', { path: 'data/discord_status.json' });
                      if (Array.isArray(bytes) && bytes.length) {
                        const tx = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                        const st = JSON.parse(tx || '{}');
                        if (st && st.channel_id) channelId = Number(st.channel_id);
                      }
                    } catch {}
                    if (!Number.isFinite(channelId) || channelId <= 0) throw new Error('No active voice channel. Use /join first.');
                    await invoke('discord_listen_start', { channelId });
                    setListening(true);
                  } catch (e) { console.error(e); setListening(false); }
                }}
                disabled={listening}
              >
                Start Listen
              </button>
              <button type="button" onClick={async () => { try { await invoke('discord_listen_stop'); } catch {}; setListening(false); }} disabled={!listening}>Stop Listen</button>
              <button type="button" onClick={handleCheckStatus}>Check Status</button>
              <button type="button" onClick={handleFetchLogs}>View Logs</button>
            </div>
          </div>
          {showBotControls && (
            <div id="discord-bot-controls" className="discord-bot-controls">
              <div className="muted">
                Token sources: {tokenSources.length === 0 ? 'Unknown' : tokenSources.map((t) => `${t.source} (${t.length} chars)`).join(', ')}
              </div>
              <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleDetectTokens}>Check Token</button>
                <button type="button" onClick={handleResync}>Re-sync Commands</button>
              </div>
              {!compact && logs.length > 0 && (
                <pre className="inbox-reader" style={{ maxHeight: 240, overflow: 'auto' }}>
                  {logs.join('\n')}
                </pre>
              )}
            </div>
          )}
        </section>
        

        {!compact && (
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
        )}
            {/* Whisper transcript bar */}
      <div style={{ position: 'fixed', left: 12, right: 12, bottom: 44, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, maxHeight: 120, overflow: 'auto' }}>
        {whisperLogs.length === 0 ? (
          <span className="muted">Waiting for speech…</span>
        ) : (
          whisperLogs.slice(-10).map((l, i) => (
            <div key={i} style={{ opacity: l.final ? 1 : 0.8 }}>{l.text}</div>
          ))
        )}
      </div>      {/* Status chip */}
      <div style={{ position: 'fixed', right: 12, top: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', fontSize: 12, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <span>NPC: {actNpc || '—'}</span>
        <span>Voice: {actProvider}/{actVoice || '—'}</span>
        <span style={{ opacity: 0.8 }}>{listening ? 'Listening' : 'Idle'}</span>
      </div></main>

      {actOpen && (
        <div className="dnd-modal-backdrop" role="dialog" aria-modal="true" aria-label="Select NPC and voice">
          <div className="dnd-modal">
            <div className="dnd-modal-header">
              <div>
                <h2>Choose NPC and Voice</h2>
                <p className="dnd-modal-subtitle">
                  Triggered by /act from Discord{actRequest?.username ? ` (${actRequest.username})` : ''}.
                </p>
              </div>
              <button type="button" onClick={() => setActOpen(false)}>Close</button>
            </div>
            <div className="dnd-modal-body" style={{ gridTemplateColumns: '1fr' }}>
              <div className="dnd-summary-card">
                <label htmlFor="act-npc">NPC</label>
                <select id="act-npc" value={actNpc} onChange={(e) => setActNpc(e.target.value)}>
                  <option value="">Select NPC</option>
                  {npcs.map((n) => (
                    <option key={n.name} value={n.name}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div className="dnd-summary-card">
                <label htmlFor="act-provider">Voice Provider</label>
                <select id="act-provider" value={actProvider} onChange={(e) => { setActProvider(e.target.value); setActVoice(''); }}>
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <label htmlFor="act-voice" style={{ marginTop: '0.5rem' }}>Voice</label>
                <select id="act-voice" value={actVoice} onChange={(e) => setActVoice(e.target.value)}>
                  <option value="">Select voice</option>
                  {(voiceOptions[actProvider] || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="dnd-modal-actions">
              <button type="button" onClick={() => setActOpen(false)}>Cancel</button>
              <button
                type="button"
                disabled={!actNpc || !actVoice}
                onClick={async () => {
                  try {
                    const payload = {
                      action: 'takeover',
                      npc: actNpc,
                      provider: actProvider,
                      profile: actVoice,
                      guild_id: actRequest?.guild_id || null,
                      channel_id: actRequest?.channel_id || null,
                      nonce: `${Date.now()}`,
                    };
                    // Fallback: if no channel_id provided by /act, use active bot channel from status file
                    if (!payload.channel_id) {
                      try {
                        const bytes = await invoke('read_file_bytes', { path: 'data/discord_status.json' });
                        if (Array.isArray(bytes) && bytes.length) {
                          const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                          const data = JSON.parse(text || '{}');
                          if (data && data.channel_id) {
                            payload.channel_id = data.channel_id;
                            payload.guild_id = payload.guild_id || data.guild_id || null;
                          }
                        }
                      } catch {}
                    }
                    await writeTextFile('data/discord_persona.json', JSON.stringify(payload, null, 2));
                  } catch (err) {
                    console.error('Failed to write takeover file', err);
                  } finally {
                    setActOpen(false);
                  }
                }}
              >
                Take Over
              </button>
            </div>
          </div>
        </div>
      )}
      {elKeyPresent && elUsage.limit > 0 && (
        <>
          {portraitUrl && (
            <img
              alt="NPC portrait"
              src={portraitUrl}
              style={{
                position: 'fixed',
                left: 12,
                bottom: 44,
                width: 128,
                height: 128,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            />
          )}
          <div
            style={{
              position: 'fixed',
              left: 12,
              bottom: 12,
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 12,
              opacity: 0.9,
            }}
          >
            ElevenLabs: {elUsage.used.toLocaleString()} / {elUsage.limit.toLocaleString()} ({elUsage.percent}%)
          </div>
        </>
      )}
    </>
  );
}








