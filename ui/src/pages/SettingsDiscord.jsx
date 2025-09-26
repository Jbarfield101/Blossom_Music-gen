import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Settings.css';

export default function SettingsDiscord() {
  const [settings, setSettings] = useState({ tokens: {}, currentToken: '', guilds: {}, currentGuild: '' });
  const [tokenName, setTokenName] = useState('');
  const [tokenValue, setTokenValue] = useState('');
  const [guildName, setGuildName] = useState('');
  const [guildId, setGuildId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState([]);

  const tokens = useMemo(() => settings.tokens || {}, [settings]);
  const guilds = useMemo(() => settings.guilds || {}, [settings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await invoke('discord_settings_get');
      const norm = {
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      };
      setSettings(norm);
      const det = await invoke('discord_detect_token_sources');
      setInfo(Array.isArray(det) ? det : []);
    } catch (e) {
      setError(e?.message || 'Failed to load Discord settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addToken = async (e) => {
    e.preventDefault();
    const name = tokenName.trim();
    const value = tokenValue.trim();
    if (!name || !value) return;
    try {
      const s = await invoke('discord_token_add', { name, token: value });
      setTokenName('');
      setTokenValue('');
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) {
      setError(e?.message || 'Failed to add token');
    }
  };

  const removeToken = async (name) => {
    try {
      const s = await invoke('discord_token_remove', { name });
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) { setError(e?.message || 'Failed to remove token'); }
  };

  const selectToken = async (name) => {
    try {
      const s = await invoke('discord_token_select', { name });
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) { setError(e?.message || 'Failed to select token'); }
  };

  const addGuild = async (e) => {
    e.preventDefault();
    const name = guildName.trim();
    const id = guildId.trim();
    const asNum = Number(id);
    if (!name || !asNum || !Number.isFinite(asNum)) return;
    try {
      const s = await invoke('discord_guild_add', { name, id: asNum });
      setGuildName('');
      setGuildId('');
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) {
      setError(e?.message || 'Failed to add guild');
    }
  };

  const removeGuild = async (name) => {
    try {
      const s = await invoke('discord_guild_remove', { name });
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) { setError(e?.message || 'Failed to remove guild'); }
  };

  const selectGuild = async (name) => {
    try {
      const s = await invoke('discord_guild_select', { name });
      setSettings({
        tokens: s?.tokens || {},
        currentToken: s?.currentToken || '',
        guilds: s?.guilds || {},
        currentGuild: s?.currentGuild || '',
      });
    } catch (e) { setError(e?.message || 'Failed to select guild'); }
  };

  const masked = (s) => (typeof s === 'string' ? `${s.length} chars` : '');

  return (
    <>
      <BackButton />
      <h1>Discord Settings</h1>
      <main className="dashboard" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
        {error && <div className="warning">{error}</div>}
        <section className="dnd-surface">
          <div className="section-head">
            <div>
              <h2>Tokens</h2>
              <p className="muted">Manage multiple bot tokens and choose the active one.</p>
            </div>
            <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing.' : 'Refresh'}</button>
          </div>
          <form onSubmit={addToken} className="npc-voice-grid" style={{ gridTemplateColumns: 'minmax(180px,1fr) minmax(240px,1.5fr) minmax(120px,auto)' }}>
            <input placeholder="Token name" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
            <input placeholder="Token value" value={tokenValue} onChange={(e) => setTokenValue(e.target.value)} />
            <button type="submit">Add Token</button>
          </form>
          <div className="npc-voice-table" style={{ marginTop: '0.5rem' }}>
            {Object.keys(tokens).length === 0 ? (
              <div className="muted">No tokens saved.</div>
            ) : (
              Object.entries(tokens).map(([name, tok]) => (
                <div key={name} className="npc-voice-grid">
                  <div className="npc-voice-name">{name}</div>
                  <div className="npc-voice-cell">{masked(tok)}</div>
                  <div className="npc-voice-cell" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button type="button" onClick={() => selectToken(name)} disabled={settings.currentToken === name}>
                      {settings.currentToken === name ? 'Selected' : 'Select'}
                    </button>
                    <button type="button" onClick={() => removeToken(name)}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="dnd-surface">
          <div className="section-head">
            <div>
              <h2>Guilds</h2>
              <p className="muted">Add guilds (servers) by ID and select one for fast slash command sync.</p>
            </div>
            <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing.' : 'Refresh'}</button>
          </div>
          <form onSubmit={addGuild} className="npc-voice-grid" style={{ gridTemplateColumns: 'minmax(180px,1fr) minmax(240px,1.5fr) minmax(120px,auto)' }}>
            <input placeholder="Guild name" value={guildName} onChange={(e) => setGuildName(e.target.value)} />
            <input placeholder="Guild ID" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
            <button type="submit">Add Guild</button>
          </form>
          <div className="npc-voice-table" style={{ marginTop: '0.5rem' }}>
            {Object.keys(guilds).length === 0 ? (
              <div className="muted">No guilds saved.</div>
            ) : (
              Object.entries(guilds).map(([name, id]) => (
                <div key={name} className="npc-voice-grid">
                  <div className="npc-voice-name">{name}</div>
                  <div className="npc-voice-cell">{String(id)}</div>
                  <div className="npc-voice-cell" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button type="button" onClick={() => selectGuild(name)} disabled={settings.currentGuild === name}>
                      {settings.currentGuild === name ? 'Selected' : 'Select'}
                    </button>
                    <button type="button" onClick={() => removeGuild(name)}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="dnd-surface">
          <h2>Detected Token Sources</h2>
          {info.length === 0 ? (
            <div className="muted">No token sources detected yet.</div>
          ) : (
            <ul className="commands-list">
              {info.map((i) => (
                <li key={i.source + i.path} className="commands-item">
                  <code className="commands-syntax">{i.source}</code>
                  <span className="commands-description">{i.length} chars ({i.path})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

