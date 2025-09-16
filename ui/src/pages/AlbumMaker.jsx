import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import BackButton from '../components/BackButton.jsx';

export default function AlbumMaker() {
  const [files, setFiles] = useState([]);
  const [outputDir, setOutputDir] = useState('');
  const [outputName, setOutputName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultPath, setResultPath] = useState('');
  const [error, setError] = useState('');

  const addSongs = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] },
      ],
    });
    if (!selected) return;
    const list = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => [...prev, ...list]);
  };

  const pickOutputDir = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === 'string') setOutputDir(dir);
  };

  const move = (idx, delta) => {
    setFiles((prev) => {
      const next = [...prev];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const remove = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const clearAll = () => setFiles([]);

  const makeAlbum = async () => {
    setBusy(true);
    setError('');
    setResultPath('');
    try {
      if (!files.length) throw new Error('Please add at least one song.');
      if (!outputDir) throw new Error('Please choose an output folder.');
      const out = await invoke('album_concat', {
        files,
        outputDir,
        outputName: outputName || null,
      });
      setResultPath(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Album Maker</h1>
      <main className="panel" style={{ display: 'grid', gap: '1rem' }}>
        <section>
          <h2>Tracks</h2>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem' }}>
            <button type="button" onClick={addSongs} disabled={busy}>Add Songs</button>
            <button type="button" onClick={clearAll} disabled={busy || files.length === 0}>Clear</button>
          </div>
          {files.length === 0 ? (
            <p className="muted">No songs selected yet.</p>
          ) : (
            <ol className="list" style={{ paddingLeft: '1.25rem' }}>
              {files.map((p, i) => (
                <li key={p + i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</span>
                  <button type="button" onClick={() => move(i, -1)} disabled={busy || i === 0} title="Move up">↑</button>
                  <button type="button" onClick={() => move(i, +1)} disabled={busy || i === files.length - 1} title="Move down">↓</button>
                  <button type="button" onClick={() => remove(i)} disabled={busy} title="Remove">✕</button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2>Output</h2>
          <div style={{ display: 'grid', gap: '.5rem', maxWidth: 640 }}>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <input
                type="text"
                placeholder="Output folder"
                value={outputDir}
                readOnly
                style={{ flex: 1 }}
              />
              <button type="button" onClick={pickOutputDir} disabled={busy}>Choose…</button>
            </div>
            <input
              type="text"
              placeholder="Optional file name (e.g., MyAlbum.mp3)"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              disabled={busy}
            />
            <div>
              <button type="button" onClick={makeAlbum} disabled={busy || !files.length || !outputDir}>
                {busy ? 'Making Album…' : 'Make Album'}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {resultPath && (
              <div>
                <p>Saved: {resultPath}</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
