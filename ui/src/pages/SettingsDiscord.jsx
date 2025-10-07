import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Settings.css';

const SECRETS_SAMPLE = `{
  "discord": {
    "botToken": "your-discord-bot-token",
    "guildId": "optional guild id"
  }
}`;

export default function SettingsDiscord() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshSources = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const det = await invoke('discord_detect_token_sources');
      setSources(Array.isArray(det) ? det : []);
    } catch (e) {
      setSources([]);
      setError(e?.message || 'Unable to inspect token sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  return (
    <>
      <BackButton />
      <h1>Discord Settings</h1>
      <main className="dashboard" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
        {error && <div className="warning">{error}</div>}

        <section className="dnd-surface">
          <h2>Provide a Discord bot token</h2>
          <p className="muted">
            Blossom looks for a bot token in the <code>DISCORD_TOKEN</code> environment variable and in a{' '}
            <code>secrets.json</code> file. Supply either source before launching the bot.
          </p>
          <ol className="commands-list" style={{ marginTop: 'var(--space-md)' }}>
            <li className="commands-item">
              <code className="commands-syntax">DISCORD_TOKEN</code>
              <span className="commands-description">
                Export the token in your shell when running <code>discord_bot.py</code> or the desktop
                app.&nbsp;
                <code>export DISCORD_TOKEN=&quot;your-token&quot;</code>
              </span>
            </li>
            <li className="commands-item">
              <code className="commands-syntax">secrets.json</code>
              <span className="commands-description">
                Create a <code>secrets.json</code> file at the project root or in the app data directory
                (<code>%APPDATA%/com.blossom.musicgen</code>,{' '}
                <code>~/Library/Application Support/com.blossom.musicgen</code>, or{' '}
                <code>~/.local/share/com.blossom.musicgen</code>) and paste the JSON shown below.
              </span>
            </li>
          </ol>
          <pre className="npc-voice-code" style={{ marginTop: 'var(--space-md)' }}>
            <code>{SECRETS_SAMPLE}</code>
          </pre>
          <p className="muted" style={{ marginTop: 'var(--space-md)' }}>
            The optional <code>guildId</code> lets Blossom register slash commands for a single guild.
            Leave it blank if you register commands globally. Never commit real tokens to version
            control.
          </p>
        </section>

        <section className="dnd-surface">
          <div className="section-head">
            <div>
              <h2>Detected token sources</h2>
              <p className="muted">The first valid token found is used automatically.</p>
            </div>
            <button type="button" onClick={refreshSources} disabled={loading}>
              {loading ? 'Refreshing.' : 'Refresh'}
            </button>
          </div>
          {sources.length === 0 ? (
            <div className="muted">No token sources detected yet.</div>
          ) : (
            <ul className="commands-list">
              {sources.map((source) => (
                <li key={source.source + source.path} className="commands-item">
                  <code className="commands-syntax">{source.source}</code>
                  <span className="commands-description">
                    {source.length} chars ({source.path})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

