import { useCallback, useEffect, useState } from 'react';
import { Store } from '@tauri-apps/plugin-store';
import { listPiperVoices } from '../lib/piperVoices';
import { synthWithPiper } from '../lib/piperSynth';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndPiper() {
  const [aiModel, setAiModel] = useState('piper');
  const [voices, setVoices] = useState([]);
  const [piperVoice, setPiperVoice] = useState('');
  const [elVoices, setElVoices] = useState([]);
  const [elevenVoice, setElevenVoice] = useState('');
  const [elevenApiKey, setElevenApiKey] = useState('');
  const [elStatus, setElStatus] = useState('');
  const [piperText, setPiperText] = useState('');
  const [piperAudio, setPiperAudio] = useState('');
  const [piperPath, setPiperPath] = useState('');
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

  useEffect(() => {
    // Restore saved model selection, default to 'piper'
    try {
      const saved = localStorage.getItem('blossom.aiVoiceModel');
      if (saved && typeof saved === 'string') {
        setAiModel(saved);
      } else {
        setAiModel('piper');
      }
    } catch {
      setAiModel('piper');
    }
    (async () => {
      try {
        const store = await Store.load('secrets.json');
        const key = await store.get('elevenlabs.apiKey');
        if (typeof key === 'string' && key) {
          const trimmed = key.trim();
          setElevenApiKey(trimmed);
          return;
        }
        // One-time migration from localStorage if present
        try {
          const legacy = localStorage.getItem('blossom.elevenlabs.apiKey');
          if (legacy && typeof legacy === 'string') {
            await store.set('elevenlabs.apiKey', legacy);
            await store.save();
            setElevenApiKey(legacy.trim());
            localStorage.removeItem('blossom.elevenlabs.apiKey');
            return;
          }
        } catch {}

        // If a project-root secrets.json exists, import its values
        try {
          const bytes = await invoke('read_file_bytes', { path: 'secrets.json' });
          if (Array.isArray(bytes) && bytes.length) {
            const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
            const data = JSON.parse(text);
            const apiKey = data?.elevenlabs?.apiKey;
            if (typeof apiKey === 'string' && apiKey) {
              const trimmed = apiKey.trim();
              await store.set('elevenlabs.apiKey', trimmed);
              await store.save();
              setElevenApiKey(trimmed);
            }
          }
        } catch {
          // ignore missing file or parse errors
        }
      } catch (e) {
        console.warn('Failed to load ElevenLabs API key', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (aiModel === 'piper') {
      loadVoices();
    } else if (aiModel === 'elevenlabs') {
      // Load ElevenLabs voices if API key is present
      (async () => {
        if (!elevenApiKey) return;
        try {
          const res = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': elevenApiKey.trim(), 'accept': 'application/json' },
          });
          if (!res.ok) {
            let details = '';
            try { details = await res.text(); } catch {}
            const snippet = details ? `: ${details.slice(0, 200)}` : '';
            throw new Error(`Failed to fetch voices (${res.status})${snippet}`);
          }
          const data = await res.json();
          const list = Array.isArray(data?.voices)
            ? data.voices.map((v) => ({ id: v.voice_id, label: v.name }))
            : [];
          setElVoices(list);
          setElevenVoice((prev) => (list.find((v) => v.id === prev) ? prev : (list[0]?.id || '')));
          setPiperError('');
        } catch (e) {
          console.error(e);
          setElVoices([]);
          setElevenVoice('');
          setPiperError((e?.message || 'Failed to list ElevenLabs voices.') + ' If the key is correct, check network/SSL.');
        }
      })();
    }
  }, [loadVoices, aiModel, elevenApiKey]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; AI Voice Labs</h1>
      {piperError && <div className="warning">{piperError}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ fontWeight: 600 }}>AI Model Selection</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={aiModel}
            onChange={(e) => {
              const value = e.target.value;
              setAiModel(value);
              try { localStorage.setItem('blossom.aiVoiceModel', value); } catch {}
              // Clear state when switching models
              setPiperAudio('');
              setPiperError('');
            }}
          >
            <option value="piper">Piper</option>
            <option value="elevenlabs">ElevenLabs</option>
          </select>
          {aiModel === 'piper' && (
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
          )}
          {aiModel === 'elevenlabs' && (
            <button
              type="button"
              onClick={async () => {
                // re-trigger voice fetch
                try {
                  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
                    headers: { 'xi-api-key': elevenApiKey.trim(), 'accept': 'application/json' },
                  });
                  if (!res.ok) {
                    let details = '';
                    try { details = await res.text(); } catch {}
                    const snippet = details ? `: ${details.slice(0, 200)}` : '';
                    throw new Error(`Failed to fetch voices (${res.status})${snippet}`);
                  }
                  const data = await res.json();
                  const list = Array.isArray(data?.voices)
                    ? data.voices.map((v) => ({ id: v.voice_id, label: v.name }))
                    : [];
                  setElVoices(list);
                  setElevenVoice((prev) => (list.find((v) => v.id === prev) ? prev : (list[0]?.id || '')));
                  setPiperError('');
                } catch (e) {
                  console.error(e);
                  setElVoices([]);
                  setElevenVoice('');
                  setPiperError((e?.message || 'Failed to list ElevenLabs voices.') + ' If the key is correct, check network/SSL.');
                }
              }}
            >
              Refresh Voices
            </button>
          )}
        </div>

        {aiModel === 'piper' ? (
          <>
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
          </>
        ) : aiModel === 'elevenlabs' ? (
          <>
            {!elevenApiKey && (
              <div className="warning" style={{ opacity: 0.9 }}>
                No ElevenLabs API key found. Add it to secrets.json, then click Refresh Voices.
              </div>
            )}
            {elevenApiKey && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <code>Key loaded ({elevenApiKey.slice(0, 6)}…{elevenApiKey.slice(-4)})</code>
                <button
                  type="button"
                  onClick={async () => {
                    setElStatus('');
                    try {
                      const res = await fetch('https://api.elevenlabs.io/v1/user', {
                        headers: { 'xi-api-key': elevenApiKey.trim(), 'accept': 'application/json' },
                      });
                      if (!res.ok) {
                        let details = '';
                        try { details = await res.text(); } catch {}
                        const snippet = details ? `: ${details.slice(0, 200)}` : '';
                        throw new Error(`Key check failed (${res.status})${snippet}`);
                      }
                      const data = await res.json();
                      const name = (data?.subscription?.tier ? `${data?.subscription?.tier}` : '') || (data?.email || data?.user?.email || 'OK');
                      setElStatus(`Key OK (${name})`);
                    } catch (e) {
                      setElStatus(e?.message || String(e));
                    }
                  }}
                >
                  Check Key
                </button>
                {elStatus && <span style={{ opacity: 0.85 }}>{elStatus}</span>}
              </div>
            )}
            <select
              value={elevenVoice}
              onChange={(e) => {
                setElevenVoice(e.target.value);
                if (piperError) setPiperError('');
              }}
              disabled={!elevenApiKey}
            >
              <option value="">{elevenApiKey ? 'Select voice' : 'Add key to secrets.json to load voices'}</option>
              {elVoices.map((voice) => (
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
              disabled={!elevenApiKey || !elevenVoice || !piperText}
              onClick={async () => {
                if (!elevenApiKey) {
                  setPiperError('No ElevenLabs API key configured.');
                  return;
                }
                if (!elevenVoice || !piperText) {
                  setPiperError('Please select a voice and enter text.');
                  return;
                }
                try {
                  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(elevenVoice)}`, {
                    method: 'POST',
                    headers: {
                      'xi-api-key': elevenApiKey.trim(),
                      'accept': 'audio/mpeg',
                      'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                      text: piperText,
                    }),
                  });
                  if (!res.ok) {
                    let details = '';
                    try { details = await res.text(); } catch {}
                    const snippet = details ? `: ${details.slice(0, 200)}` : '';
                    throw new Error(`Synthesis failed (${res.status})${snippet}`);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  setPiperAudio(url);
                  setPiperPath('');
                  setPiperError('');
                } catch (e) {
                  console.error(e);
                  setPiperError((e?.message || String(e) || 'Failed to synthesize with ElevenLabs.') + ' If the key is correct, check network/SSL.');
                }
              }}
            >
              Test
            </button>
            {piperAudio && (
              <div>
                <audio controls src={piperAudio} />
                <div>
                  <a href={piperAudio} download="elevenlabs.mp3">Download</a>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
