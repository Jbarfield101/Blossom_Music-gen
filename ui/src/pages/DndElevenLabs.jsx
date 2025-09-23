import { useEffect, useState } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const ELEVEN_MODEL_OPTIONS = [
  'eleven_multilingual_v3',
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
];

export default function DndElevenLabs() {
  const [apiKey, setApiKey] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [selectedName, setSelectedName] = useState('');
  const [modelId, setModelId] = useState(ELEVEN_MODEL_OPTIONS[0]);
  const [text, setText] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load('secrets.json');
        const key = await store.get('elevenlabs.apiKey');
        if (typeof key === 'string' && key) {
          setApiKey(key.trim());
        } else {
          try {
            const abs = await invoke('resolve_resource', { path: 'secrets.json' });
            const bytes = await invoke('read_file_bytes', { path: abs });
            if (Array.isArray(bytes) && bytes.length) {
              const txt = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
              const data = JSON.parse(txt);
              const k = data?.elevenlabs?.apiKey;
              if (typeof k === 'string' && k) {
                const trimmed = k.trim();
                await store.set('elevenlabs.apiKey', trimmed);
                await store.save();
                setApiKey(trimmed);
              }
            }
          } catch {}
        }
      } catch (e) {
        console.warn('Failed to load elevenlabs key', e);
      }
      try {
        const list = await invoke('list_piper_profiles');
        const items = Array.isArray(list) ? list : [];
        setProfiles(items);
        setSelectedName((prev) => (items.find((v) => v.name === prev) ? prev : (items[0]?.name || '')));
      } catch (e) {
        console.warn('Failed to load profiles', e);
      }
    })();
  }, []);

  const refreshProfiles = async () => {
    try {
      const list = await invoke('list_piper_profiles');
      const items = Array.isArray(list) ? list : [];
      setProfiles(items);
      setSelectedName((prev) => (items.find((v) => v.name === prev) ? prev : (items[0]?.name || '')));
    } catch (e) {
      console.error(e);
      setProfiles([]);
      setSelectedName('');
    }
  };

  return (
    <>
      <BackButton />
      <h1>AI Voice Labs · ElevenLabs</h1>
      {!apiKey && (
        <div className="warning" style={{ opacity: 0.9 }}>
          No ElevenLabs API key found. Add it to secrets.json.
        </div>
      )}
      {error && <div className="warning">{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="button" onClick={refreshProfiles}>Refresh Voices</button>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            Model
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              style={{ marginLeft: '0.5rem' }}
            >
              {ELEVEN_MODEL_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        <select
          value={selectedName}
          onChange={(e) => {
            setSelectedName(e.target.value);
            if (error) setError('');
          }}
          disabled={!apiKey}
        >
          <option value="">{apiKey ? 'Select voice' : 'Add key to secrets.json to load voices'}</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <textarea
          placeholder="Enter text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError('');
          }}
        />
        <button
          type="button"
          disabled={!apiKey || !selectedName || !text}
          onClick={async () => {
            if (!apiKey) { setError('No ElevenLabs API key configured.'); return; }
            const sel = profiles.find((p) => p.name === selectedName);
            const voiceId = sel?.voice_id || '';
            if (!voiceId || !text) { setError('Please select a voice and enter text.'); return; }
            try {
              const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
                method: 'POST',
                headers: {
                  'xi-api-key': apiKey.trim(),
                  'accept': 'audio/mpeg',
                  'content-type': 'application/json',
                },
                body: JSON.stringify({ text, model_id: modelId }),
              });
              if (!res.ok) {
                let details = '';
                try { details = await res.text(); } catch {}
                const snippet = details ? `: ${details.slice(0, 200)}` : '';
                throw new Error(`Synthesis failed (${res.status})${snippet}`);
              }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              setAudioUrl(url);
              setError('');
            } catch (e) {
              console.error(e);
              setError(e?.message || 'Failed to synthesize.');
            }
          }}
        >
          Test
        </button>
        {audioUrl && (
          <div>
            <audio controls src={audioUrl} />
            <div>
              <a href={audioUrl} download={`elevenlabs.mp3`}>Download</a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

