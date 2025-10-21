import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import { loadVaultIndex, resolveVaultPath } from '../lib/vaultIndex.js';
import { openPath } from '../api/files.js';
import { getDreadhavenRoot } from '../api/config.js';
import { openCommandPalette } from '../lib/commandPalette.js';
import './Dnd.css';


const QUICK_CREATE_ACTIONS = [
  {
    id: 'npc',
    templateId: 'npc',
    label: 'NPC',
    description: 'Spin up a character dossier from the NPC template.',
  },
  {
    id: 'quest',
    templateId: 'quest',
    label: 'Quest',
    description: 'Story hook builder is coming soon.',
    status: 'WIP',
    disabled: true,
  },
  {
    id: 'domain',
    templateId: 'domain',
    label: 'Domain',
    description: 'Establish a realm or seat of power using the domain dossier.',
  },
  {
    id: 'faction',
    templateId: 'faction',
    label: 'Faction',
    description: 'Draft an organization profile with goals and assets.',
  },
  {
    id: 'encounter',
    templateId: 'encounter',
    label: 'Encounter',
    description: 'Prep a combat or event outline from the encounter kit.',
  },
  {
    id: 'session',
    templateId: 'session',
    label: 'Session Log',
    description: 'Start a prep or recap note with session scaffolding.',
  },
];

const ROUTES = {
  npc: (id) => `/dnd/npc/${encodeURIComponent(id)}`,
};

