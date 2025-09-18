import { useEffect, useMemo, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';

const styles = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    marginTop: '2rem',
    marginBottom: '4rem',
    maxWidth: '860px',
  },
  panel: {
    background: 'linear-gradient(145deg, #f5f5f4, #ffffff)',
    borderRadius: '24px',
    padding: '1.75rem',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.18)',
    border: '1px solid rgba(17, 24, 39, 0.08)',
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '1rem',
  },
  paragraph: {
    margin: 0,
    color: '#1f2937',
    lineHeight: 1.6,
  },
  fileInput: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  chooseButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.5rem',
    borderRadius: '999px',
    background: 'linear-gradient(90deg, #34d399, #10b981)',
    color: '#0f172a',
    border: 'none',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 14px 30px rgba(5, 150, 105, 0.35)',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    border: 0,
  },
  audioPreview: {
    width: '100%',
    marginTop: '0.5rem',
  },
  detailRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    marginTop: '1rem',
    color: '#111827',
    fontWeight: 600,
  },
  detailBadge: {
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    background: 'rgba(17, 24, 39, 0.06)',
  },
  loopControls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    alignItems: 'flex-end',
  },
  numberField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    flex: '1 1 180px',
  },
  numberInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '14px',
    border: '1px solid rgba(17, 24, 39, 0.12)',
    fontSize: '1.05rem',
    fontWeight: 600,
    color: '#0f172a',
    background: '#ffffff',
    boxShadow: 'inset 0 2px 5px rgba(15, 23, 42, 0.08)',
  },
  primaryButton: {
    padding: '0.85rem 1.75rem',
    borderRadius: '16px',
    border: 'none',
    background: 'linear-gradient(90deg, #6366f1, #22d3ee)',
    color: '#0f172a',
    fontWeight: 700,
    fontSize: '1.05rem',
    cursor: 'pointer',
    boxShadow: '0 18px 40px rgba(99, 102, 241, 0.35)',
    flexShrink: 0,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  statusText: {
    color: '#2563eb',
    fontWeight: 600,
    marginTop: '0.75rem',
  },
  errorText: {
    color: '#dc2626',
    fontWeight: 600,
    marginTop: '0.5rem',
  },
  resultPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  downloadLink: {
    alignSelf: 'flex-start',
    padding: '0.65rem 1.5rem',
    borderRadius: '999px',
    background: '#0ea5e9',
    color: '#0f172a',
    fontWeight: 700,
    textDecoration: 'none',
    boxShadow: '0 12px 28px rgba(14, 165, 233, 0.35)',
  },
};

const formatDuration = (seconds) => {
  if (!seconds || Number.isNaN(seconds)) return '0s';
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins <= 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
};

const createLoopedBuffer = (buffer, loops) => {
  const integerLoops = Math.max(1, Math.floor(loops));
  const { sampleRate, numberOfChannels, length } = buffer;
  const totalLength = length * integerLoops;
  const loopedBuffer = new AudioBuffer({
    length: totalLength,
    numberOfChannels,
    sampleRate,
  });

  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    const outputData = loopedBuffer.getChannelData(channel);
    const sourceData = buffer.getChannelData(channel);
    for (let loopIndex = 0; loopIndex < integerLoops; loopIndex += 1) {
      outputData.set(sourceData, loopIndex * length);
    }
  }

  return loopedBuffer;
};

const audioBufferToWav = (buffer) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const samples = buffer.length;
  const blockAlign = (numChannels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const bufferLength = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i += 1) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const channelData = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
};

