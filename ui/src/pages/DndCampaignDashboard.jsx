import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import { loadVaultIndex, resolveVaultPath } from '../lib/vaultIndex.js';
import { openPath } from '../api/files.js';
import { openCommandPalette } from '../lib/commandPalette.js';
import './Dnd.css';


const QUICK_CREATE_ACTIONS = [
  { id: 'npc', label: 'NPC', description: 'Character dossier' },
  { id: 'quest', label: 'Quest', description: 'Story hook outline' },
  { id: 'location', label: 'Location', description: 'Region or point of interest' },
  { id: 'faction', label: 'Faction', description: 'Organization sheet' },
  { id: 'encounter', label: 'Encounter', description: 'Combat or event prep' },
  { id: 'session', label: 'Session Log', description: 'Prep or recap note' },
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

export default function DndCampaignDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentItems, setRecentItems] = useState([]);
  const [sessionItems, setSessionItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const snapshot = await loadVaultIndex({ force: true });
        if (cancelled) return;
        const root = snapshot?.root || '';
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
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load campaign index.');
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
      {error && <div className="campaign-alert">{error}</div>}
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
                  className="campaign-quick-button"
                  onClick={() => openCommandPalette({ templateId: action.id })}
                >
                  <span className="campaign-quick-label">{action.label}</span>
                  <span className="campaign-quick-meta">{action.description}</span>
                </button>
              ))}
            </div>
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
