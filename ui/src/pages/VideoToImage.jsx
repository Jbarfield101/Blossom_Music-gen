import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import BackButton from '../components/BackButton.jsx';

const DEFAULT_OUTPUT_HINT = 'assets\\gallery\\image';
const VIDEO_FILTERS = [
  { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
];

function resolveDialogPath(selection) {
  if (!selection) return undefined;
  if (Array.isArray(selection)) {
    const first = selection[0];
    if (!first) return undefined;
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first?.path) return first.path;
    return undefined;
  }
  if (typeof selection === 'string') return selection;
  if (typeof selection === 'object' && selection?.path) return selection.path;
  return undefined;
}

function deriveNameFromPath(path) {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const last = segments.pop() || '';
  if (!last) return '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return last;
  return last.slice(0, dot);
}

export default function VideoToImage() {
  const [videoPath, setVideoPath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [baseName, setBaseName] = useState('');
  const [format, setFormat] = useState('jpg');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [nameTouched, setNameTouched] = useState(false);

  const previewPattern = useMemo(() => {
    const trimmed = baseName.trim();
    const safeName = trimmed || 'YourName';
    return `${safeName}_Frame_0001.${format}`;
  }, [baseName, format]);

  const canExtract = !isProcessing && Boolean(videoPath) && baseName.trim().length > 0;

  const handleBrowseVideo = async () => {
    try {
      setError('');
      const selection = await openDialog({
        multiple: false,
        filters: VIDEO_FILTERS,
      });
      const path = resolveDialogPath(selection);
      if (!path) return;
      setVideoPath(path);
      setResult(null);
      if (!nameTouched) {
        const suggestion = deriveNameFromPath(path);
        if (suggestion) {
          setBaseName(suggestion);
        }
      }
    } catch (err) {
      console.error('Video selection failed', err);
      setError(err?.message || 'Selecting a video failed.');
    }
  };

  const handleBrowseOutput = async () => {
    try {
      setError('');
      const selection = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: outputDir || undefined,
      });
      const path = resolveDialogPath(selection);
      if (!path) return;
      setOutputDir(path);
      setResult(null);
    } catch (err) {
      console.error('Output folder selection failed', err);
      setError(err?.message || 'Selecting an output folder failed.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canExtract) return;
    setIsProcessing(true);
    setError('');
    setResult(null);
    try {
      const payload = {
        videoPath,
        baseName: baseName.trim(),
        format,
      };
      const trimmedOutput = outputDir.trim();
      if (trimmedOutput) {
        payload.outputDir = trimmedOutput;
      }
      const response = await invoke('video_to_image_extract', payload);
      setResult(response);
    } catch (err) {
      console.error('Frame extraction failed', err);
      setError(err?.message || String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="m-md">
      <BackButton />
      <h1>Video to Image</h1>
      <p style={{ marginBottom: 24, maxWidth: 720 }}>
        Extract every frame from a video into individual images. The output is stored in a
        folder named after the project and each frame uses the pattern <code>{previewPattern}</code>.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'grid', gap: 20, maxWidth: 720 }}
      >
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Video File
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <input
              type="text"
              value={videoPath}
              readOnly
              placeholder="Select a video file to convert"
              style={{ width: '100%' }}
            />
            <button type="button" className="back-button" onClick={handleBrowseVideo}>
              Browse
            </button>
          </div>
        </div>

        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Output Folder
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            <input
              type="text"
              value={outputDir}
              placeholder={DEFAULT_OUTPUT_HINT}
              onChange={(event) => {
                setOutputDir(event.target.value);
                setResult(null);
              }}
              style={{ width: '100%' }}
            />
            <button type="button" className="back-button" onClick={handleBrowseOutput}>
              Browse
            </button>
          </div>
          <small style={{ display: 'block', marginTop: 6, opacity: 0.8 }}>
            Leave blank to use <code>{DEFAULT_OUTPUT_HINT}</code>.
          </small>
        </div>

        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Project Name
          </label>
          <input
            type="text"
            value={baseName}
            onChange={(event) => {
              setBaseName(event.target.value);
              setNameTouched(true);
              setResult(null);
            }}
            placeholder="e.g. forest_walk"
            style={{ width: '100%' }}
          />
          <small style={{ display: 'block', marginTop: 6, opacity: 0.8 }}>
            The app creates a folder with this name and files like <code>{previewPattern}</code>.
          </small>
        </div>

        <div>
          <span style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Image Format
          </span>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="format"
                value="jpg"
                checked={format === 'jpg'}
                onChange={() => setFormat('jpg')}
              />
              JPG
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                name="format"
                value="png"
                checked={format === 'png'}
                onChange={() => setFormat('png')}
              />
              PNG
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="submit"
            className="back-button"
            disabled={!canExtract}
          >
            {isProcessing ? 'Extracting...' : 'Extract Frames'}
          </button>
          <span style={{ opacity: 0.75 }}>
            Output folder: <code>{outputDir || DEFAULT_OUTPUT_HINT}</code>
          </span>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 24,
            padding: 12,
            borderRadius: 8,
            border: '1px solid rgba(220, 80, 80, 0.6)',
            color: 'rgb(220, 80, 80)',
            maxWidth: 720,
          }}
        >
          {error}
        </div>
      )}

      {result && !error && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.04)',
            maxWidth: 720,
            display: 'grid',
            gap: 8,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Frames ready</h2>
          <div>
            Saved <strong>{result.frameCount}</strong> frames as{' '}
            <strong>{result.format.toUpperCase()}</strong> in{' '}
            <code>{result.folder}</code>.
          </div>
          <div>
            File pattern: <code>{result.pattern}</code>
          </div>
          {Array.isArray(result.sampleFiles) && result.sampleFiles.length > 0 && (
            <div style={{ fontSize: '0.95rem' }}>
              Sample files:
              <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                {result.sampleFiles.map((path) => (
                  <li key={path} style={{ wordBreak: 'break-all' }}>
                    {path}
                  </li>
                ))}
                {result.frameCount > result.sampleFiles.length && (
                  <li style={{ listStyle: 'none', opacity: 0.75 }}>
                    ...and {result.frameCount - result.sampleFiles.length} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