function formatRelativeTime(timestampMs) {
  if (!timestampMs) return 'Unknown';
  const delta = Date.now() - timestampMs;
  const minutes = Math.round(delta / 60000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return rtf.format(-days, 'day');
  const weeks = Math.round(days / 7);
  return rtf.format(-weeks, 'week');
}

function pickStatus(meta = {}, fields = {}) {
  const raw = meta.status ?? fields.status ?? meta.state ?? fields.state ?? '';
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function extractSummary(meta = {}, fields = {}) {
  const candidates = [
    meta.canonical_summary,
    meta.summary,
    fields.summary,
    meta.description,
    fields.description,
  ];
  const text = candidates.find((value) => typeof value === 'string' && value.trim());
  return text ? text.trim() : '';
}

const LOG_TAIL_LINES = 8;
const LOG_MAX_LENGTH = 220;

function sanitizeLogLine(line) {
  if (Array.isArray(line)) {
    return sanitizeLogLine(line.join(' '));
  }
  if (line === null || line === undefined) {
    return '';
  }
  const raw = typeof line === 'string' ? line : String(line);
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length > LOG_MAX_LENGTH ? `${trimmed.slice(0, LOG_MAX_LENGTH)}...` : trimmed;
}

export default function DndCampaignDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentItems, setRecentItems] = useState([]);
  const [sessionItems, setSessionItems] = useState([]);
  const [botInfo, setBotInfo] = useState({ running: false, pid: null, exit: null });
  const [discordLogs, setDiscordLogs] = useState([]);
  const [discordError, setDiscordError] = useState('');
  const [discordBusy, setDiscordBusy] = useState(false);
  const [listenerBusy, setListenerBusy] = useState(false);
  const [listenerStatus, setListenerStatus] = useState('unknown');
  const [channelInput, setChannelInput] = useState('');
  const [activeChannel, setActiveChannel] = useState('');
  const [activeGuild, setActiveGuild] = useState('');
  const [selfDeaf, setSelfDeaf] = useState(true);
  const [refreshingDiscord, setRefreshingDiscord] = useState(false);
  const [vaultRoot, setVaultRoot] = useState('');
  const [errorHint, setErrorHint] = useState('');

  const refreshDiscord = useCallback(async () => {
    setRefreshingDiscord(true);
    try {
      const status = await invoke('discord_bot_status');
      const running = Boolean(status?.running);
      const pidRaw = status?.pid;
      const exitRaw = status?.exit_code;
      const pidNum = typeof pidRaw === 'number' ? pidRaw : Number(pidRaw);
      const exitNum = typeof exitRaw === 'number' ? exitRaw : Number(exitRaw);
      setBotInfo({
        running,
        pid: Number.isFinite(pidNum) && pidNum > 0 ? pidNum : null,
        exit: Number.isFinite(exitNum) ? exitNum : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordError((prev) => prev || message || 'Failed to fetch Discord bot status.');
    }

    try {
      const logs = await invoke('discord_bot_logs_tail', { lines: LOG_TAIL_LINES });
      const sanitized = Array.isArray(logs)
        ? logs.map(sanitizeLogLine).filter((line) => line.length > 0)
        : [];
      setDiscordLogs(sanitized.slice(-LOG_TAIL_LINES));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordLogs([]);
      setDiscordError((prev) => prev || message || 'Failed to load Discord logs.');
    }

    try {
      const listen = await invoke('discord_listen_status');
      const text =
        typeof listen === 'string'
          ? listen.trim().toLowerCase()
          : String(listen || '').trim().toLowerCase();
      setListenerStatus(text || 'unknown');
    } catch {
      setListenerStatus('unknown');
    }

    try {
      const settings = await invoke('discord_settings_get');
      if (settings) {
        if (typeof settings.selfDeaf === 'boolean') {
          setSelfDeaf(settings.selfDeaf);
        } else if (typeof settings.self_deaf === 'boolean') {
          setSelfDeaf(settings.self_deaf);
        }
      }
    } catch {
      // ignore missing settings
    }

    try {
      const bytes = await invoke('read_file_bytes', { path: 'data/discord_status.json' });
      if (Array.isArray(bytes) && bytes.length) {
        const text = new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
        try {
          const data = JSON.parse(text || '{}');
          const channel = data && data.channel_id ? String(data.channel_id) : '';
          const guild = data && data.guild_id ? String(data.guild_id) : '';
          setActiveChannel(channel);
          setActiveGuild(guild);
          if (channel) {
            setChannelInput((prev) => (prev && prev.trim() ? prev : channel));
          }
        } catch (parseErr) {
          const message = parseErr instanceof Error ? parseErr.message : 'Failed to parse Discord status.';
          setActiveChannel('');
          setActiveGuild('');
          setDiscordError((prev) => prev || message);
        }
      } else {
        setActiveChannel('');
        setActiveGuild('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      if (!message.includes('os error 2')) {
        setDiscordError((prev) => prev || message || 'Failed to inspect Discord status.');
      }
    } finally {
      setRefreshingDiscord(false);
    }
  }, []);

  useEffect(() => {
    refreshDiscord();
  }, [refreshDiscord]);

  const handleStartBot = useCallback(async () => {
    if (discordBusy) return;
    setDiscordBusy(true);
    setDiscordError('');
    try {
      await invoke('discord_bot_start');
      await refreshDiscord();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordError(message || 'Failed to start Discord bot.');
    } finally {
      setDiscordBusy(false);
    }
  }, [discordBusy, refreshDiscord]);

  const handleStopBot = useCallback(async () => {
    if (discordBusy) return;
    setDiscordBusy(true);
    setDiscordError('');
    try {
      await invoke('discord_bot_stop');
      await refreshDiscord();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordError(message || 'Failed to stop Discord bot.');
    } finally {
      setDiscordBusy(false);
    }
  }, [discordBusy, refreshDiscord]);

  const handleStartListener = useCallback(async () => {
    if (listenerBusy) return;
    const trimmed = channelInput.trim();
    const numericId = Number(trimmed);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setDiscordError('Enter a valid Discord voice channel ID before starting Whisper.');
      return;
    }
    setListenerBusy(true);
    setDiscordError('');
    try {
      await invoke('discord_listen_start', { channelId: numericId });
      setListenerStatus('running');
      setActiveChannel(String(numericId));
      setChannelInput(String(numericId));
      await refreshDiscord();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordError(message || 'Failed to start Whisper listener.');
    } finally {
      setListenerBusy(false);
    }
  }, [channelInput, listenerBusy, refreshDiscord]);

  const handleStopListener = useCallback(async () => {
    if (listenerBusy) return;
    setListenerBusy(true);
    setDiscordError('');
    try {
      await invoke('discord_listen_stop');
      setListenerStatus('stopped');
      await refreshDiscord();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setDiscordError(message || 'Failed to stop Whisper listener.');
    } finally {
      setListenerBusy(false);
    }
  }, [listenerBusy, refreshDiscord]);

  const handleUseActiveChannel = useCallback(() => {
    if (activeChannel) {
      setChannelInput(activeChannel);
      setDiscordError('');
    }
  }, [activeChannel]);

  const handleToggleSelfDeaf = useCallback(async () => {
    const next = !selfDeaf;
    setSelfDeaf(next);
    setDiscordError('');
    try {
      const updated = await invoke('discord_set_self_deaf', { value: next });
      if (updated) {
        if (typeof updated.selfDeaf === 'boolean') {
          setSelfDeaf(updated.selfDeaf);
        } else if (typeof updated.self_deaf === 'boolean') {
          setSelfDeaf(updated.self_deaf);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      setSelfDeaf(!next);
      setDiscordError(message || 'Failed to update monitoring preference.');
    }
  }, [selfDeaf]);

  const handleRefreshDiscord = useCallback(() => {
    refreshDiscord();
  }, [refreshDiscord]);

  const handleOpenDiscordConsole = useCallback(() => {
    navigate('/dnd/discord');
  }, [navigate]);

  const botStatusLabel = useMemo(() => {
    if (botInfo.running) {
      return botInfo.pid ? `Running (PID ${botInfo.pid})` : 'Running';
    }
    if (botInfo.exit !== null && botInfo.exit !== undefined) {
      return `Exited (code ${botInfo.exit})`;
    }
    return 'Stopped';
  }, [botInfo]);

  const listenerRunning = listenerStatus === 'running';

  const listenerLabel = useMemo(() => {
    if (listenerStatus === 'running') return 'Listening';
    if (listenerStatus === 'stopped') return 'Stopped';
    if (listenerStatus === 'unknown' || !listenerStatus) return 'Unknown';
    return listenerStatus.charAt(0).toUpperCase() + listenerStatus.slice(1);
  }, [listenerStatus]);

  const activeChannelLabel = useMemo(() => {
    if (activeChannel) {
      return activeGuild ? `Channel ${activeChannel} · Guild ${activeGuild}` : `Channel ${activeChannel}`;
    }
    return 'No active channel detected';
  }, [activeChannel, activeGuild]);

  const channelPlaceholder = useMemo(
    () => (activeChannel ? `Defaults to ${activeChannel}` : 'Discord voice channel ID'),
    [activeChannel],
  );

  const logsToDisplay = useMemo(
    () => (discordLogs.length > 0 ? discordLogs.slice(-LOG_TAIL_LINES) : []),
    [discordLogs],
  );

  useEffect(() => {
    (async () => {
      try {
        const root = await getDreadhavenRoot();
        if (typeof root === 'string' && root.trim()) {
          setVaultRoot(root.trim());
        }
      } catch {
        setVaultRoot('');
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setErrorHint('');
      try {
        const snapshot = await loadVaultIndex({ force: true });
        if (cancelled) return;
        const root = snapshot?.root || '';
        setVaultRoot(root);
        const entries = Object.values(snapshot?.entities || {})
          .map((entity) => {
            if (!entity || typeof entity !== 'object') return null;
            const metadata = entity.metadata || {};
            const fields = entity.fields || {};
            const relPath = typeof entity.path === 'string' ? entity.path : '';
            const absolutePath = relPath ? resolveVaultPath(root, relPath) : '';
            const modified =
              typeof entity.mtime === 'number' ? Math.round(entity.mtime * 1000) : null;
            const pinned = Boolean(entity.pinned || metadata.pinned || fields.pinned);
            const type = typeof entity.type === 'string' ? entity.type.toLowerCase() : '';
            const name =
              entity.name ||
              entity.title ||
              metadata.name ||
              metadata.title ||
              fields.name ||
              '';
            return {
              id: entity.id || '',
              type,
              name,
              path: absolutePath,
              relPath,
              pinned,
              modified,
              metadata,
              fields,
            };
          })
          .filter((entry) => entry && entry.id && entry.name);

        const sortedRecents = [...entries]
          .sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.modified ?? 0) - (a.modified ?? 0);
          })
          .slice(0, 8);

        const sessionCandidates = entries.filter((entry) => entry.type === 'session');
        const activeSessions = sessionCandidates.filter((entry) => {
          const status = pickStatus(entry.metadata, entry.fields);
          return (
            !status ||
            status === 'active' ||
            status === 'in-progress' ||
            status === 'ongoing' ||
            status === 'current'
          );
        });

        const sortedSessions = (activeSessions.length ? activeSessions : sessionCandidates)
          .sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.modified ?? 0) - (a.modified ?? 0);
          })
          .slice(0, 4);

        setRecentItems(sortedRecents);
        setSessionItems(sortedSessions);
        setError('');
       setErrorHint('');
      } catch (err) {
        const rawMessage =
          err instanceof Error ? err.message : typeof err === 'string' ? err : String(err || '');
        let displayMessage = rawMessage || 'Failed to load campaign index.';
        let hintMessage = '';
        let fallbackRoot = '';

        if (/vault index not found/i.test(rawMessage || '')) {
          try {
            const resolved = await getDreadhavenRoot();
            if (typeof resolved === 'string') {
              fallbackRoot = resolved.trim();
            }
          } catch {
            fallbackRoot = '';
          }
          if (!cancelled && fallbackRoot) {
            setVaultRoot(fallbackRoot);
          }
          const target = fallbackRoot || 'D:\\Documents\\DreadHaven';
          hintMessage =
            `Blossom expects campaign notes under ${target} but no .blossom_index.json was found.\n` +
            'Run `python notes/watchdog.py --bootstrap` to generate the index (or restart the watcher after running the bot once).';
        }

        if (!cancelled) {
          setError(displayMessage);
          setErrorHint(hintMessage);
          setRecentItems([]);
          setSessionItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenEntity = useCallback(
    async (entry) => {
      if (!entry) return;
      const routeBuilder = ROUTES[entry.type];
      if (routeBuilder && entry.id) {
        navigate(routeBuilder(entry.id));
        return;
      }
      if (entry.path) {
        try {
          await openPath(entry.path);
        } catch (err) {
          console.warn('Failed to open entity path', err);
        }
      }
    },
    [navigate],
  );

  const sessionDisplay = useMemo(
    () =>
      sessionItems.map((entry) => ({
        ...entry,
        status: pickStatus(entry.metadata, entry.fields),
        summary: extractSummary(entry.metadata, entry.fields),
      })),
    [sessionItems],
  );

  const recentDisplay = useMemo(
    () =>
      recentItems.map((entry) => ({
        ...entry,
        summary: extractSummary(entry.metadata, entry.fields),
      })),
    [recentItems],
  );

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &mdash; Campaign Dashboard</h1>
      {error && (
        <div className="campaign-alert">
          <p>{error}</p>
          {errorHint &&
            errorHint.split('\n').map((line, idx) => (
              <p key={`error-hint-${idx}`} className="muted">
                {line}
              </p>
            ))}
          {vaultRoot && !errorHint.includes(vaultRoot) && (
            <p className="muted">
              Current vault root: <code>{vaultRoot}</code>
            </p>
          )}
        </div>
      )}
      <section className="campaign-dashboard">
        <div className="campaign-grid">
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Quick Create</h2>
                <p>Launch the palette with a template pre-selected.</p>
              </div>
            </header>
            <div className="campaign-quick-grid">
              {QUICK_CREATE_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`campaign-quick-button${action.disabled ? ' is-disabled' : ''}`}
                  onClick={() =>
                    !action.disabled &&
                    openCommandPalette({ templateId: action.templateId ?? action.id })
                  }
                  disabled={action.disabled}
                  aria-disabled={action.disabled}
                >
                  <span className="campaign-quick-title">
                    <span className="campaign-quick-label">{action.label}</span>
                    {action.status && (
                      <span className="campaign-quick-status">{action.status}</span>
                    )}
                  </span>
                  <span className="campaign-quick-meta">{action.description}</span>
                </button>
              ))}
            </div>
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Discord Bot</h2>
                <p>Control voice automation without leaving the dashboard.</p>
              </div>
              <button type="button" onClick={handleRefreshDiscord} disabled={refreshingDiscord}>
                {refreshingDiscord ? 'Refreshing...' : 'Refresh'}
              </button>
            </header>
            {discordError && <div className="warning">{discordError}</div>}
            <div className="campaign-bot-status">
              <div className="campaign-bot-status__item">
                <span className="campaign-bot-status__label">Bot</span>
                <span className="campaign-bot-status__value">{botStatusLabel}</span>
              </div>
              <div className="campaign-bot-status__item">
                <span className="campaign-bot-status__label">Listener</span>
                <span className="campaign-bot-status__value">{listenerLabel}</span>
              </div>
              <div className="campaign-bot-status__item">
                <span className="campaign-bot-status__label">Self-deafen</span>
                <span className="campaign-bot-status__value">{selfDeaf ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="campaign-bot-status__item">
                <span className="campaign-bot-status__label">Channel</span>
                <span className="campaign-bot-status__value">{activeChannelLabel}</span>
              </div>
            </div>
            <div className="campaign-button-row">
              <button
                type="button"
                onClick={botInfo.running ? handleStopBot : handleStartBot}
                disabled={discordBusy}
              >
                {botInfo.running ? (discordBusy ? 'Stopping...' : 'Stop Bot') : discordBusy ? 'Starting...' : 'Start Bot'}
              </button>
              <button type="button" onClick={handleOpenDiscordConsole}>
                Discord Console
              </button>
            </div>
            <div className="campaign-card-section">
              <label htmlFor="campaign-discord-channel">Voice channel ID</label>
              <input
                id="campaign-discord-channel"
                type="text"
                value={channelInput}
                onChange={(event) => setChannelInput(event.target.value)}
                placeholder={channelPlaceholder}
                autoComplete="off"
              />
              <div className="campaign-button-row">
                <button
                  type="button"
                  onClick={handleStartListener}
                  disabled={listenerBusy || listenerRunning}
                >
                  {listenerBusy && !listenerRunning ? 'Starting...' : 'Start Listening'}
                </button>
                <button
                  type="button"
                  onClick={handleStopListener}
                  disabled={listenerBusy || !listenerRunning}
                >
                  {listenerBusy && listenerRunning ? 'Stopping...' : 'Stop Listening'}
                </button>
                <button type="button" onClick={handleUseActiveChannel} disabled={!activeChannel}>
                  Use Active
                </button>
              </div>
              <div className="campaign-hint">{activeChannelLabel}</div>
            </div>
            <label className="campaign-toggle" htmlFor="campaign-discord-monitor">
              <input
                id="campaign-discord-monitor"
                type="checkbox"
                checked={!selfDeaf}
                onChange={handleToggleSelfDeaf}
                disabled={discordBusy || refreshingDiscord}
              />
              <span>Monitor channel audio (disable self-deafen)</span>
            </label>
            {logsToDisplay.length > 0 && (
              <div className="campaign-log">
                {logsToDisplay.map((line, index) => (
                  <div key={`discord-log-${index}`} className="campaign-log__line">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Pinned &amp; Recent</h2>
                <p>Your latest edits across the vault.</p>
              </div>
            </header>
            {loading && recentDisplay.length === 0 ? (
              <div className="campaign-empty">Loading index&hellip;</div>
            ) : recentDisplay.length === 0 ? (
              <div className="campaign-empty">No recent entities yet. Create one to get started.</div>
            ) : (
              <ul className="campaign-list">
                {recentDisplay.map((entry) => (
                  <li key={`${entry.type}-${entry.id}`}>
                    <button
                      type="button"
                      className="campaign-item"
                      onClick={() => handleOpenEntity(entry)}
                    >
                      <div className="campaign-item__meta">
                        <span className={`campaign-pill campaign-pill--${entry.type || 'entity'}`}>
                          {entry.type || 'entity'}
                        </span>
                        {entry.pinned && <span className="campaign-pin" aria-hidden="true">📌</span>}
                        <span className="campaign-time">
                          {entry.modified ? formatRelativeTime(entry.modified) : 'Unknown'}
                        </span>
                      </div>
                      <div className="campaign-item__title">{entry.name}</div>
                      {entry.summary && (
                        <div className="campaign-item__summary">{entry.summary}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Active Sessions</h2>
                <p>Keep prep, agendas, and recaps at your fingertips.</p>
              </div>
            </header>
            {loading && sessionDisplay.length === 0 ? (
              <div className="campaign-empty">Scanning for session notes&hellip;</div>
            ) : sessionDisplay.length === 0 ? (
              <div className="campaign-empty">No session notes found.</div>
            ) : (
              <ul className="campaign-list">
                {sessionDisplay.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="campaign-item"
                      onClick={() => handleOpenEntity(entry)}
                    >
                      <div className="campaign-item__meta">
                        <span className="campaign-pill campaign-pill--session">session</span>
                        {entry.status && (
                          <span className="campaign-status">{entry.status}</span>
                        )}
                        <span className="campaign-time">
                          {entry.modified ? formatRelativeTime(entry.modified) : 'Unknown'}
                        </span>
                      </div>
                      <div className="campaign-item__title">{entry.name}</div>
                      {entry.summary && (
                        <div className="campaign-item__summary">{entry.summary}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Next Session &amp; Recap</h2>
                <p>Plan the upcoming session and capture the recap.</p>
              </div>
            </header>
            <div className="campaign-empty">Campaign has not started yet</div>
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Upcoming Tasks</h2>
                <p>Track preparation tasks before the campaign begins.</p>
              </div>
            </header>
            <div className="campaign-empty">Campaign has not started yet</div>
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Party Status</h2>
                <p>Monitor player characters once adventures commence.</p>
              </div>
            </header>
            <div className="campaign-empty">Campaign has not started yet</div>
          </article>
          <article className="campaign-card">
            <header className="campaign-card__header">
              <div>
                <h2>Active Quests</h2>
                <p>Review the party&apos;s objectives and story arcs.</p>
              </div>
            </header>
            <div className="campaign-empty">Campaign has not started yet</div>
          </article>
        </div>
      </section>

    </>
  );
}
