import { useCallback, useEffect, useState } from 'react';
import { listPiperVoices } from '../lib/piperVoices';
import { synthWithPiper } from '../lib/piperSynth';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndPiper() {
  const [voices, setVoices] = useState([]);
  const [piperVoice, setPiperVoice] = useState('');
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
    loadVoices();
  }, [loadVoices]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Piper</h1>
      {piperError && <div className="warning">{piperError}</div>}
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
    </>
  );
}