export default function BeatMaker() {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [audioURL, setAudioURL] = useState('');
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loopInput, setLoopInput] = useState('4');
  const [loopError, setLoopError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultURL, setResultURL] = useState('');
  const [resultDuration, setResultDuration] = useState(0);

  const parsedLoops = useMemo(() => {
    const value = Number.parseInt(loopInput, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [loopInput]);

  const estimatedDuration = useMemo(() => {
    if (!audioBuffer || !parsedLoops) return 0;
    return audioBuffer.duration * parsedLoops;
  }, [audioBuffer, parsedLoops]);

  useEffect(() => () => {
    if (audioURL) URL.revokeObjectURL(audioURL);
  }, [audioURL]);

  useEffect(() => () => {
    if (resultURL) URL.revokeObjectURL(resultURL);
  }, [resultURL]);

  const resetResult = () => {
    if (resultURL) {
      URL.revokeObjectURL(resultURL);
      setResultURL('');
      setResultDuration(0);
    }
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const selectedFile = event.target.files?.[0];
    resetResult();

    if (!selectedFile) {
      setFile(null);
      setAudioBuffer(null);
      setAudioURL('');
      setStatus('');
      setError('');
      return;
    }

    if (!selectedFile.type.startsWith('audio/')) {
      setError('Please choose an audio file.');
      setStatus('');
      setFile(null);
      setAudioBuffer(null);
      setAudioURL('');
      return;
    }

    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }

    const objectURL = URL.createObjectURL(selectedFile);
    setFile(selectedFile);
    setAudioURL(objectURL);
    setStatus('Decoding audio…');
    setError('');

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API unavailable');
      }
      const audioContext = new AudioContextClass();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setAudioBuffer(decodedBuffer);
      setStatus(`Loaded clip: ${selectedFile.name}`);
      setError('');
      setResultDuration(0);
      await audioContext.close?.();
    } catch (decodeError) {
      console.error(decodeError);
      setError('Unable to decode this audio file. Try a different format.');
      setStatus('');
      setAudioBuffer(null);
      setAudioURL('');
      setFile(null);
    }
  };

  const handleLoopChange = (event) => {
    setLoopInput(event.target.value);
    setLoopError('');
  };

  const handleGenerate = async () => {
    setLoopError('');
    setError('');

    if (!audioBuffer) {
      setError('Upload an audio clip before generating loops.');
      return;
    }

    const loops = Number.parseInt(loopInput, 10);
    if (!Number.isFinite(loops) || loops <= 0) {
      setLoopError('Enter a loop count greater than 0.');
      return;
    }

    setIsProcessing(true);
    setStatus('Building looped audio…');

    try {
      const loopedBuffer = createLoopedBuffer(audioBuffer, loops);
      const wavArrayBuffer = audioBufferToWav(loopedBuffer);
      const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });

      if (resultURL) {
        URL.revokeObjectURL(resultURL);
      }

      const url = URL.createObjectURL(blob);
      setResultURL(url);
      setResultDuration(loopedBuffer.duration);
      setStatus('Looped audio ready!');
    } catch (generationError) {
      console.error(generationError);
      setStatus('');
      setError('Something went wrong while building the loop.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      <BackButton />
      <h1>Beat Maker</h1>
      <p style={{ color: '#374151', maxWidth: '720px' }}>
        Stitch any audio clip into a longer groove. Upload a sound, choose how many
        times it should repeat, and download a perfectly looped WAV file.
      </p>
      <div style={styles.layout}>
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>1. Upload an audio clip</h2>
          <div style={styles.fileInput}>
            <button type="button" style={styles.chooseButton} onClick={handleChooseFile}>
              Choose audio file
            </button>
            <input
              ref={fileInputRef}
              style={styles.hiddenInput}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
            />
            {file && (
              <p style={styles.paragraph}>
                Selected: <strong>{file.name}</strong>
              </p>
            )}
            {status && (
              <span style={styles.statusText} role="status" aria-live="polite">
                {status}
              </span>
            )}
            {error && (
              <span style={styles.errorText} role="alert">
                {error}
              </span>
            )}
            {audioURL && (
              <audio
                controls
                src={audioURL}
                style={styles.audioPreview}
                aria-label="Preview original audio clip"
              />
            )}
            {audioBuffer && (
              <div style={styles.detailRow}>
                <span style={styles.detailBadge}>
                  Clip length: {formatDuration(audioBuffer.duration)}
                </span>
                <span style={styles.detailBadge}>
                  Sample rate: {audioBuffer.sampleRate.toLocaleString()} Hz
                </span>
                <span style={styles.detailBadge}>
                  Channels: {audioBuffer.numberOfChannels}
                </span>
              </div>
            )}
          </div>
        </section>

        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>2. Set your loop count</h2>
          <div style={styles.loopControls}>
            <label style={styles.numberField}>
              <span style={{ fontWeight: 700, color: '#111827' }}>Number of loops</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={loopInput}
                onChange={handleLoopChange}
                style={styles.numberInput}
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              style={{
                ...styles.primaryButton,
                ...(isProcessing || !audioBuffer ? styles.primaryButtonDisabled : {}),
              }}
              disabled={isProcessing || !audioBuffer}
            >
              {isProcessing ? 'Processing…' : 'Build Looped Audio'}
            </button>
          </div>
          {loopError && (
            <span style={styles.errorText} role="alert">
              {loopError}
            </span>
          )}
          <p style={{ ...styles.paragraph, marginTop: '1rem' }}>
            Estimated length:{' '}
            <strong>{estimatedDuration ? formatDuration(estimatedDuration) : '0s'}</strong>
          </p>
        </section>

        {resultURL && (
          <section style={styles.panel}>
            <h2 style={styles.sectionTitle}>3. Download your loop</h2>
            <div style={styles.resultPanel}>
              <p style={styles.paragraph}>
                Final duration: <strong>{formatDuration(resultDuration)}</strong>
              </p>
              <audio
                controls
                src={resultURL}
                style={styles.audioPreview}
                aria-label="Preview looped audio"
              />
              <a
                href={resultURL}
                download={file ? `${file.name.replace(/\.[^/.]+$/, '') || 'looped'}-x${parsedLoops || 1}.wav` : 'looped-output.wav'}
                style={styles.downloadLink}
              >
                Download WAV
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
