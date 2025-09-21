import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function ManageVoices() {
  const [voiceId, setVoiceId] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState([]);

  const loadProfiles = async () => {
    try {
      const list = await invoke('list_piper_profiles');
      if (Array.isArray(list)) {
        setProfiles(list);
      } else {
        setProfiles([]);
      }
    } catch (e) {
      console.error(e);
      setProfiles([]);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const addProfile = async () => {
    const id = voiceId.trim();
    const name = voiceName.trim();
    const t = tags.trim();
    if (!id || !name) {
      setError('Voice ID and Voice Name are required.');
      return;
    }
    try {
      await invoke('add_piper_voice', { name, voice: id, tags: t });
      setStatus('Saved');
      setError('');
      setVoiceId('');
      setVoiceName('');
      setTags('');
      await loadProfiles();
      setTimeout(() => setStatus(''), 1200);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e) || 'Failed to save');
    }
  };

  const removeProfile = async (name) => {
    try {
      await invoke('remove_piper_profile', { name });
      await loadProfiles();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <BackButton />
      <h1>AI Voice Labs · Manage Voices</h1>

      {/* Top: three inputs */}
      <section className="settings-section" style={{ marginBottom: '1rem' }}>
        <fieldset>
          <legend>Add Voice</legend>
          {error && <div className="warning">{error}</div>}
          <div style={{ display: 'grid', gap: '0.5rem', maxWidth: 720 }}>
            <label>
              Voice ID
              <input
                type="text"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="e.g. ElevenLabs voice_id"
                className="p-sm"
                style={{ width: '100%' }}
              />
            </label>
            <label>
              Voice Name
              <input
                type="text"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                placeholder="Display name"
                className="p-sm"
                style={{ width: '100%' }}
              />
            </label>
            <label>
              Tags (comma-separated)
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="hero, narrator, villain"
                className="p-sm"
                style={{ width: '100%' }}
              />
            </label>
            <div className="button-row" style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={addProfile}>Save</button>
              {status && <span style={{ opacity: 0.8 }}>{status}</span>}
            </div>
          </div>
        </fieldset>
      </section>

      {/* Bottom: list existing voices */}
      <section className="settings-section">
        <fieldset>
          <legend>Saved Voices</legend>
          {profiles.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No saved voices yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {profiles.map((p) => (
                <div key={p.name} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: 6 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>ID: {p.voice_id || ''}</div>
                    {Array.isArray(p.tags) && p.tags.length > 0 && (
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Tags: {p.tags.join(', ')}</div>
                    )}
                  </div>
                  <div className="button-row" style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="button" onClick={() => removeProfile(p.name)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      </section>
    </>
  );
}

