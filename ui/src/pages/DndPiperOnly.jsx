import { useCallback, useEffect, useState } from 'react';
import { listPiperVoices } from '../lib/piperVoices';
import { synthWithPiper } from '../lib/piperSynth';
import { invoke } from '@tauri-apps/api/core';
import { fileSrc } from '../lib/paths.js';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndPiperOnly() {
  const [voices, setVoices] = useState([]);
  const [piperVoice, setPiperVoice] = useState('');
  const [text, setText] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [wavPath, setWavPath] = useState('');
  const [error, setError] = useState('');

  const loadVoices = useCallback(async () => {
    try {
      const list = await listPiperVoices();
      if (!Array.isArray(list) || list.length === 0) {
        const fallback = {
          id: 'en-us-amy-medium',
          label: 'Amy (Medium) [en_US]',
          modelPath: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx',
          configPath: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx.json',
        };
        setVoices([fallback]);
        setPiperVoice(fallback.id);
        setError('');
      } else {
        setVoices(list);
        setPiperVoice((prev) => {
          const ids = list.map((v) => v.id);
          if (prev && ids.includes(prev)) return prev;
          return list[0]?.id || '';
        });
        setError('');
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  return (
    <>
      <BackButton />
      <h1>AI Voice Labs · Piper</h1>
      {error && <div className="warning">{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={async () => {
              try { await loadVoices(); } catch {}
            }}
          >
            Refresh Voices
          </button>
        </div>
        <select
          value={piperVoice}
          onChange={(e) => {
            setPiperVoice(e.target.value);
            if (error) setError('');
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
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError('');
          }}
        />
        <button
          type="button"
          disabled={!piperVoice || !text}
          onClick={async () => {
            if (!piperVoice || !text) {
              setError('Please select a voice and enter text.');
              return;
            }
            try {
              const selected = voices.find((v) => v.id === piperVoice);
              let model = '';
              let config = '';
              if (selected) {
                try {
                  model = await invoke('resolve_resource', { path: selected.modelPath });
                  config = await invoke('resolve_resource', { path: selected.configPath });
                } catch {}
              }
              if (!model || !config) {
                model = await invoke('resolve_resource', {
                  path: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx',
                });
                config = await invoke('resolve_resource', {
                  path: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx.json',
                });
              }
              const path = await synthWithPiper(text, model, config);
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
                    url = fileSrc(path);
                  }
                }
              }
              setAudioUrl(url);
              setError('');
            } catch (err) {
              console.error(err);
              setError(err?.message || String(err) || 'Failed to generate audio.');
            }
          }}
        >
          Test
        </button>
        {audioUrl && (
          <div>
            <audio controls src={audioUrl} />
            <div>
              <a href={audioUrl || (wavPath ? fileSrc(wavPath) : '')} download="piper.wav">
                Download
              </a>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
