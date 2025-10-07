import { useEffect, useState } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import { listPiperVoices, resolveVoiceResources } from '../lib/piperVoices';
import { synthWithPiper } from '../lib/piperSynth';
import { invoke } from '@tauri-apps/api/core';
import { fileSrc } from '../lib/paths.js';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { setPiper as apiSetPiper } from '../api/models';
import BackButton from '../components/BackButton.jsx';
import './Settings.css';

export default function SettingsUsers() {
  const [currentUser, setCurrentUser] = useState('');
  const [voices, setVoices] = useState([]); // PiperVoice[]
  const [userPrefs, setUserPrefs] = useState({ voice: '', audioGreeting: false, greetingText: '' });
  const [saving, setSaving] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [wavPath, setWavPath] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [store, vlist] = await Promise.all([
          Store.load('users.json'),
          listPiperVoices(),
        ]);
        if (Array.isArray(vlist)) {
          setVoices(vlist.map((v) => ({ ...v, label: v.label || v.id })));
        }
        const cur = await store.get('currentUser');
        if (typeof cur === 'string') {
          setCurrentUser(cur);
          const prefs = await store.get('prefs');
          const p = (prefs && typeof prefs === 'object' && prefs[cur]) || {};
          setUserPrefs({
            voice: typeof p.voice === 'string' ? p.voice : '',
            audioGreeting: p.audioGreeting !== false, // default to enabled unless explicitly false
            greetingText: typeof p.greetingText === 'string' ? p.greetingText : '',
          });
        }
      } catch (e) {
        console.warn('Failed to load current user', e);
      }
    })();
  }, []);

  const switchUser = async () => {
    try {
      const store = await Store.load('users.json');
      await store.delete('currentUser');
      await store.save();
      setCurrentUser('');
      localStorage.removeItem('blossom.currentUser');
      location.reload();
    } catch (e) {
      console.error('Failed to clear current user', e);
    }
  };

  const persistPrefs = async (next) => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const store = await Store.load('users.json');
      const prefs = (await store.get('prefs')) || {};
      prefs[currentUser] = { ...(prefs[currentUser] || {}), ...next };
      await store.set('prefs', prefs);
      await store.save();
    } catch (e) {
      console.error('Failed to save user prefs', e);
    } finally {
      setSaving(false);
    }
  };

  const applyVoiceIfCurrent = async (voiceId) => {
    if (!currentUser) return;
    try {
      await apiSetPiper(voiceId || '');
    } catch (e) {
      console.warn('Failed to apply voice', e);
    }
  };

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Users</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Users</legend>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>Current user: <strong>{currentUser || 'None'}</strong></div>
            <button type="button" onClick={switchUser}>Switch User</button>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Switching user clears the current selection and lets you pick a new one on next launch.
          </p>
        </fieldset>
      </section>

      {currentUser && (
        <section className="settings-section">
          <fieldset>
            <legend>Per-User Preferences</legend>
            <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '520px' }}>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <div>Default Blossom Voice for <strong>{currentUser}</strong></div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <select
                    value={userPrefs.voice}
                    onChange={async (e) => {
                      const voice = e.target.value;
                      const next = { ...userPrefs, voice };
                      setUserPrefs(next);
                      await persistPrefs({ voice });
                      await applyVoiceIfCurrent(voice);
                    }}
                  >
                    <option value="">(system default)</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.label || v.id}</option>
                    ))}
                  </select>
                  <button type="button" onClick={async () => {
                    try {
                      setError('');
                      setAudioUrl('');
                      setWavPath('');
                      const selected = voices.find((v) => v.id === userPrefs.voice) || voices[0];
                      if (!selected) {
                        setError('No voice available to test.');
                        return;
                      }
                      const { modelPath: model, configPath: config } = await resolveVoiceResources(selected);
                      if (!model || !config) {
                        setError('Voice files not found. Please ensure voice models are installed.');
                        return;
                      }
                      const path = await synthWithPiper(`Testing voice selection for ${currentUser}.`, model, config);
                      setWavPath(path);
                      let url = '';
                      try {
                        const data = await readFile(path);
                        const blob = new Blob([data], { type: 'audio/wav' });
                        url = URL.createObjectURL(blob);
                      } catch {
                        try {
                          const base = await appDataDir();
                          const norm = (v) => v.replace(/\\\\/g, '/');
                          const nBase = norm(base);
                          const nPath = norm(path);
                          if (nPath.startsWith(nBase)) {
                            const rel = nPath.substring(nBase.length);
                            const data = await readFile(rel, { baseDir: BaseDirectory.AppData });
                            const blob = new Blob([data], { type: 'audio/wav' });
                            url = URL.createObjectURL(blob);
                          }
                        } catch {
                          try {
                            const bytes = await invoke('read_file_bytes', { path });
                            const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
                            url = URL.createObjectURL(blob);
                          } catch {
                            url = convertFileSrc(path);
                          }
                        }
                      }
                      setAudioUrl(url);
                    } catch (err) {
                      console.error(err);
                      setError(err?.message || String(err) || 'Failed to generate audio.');
                    }
                  }}>Test</button>
                </div>
                <small className="muted">Overrides the global voice when this user is active.</small>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={Boolean(userPrefs.audioGreeting)}
                  onChange={async (e) => {
                    const audioGreeting = e.target.checked;
                    const next = { ...userPrefs, audioGreeting };
                    setUserPrefs(next);
                    await persistPrefs({ audioGreeting });
                  }}
                />
                Enable Audio Greeting on login
              </label>

              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <div>Greeting Message</div>
                <input
                  type="text"
                  placeholder={`Wellcome ${currentUser}, What shall we work on today?`}
                  value={userPrefs.greetingText}
                  onChange={async (e) => {
                    const greetingText = e.target.value;
                    setUserPrefs((p) => ({ ...p, greetingText }));
                    await persistPrefs({ greetingText });
                  }}
                />
                <small className="muted">Use {`{name}`} to insert the username. Example: {`Good afternoon, {name}.`}</small>
              </label>
            </div>
            {saving && <div className="muted" style={{ marginTop: '0.5rem' }}>Saving…</div>}
            {error && <div className="warning" style={{ marginTop: '0.5rem' }}>{error}</div>}
            {audioUrl && (
              <div style={{ marginTop: '0.5rem' }}>
                <audio controls src={audioUrl} />
                <div>
                  <a href={audioUrl || (wavPath ? fileSrc(wavPath) : '')} download="piper.wav">
                    Download
                  </a>
                </div>
              </div>
            )}
          </fieldset>
        </section>
      )}
    </main>
  );
}
