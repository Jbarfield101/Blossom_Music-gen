import { useCallback, useEffect, useState } from 'react';
import { addPiperVoice, listPiperProfiles, removePiperProfile, updatePiperProfile } from '../api/piper';
import { listPiperVoices } from '../lib/piperVoices';
import { synthWithPiper } from '../lib/piperSynth';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import './Dnd.css';

export default function DndPiper() {
  const [voices, setVoices] = useState([]);
  const [piperVoice, setPiperVoice] = useState('');
  const [piperText, setPiperText] = useState('');
  const [piperAudio, setPiperAudio] = useState('');
  const [piperPath, setPiperPath] = useState('');
  const [piperSection, setPiperSection] = useState('');
  const [piperAvailableVoices, setPiperAvailableVoices] = useState([]);
  const [addingVoice, setAddingVoice] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [voiceTags, setVoiceTags] = useState('');
  const [piperProfiles, setPiperProfiles] = useState([]);
  const [piperBinaryAvailable] = useState(true);
  const [piperError, setPiperError] = useState('');

  const loadVoices = useCallback(async () => {
    try {
      const list = await listPiperVoices();
      if (!Array.isArray(list) || list.length === 0) {
        const fallback = {
          id: 'en-us-amy-medium',
          label: 'Amy (Medium) [en_US]',
          modelPath: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx',
          configPath:
            'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx.json',
        };
        setVoices([fallback]);
        setPiperVoice(fallback.id);
        setPiperError('');
      } else {
        setVoices(list);
        setPiperVoice((prev) => {
          const ids = list.map((v) => v.id);
          if (prev && ids.includes(prev)) {
            return prev;
          }
          return list[0]?.id || '';
        });
        setPiperError('');
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const list = await listPiperProfiles();
      setPiperProfiles(
        (list || []).map((profile) => ({
          ...profile,
          tags: (profile.tags || []).join(', '),
          original: profile.name,
        })),
      );
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  useEffect(() => {
    if (piperSection === 'Manage Voices') {
      fetchProfiles();
    }
  }, [fetchProfiles, piperSection]);

  const handleProfileChange = (idx, field, value) => {
    const updated = [...piperProfiles];
    updated[idx][field] = value;
    setPiperProfiles(updated);
  };

  const saveProfile = async (idx) => {
    const profile = piperProfiles[idx];
    try {
      await updatePiperProfile(profile.original, profile.name, profile.tags);
      await fetchProfiles();
      await loadVoices();
    } catch (err) {
      console.error(err);
    }
  };

  const removeProfile = async (name) => {
    try {
      await removePiperProfile(name);
      await fetchProfiles();
      await loadVoices();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Piper</h1>
      {piperError && <div className="warning">{piperError}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className={`piper-section-btn${piperSection === 'Find Voices' ? ' active' : ''}`}
          onClick={() =>
            setPiperSection(piperSection === 'Find Voices' ? '' : 'Find Voices')
          }
        >
          <Icon name="Search" className="piper-section-icon" size={48} />
          <span>Find Voices</span>
        </button>
        <button
          type="button"
          className={`piper-section-btn${piperSection === 'Manage Voices' ? ' active' : ''}`}
          onClick={() =>
            setPiperSection(piperSection === 'Manage Voices' ? '' : 'Manage Voices')
          }
        >
          <Icon name="Settings2" className="piper-section-icon" size={48} />
          <span>Manage Voices</span>
        </button>
      </div>
      {piperSection === '' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await loadVoices();
                } catch {
                  // ignore
                }
              }}
            >
              Refresh Voices
            </button>
          </div>
          <select
            value={piperVoice}
            onChange={(e) => {
              setPiperVoice(e.target.value);
              if (piperError) setPiperError('');
            }}
          >
            <option value="">Select voice</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label || voice.id}
              </option>
            ))}
          </select>
          <textarea
            placeholder="Enter text"
            value={piperText}
            onChange={(e) => {
              setPiperText(e.target.value);
              if (piperError) setPiperError('');
            }}
          />
          <button
            type="button"
            disabled={!piperVoice || !piperText}
            onClick={async () => {
              if (!piperVoice || !piperText) {
                setPiperError('Please select a voice and enter text.');
                return;
              }
              try {
                const selected = voices.find((voice) => voice.id === piperVoice);
                let model = '';
                let config = '';
                if (selected) {
                  try {
                    model = await invoke('resolve_resource', { path: selected.modelPath });
                    config = await invoke('resolve_resource', { path: selected.configPath });
                  } catch {
                    // fall through to fallback
                  }
                }
                if (!model || !config) {
                  model = await invoke('resolve_resource', {
                    path: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx',
                  });
                  config = await invoke('resolve_resource', {
                    path: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx.json',
                  });
                }
                const path = await synthWithPiper(piperText, model, config);
                setPiperPath(path);

                let blobUrl = '';
                try {
                  const data = await readFile(path);
                  const blob = new Blob([data], { type: 'audio/wav' });
                  blobUrl = URL.createObjectURL(blob);
                } catch (firstError) {
                  try {
                    const base = await appDataDir();
                    const norm = (value) => value.replace(/\\\\/g, '/');
                    const nBase = norm(base);
                    const nPath = norm(path);
                    if (nPath.startsWith(nBase)) {
                      const rel = nPath.substring(nBase.length);
                      const data = await readFile(rel, { baseDir: BaseDirectory.AppData });
                      const blob = new Blob([data], { type: 'audio/wav' });
                      blobUrl = URL.createObjectURL(blob);
                    }
                  } catch {
                    try {
                      const bytes = await invoke('read_file_bytes', { path });
                      const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
                      blobUrl = URL.createObjectURL(blob);
                    } catch {
                      blobUrl = convertFileSrc(path);
                    }
                  }
                }
                setPiperAudio(blobUrl);
                setPiperError('');
              } catch (err) {
                console.error(err);
                setPiperError(err?.message || String(err) || 'Failed to generate audio.');
              }
            }}
          >
            Test
          </button>
          {piperAudio && (
            <div>
              <audio controls src={piperAudio} />
              <div>
                <a
                  href={piperAudio || (piperPath ? convertFileSrc(piperPath) : '')}
                  download="piper.wav"
                >
                  Download
                </a>
              </div>
            </div>
          )}
        </div>
      )}
      {piperSection === 'Find Voices' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={async () => {
              const list = await listPiperVoices();
              const ids = (Array.isArray(list) ? list : []).map((voice) => voice.id);
              setPiperAvailableVoices(ids);
              if (ids.length === 0) {
                setPiperError(
                  'No Piper voices installed. Run `piper --download <voice_id>` to fetch a model.',
                );
              } else {
                setPiperError('');
              }
            }}
            disabled={!piperBinaryAvailable}
            title={!piperBinaryAvailable ? 'Install the piper CLI to enable voice discovery' : undefined}
          >
            Find Voices
          </button>
          <ul>
            {piperAvailableVoices.map((voiceId) => (
              <li key={voiceId}>
                {voiceId}
                <button
                  type="button"
                  onClick={() => {
                    setAddingVoice(voiceId);
                    setDisplayName(voiceId);
                    setVoiceTags('');
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          {addingVoice && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <input
                placeholder="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <input
                placeholder="Tags"
                value={voiceTags}
                onChange={(e) => setVoiceTags(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await addPiperVoice(addingVoice, displayName, voiceTags);
                      setAddingVoice('');
                      setDisplayName('');
                      setVoiceTags('');
                      await loadVoices();
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  Save
                </button>
                <button type="button" onClick={() => setAddingVoice('')}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {piperSection === 'Manage Voices' && (
        <div>
          {piperProfiles.length === 0 ? (
            <p>No voices added.</p>
          ) : (
            <ul>
              {piperProfiles.map((profile, idx) => (
                <li
                  key={profile.original}
                  style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}
                >
                  <input
                    value={profile.name}
                    onChange={(e) => handleProfileChange(idx, 'name', e.target.value)}
                  />
                  <input
                    value={profile.tags}
                    onChange={(e) => handleProfileChange(idx, 'tags', e.target.value)}
                  />
                  <button type="button" onClick={() => saveProfile(idx)}>
                    Save
                  </button>
                  <button type="button" onClick={() => removeProfile(profile.original)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
