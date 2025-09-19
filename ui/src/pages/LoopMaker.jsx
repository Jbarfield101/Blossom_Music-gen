import { useRef, useState, useEffect, useCallback } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile as writeBinaryFile, readFile as readBinaryFile } from '@tauri-apps/plugin-fs';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import { useSharedState, DEFAULT_LOOPMAKER_FORM } from '../lib/sharedState.jsx';

const OUTPUT_FORMAT_OPTIONS = [
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    label: 'WebM (VP9 + Opus)',
    extension: 'webm',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    label: 'WebM (VP8 + Opus)',
    extension: 'webm',
  },
  {
    mimeType: 'video/webm;codecs=vp8',
    label: 'WebM (VP8)',
    extension: 'webm',
  },
  {
    mimeType: 'video/webm',
    label: 'WebM (Browser default codecs)',
    extension: 'webm',
  },
  {
    mimeType: 'video/mp4;codecs=h264,aac',
    label: 'MP4 (H.264 + AAC)',
    extension: 'mp4',
  },
];

const normalizeMime = (mime) =>
  typeof mime === 'string' ? mime.replace(/\s+/g, '').toLowerCase() : '';

const findFormatOption = (mimeType) => {
  const normalized = normalizeMime(mimeType);
  if (!normalized) return undefined;
  return OUTPUT_FORMAT_OPTIONS.find(
    (option) => normalizeMime(option.mimeType) === normalized
  );
};

const extensionFromMime = (mimeType, fallbackMimeType) => {
  const match = findFormatOption(mimeType) || findFormatOption(fallbackMimeType);
  if (match) {
    return match.extension;
  }
  const normalized = normalizeMime(mimeType) || normalizeMime(fallbackMimeType);
  if (!normalized) {
    return 'webm';
  }
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogv';
  return 'webm';
};

function sanitizeName(s) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    if (/^[a-zA-Z0-9 _-]$/.test(ch)) out += ch;
    else out += '_';
  }
  return out.trim().replace(/\.+$/g, '').substring(0, 120) || 'loop';
}

const MAX_CONCAT_DURATION_SECONDS = 60 * 60 * 3; // 3 hours of video
const MAX_CONCAT_FALLBACK_LOOPS = 2048;

export default function LoopMaker() {
  const REMAINDER_EPSILON = 0.0001;

  const computeLoopPlan = (target, clipDuration) => {
    if (!clipDuration || clipDuration <= 0 || !target || target <= 0) {
      return { fullLoops: 0, remainder: 0 };
    }

    const rawLoops = Math.floor(target / clipDuration);
    const fullLoops = Math.max(0, rawLoops);
    const rawRemainder = target - fullLoops * clipDuration;
    const remainder = rawRemainder > REMAINDER_EPSILON ? rawRemainder : 0;

    return { fullLoops, remainder };
  };

  const computeConcatLoopLimit = (clipSeconds) => {
    const seconds = Number(clipSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return MAX_CONCAT_FALLBACK_LOOPS;
    }
    return Math.floor(MAX_CONCAT_DURATION_SECONDS / seconds);
  };

  const defaultOutputFormat = DEFAULT_LOOPMAKER_FORM.outputFormat;
  const defaultFormatOption =
    findFormatOption(defaultOutputFormat) || OUTPUT_FORMAT_OPTIONS[0];
  const defaultFormatMime =
    defaultFormatOption?.mimeType || defaultOutputFormat || '';

  const videoRef = useRef(null);
  const [selectedFormat, setSelectedFormat] = useState(defaultFormatMime);
  const [formatOptions, setFormatOptions] = useState(() =>
    defaultFormatOption ? [defaultFormatOption] : []
  );
  const [targetSeconds, setTargetSeconds] = useState(DEFAULT_LOOPMAKER_FORM.targetSeconds);
  const [targetInput, setTargetInput] = useState(DEFAULT_LOOPMAKER_FORM.targetInput);
  const [targetError, setTargetError] = useState('');
  const [file, setFile] = useState(null);
  const [filePath, setFilePath] = useState('');
  const [videoURL, setVideoURL] = useState(null);
  const [outputName, setOutputName] = useState('');
  const [duration, setDuration] = useState(0);
  const [loopsNeeded, setLoopsNeeded] = useState(0);
  const [loopsCompleted, setLoopsCompleted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [useConcatenated, setUseConcatenated] = useState(false);
  const [processedBlob, setProcessedBlob] = useState(null);
  const [processedURL, setProcessedURL] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isRenderingDownload, setIsRenderingDownload] = useState(false);
  const [outdir, setOutdir] = useState('');
  const [lastJobId, setLastJobId] = useState(null);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [runningInTauri] = useState(() => {
    try {
      return isTauri();
    } catch (err) {
      console.warn('Unable to detect Tauri environment', err);
      return false;
    }
  });
  const processingTokenRef = useRef(0);
  const { ready: sharedReady, state: sharedState, updateSection } = useSharedState();
  const restoredRef = useRef(false);
  const jobIdRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasSupportCheck =
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function';

    let supported = [];

    if (hasSupportCheck) {
      supported = OUTPUT_FORMAT_OPTIONS.filter((option) => {
        try {
          return MediaRecorder.isTypeSupported(option.mimeType);
        } catch (err) {
          console.warn('MediaRecorder support check failed', err);
          return false;
        }
      });
    }

    if (!supported.length) {
      const fallback = defaultFormatOption
        ? [defaultFormatOption]
        : OUTPUT_FORMAT_OPTIONS.slice(0, 1);
      supported = fallback;
    }

    setFormatOptions(supported);
    setSelectedFormat((prev) => {
      if (supported.some((option) => option.mimeType === prev)) {
        return prev;
      }
      return supported[0]?.mimeType || prev;
    });
  }, [defaultFormatOption]);

  const formatTimestamp = useCallback((value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const jobs = await invoke('list_completed_jobs');
      if (Array.isArray(jobs)) {
        setCompletedJobs(jobs);
      }
    } catch (err) {
      console.error('failed to load jobs', err);
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    const timer = setInterval(refreshJobs, 10000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  useEffect(() => {
    if (!sharedReady || restoredRef.current) return undefined;

    const saved = sharedState?.loopMaker || {};
    const form = saved.form || {};
    const savedSeconds =
      typeof form.targetSeconds === 'number' && form.targetSeconds > 0
        ? form.targetSeconds
        : DEFAULT_LOOPMAKER_FORM.targetSeconds;
    const savedInput =
      typeof form.targetInput === 'string' && form.targetInput
        ? form.targetInput
        : String(savedSeconds);
    const savedFormatRaw =
      typeof form.outputFormat === 'string' && form.outputFormat
        ? form.outputFormat
        : defaultFormatMime;
    const matchedFormat =
      findFormatOption(savedFormatRaw)?.mimeType || savedFormatRaw;

    setTargetSeconds(savedSeconds);
    setTargetInput(savedInput);
    setSelectedFormat(matchedFormat || defaultFormatMime);
    setStatusMessage(
      typeof saved.statusMessage === 'string' ? saved.statusMessage : ''
    );
    setErrorMessage(
      typeof saved.errorMessage === 'string' ? saved.errorMessage : ''
    );
    setLastJobId(saved.lastJobId ?? null);

    const job = saved.job || null;
    const lastSummary = saved.lastSummary || null;
    if (job?.id) {
      jobIdRef.current = job.id;
    } else if (saved.activeJobId) {
      jobIdRef.current = saved.activeJobId;
    } else {
      jobIdRef.current = null;
    }

    if (lastSummary) {
      if (typeof lastSummary.loops === 'number') {
        setLoopsNeeded(lastSummary.loops);
      }
      if (
        typeof lastSummary.statusMessage === 'string' &&
        !saved.statusMessage
      ) {
        setStatusMessage(lastSummary.statusMessage);
      }
      if (typeof lastSummary.error === 'string' && !saved.errorMessage) {
        setErrorMessage(lastSummary.error);
      }
    }

    let cancelled = false;
    if (runningInTauri && lastSummary?.savedPath) {
      (async () => {
        try {
          const data = await readBinaryFile(lastSummary.savedPath);
          const blob = new Blob([data], {
            type: lastSummary.mimeType || 'video/webm',
          });
          const url = URL.createObjectURL(blob);
          if (!cancelled) {
            setProcessedBlob(blob);
            setProcessedURL(url);
            setUseConcatenated(true);
          } else {
            URL.revokeObjectURL(url);
          }
        } catch (err) {
          console.warn('Failed to restore saved loop', err);
        }
      })();
    }

    restoredRef.current = true;

    return () => {
      cancelled = true;
    };
  }, [sharedReady, sharedState, runningInTauri]);

  useEffect(() => {
    if (!sharedReady || !restoredRef.current) return;
    updateSection('loopMaker', (prev) => ({
      form: {
        ...prev.form,
        targetSeconds,
        targetInput,
        outputFormat: selectedFormat,
      },
    }));
  }, [sharedReady, updateSection, targetSeconds, targetInput, selectedFormat]);

  useEffect(() => {
    if (!sharedReady || !restoredRef.current) return;
    updateSection('loopMaker', { statusMessage });
  }, [sharedReady, updateSection, statusMessage]);

  useEffect(() => {
    if (!sharedReady || !restoredRef.current) return;
    updateSection('loopMaker', { errorMessage });
  }, [sharedReady, updateSection, errorMessage]);

  useEffect(() => {
    if (!sharedReady || !restoredRef.current) return;
    updateSection('loopMaker', { lastJobId });
  }, [sharedReady, updateSection, lastJobId]);

  const progressPercent = targetSeconds
    ? Math.min((elapsed / targetSeconds) * 100, 100)
    : 0;

  const styles = {
    page: {
      maxWidth: '960px',
      margin: '0 auto 4rem',
    },
    description: {
      color: '#374151',
      maxWidth: '720px',
      lineHeight: 1.6,
    },
    layout: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1.5rem',
      marginTop: '2rem',
    },
    frame: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '1.5rem',
      border: '14px solid #2f2a27',
      borderRadius: '32px',
      background: 'linear-gradient(145deg, #52463d 0%, #201712 100%)',
      boxShadow: '0 20px 45px rgba(0, 0, 0, 0.45)',
      maxWidth: '720px',
      width: '100%',
    },
    video: {
      width: '100%',
      borderRadius: '18px',
      backgroundColor: '#000',
      boxShadow: 'inset 0 0 20px rgba(0, 0, 0, 0.6)',
    },
    counters: {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: '1rem',
      fontSize: '1.5rem',
      fontWeight: 700,
      color: '#111827',
      textAlign: 'center',
    },
    counterBox: {
      padding: '0.75rem 1.5rem',
      borderRadius: '0.85rem',
      background: '#f9fafb',
      boxShadow: '0 10px 20px rgba(17, 24, 39, 0.15)',
      minWidth: '200px',
    },
    progressTrack: {
      width: '100%',
      maxWidth: '480px',
      height: '14px',
      borderRadius: '999px',
      background: '#e5e7eb',
      overflow: 'hidden',
      border: '2px solid #111827',
    },
    progressFill: {
      height: '100%',
      width: `${progressPercent}%`,
      background: 'linear-gradient(90deg, #22d3ee, #6366f1)',
      transition: 'width 150ms ease-out',
    },
    targetControls: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      marginTop: '1rem',
      padding: '0.75rem 1rem',
      background: '#f9fafb',
      borderRadius: '0.85rem',
      boxShadow: '0 10px 20px rgba(17, 24, 39, 0.15)',
    },
    targetLabel: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      color: '#111827',
      fontWeight: 700,
    },
    targetInput: {
      width: '140px',
      padding: '0.5rem 0.75rem',
      borderRadius: '0.5rem',
      border: '1px solid #d1d5db',
      fontSize: '1rem',
      fontWeight: 600,
      color: '#111827',
      background: '#ffffff',
      boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
    },
    targetButton: {
      padding: '0.55rem 1.25rem',
      borderRadius: '0.75rem',
      border: 'none',
      background: 'linear-gradient(90deg, #22d3ee, #6366f1)',
      color: '#0f172a',
      fontWeight: 700,
      fontSize: '1rem',
      cursor: 'pointer',
      boxShadow: '0 8px 18px rgba(15, 23, 42, 0.25)',
    },
    targetError: {
      marginTop: '0.5rem',
      color: '#dc2626',
      fontWeight: 600,
      textAlign: 'center',
    },
    downloadBar: {
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '1rem',
      padding: '1rem 1.5rem',
      background: '#f9fafb',
      borderRadius: '0.85rem',
      boxShadow: '0 10px 20px rgba(17, 24, 39, 0.15)',
      width: '100%',
      maxWidth: '480px',
    },
    formatControls: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.35rem',
      minWidth: '220px',
    },
    formatLabel: {
      fontWeight: 700,
      color: '#111827',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    },
    formatSelect: {
      padding: '0.5rem 0.75rem',
      borderRadius: '0.5rem',
      border: '1px solid #d1d5db',
      background: '#ffffff',
      fontWeight: 600,
      color: '#111827',
      boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
    },
    formatHint: {
      fontSize: '0.85rem',
      color: '#4b5563',
      fontWeight: 500,
    },
    saveButton: {
      padding: '0.65rem 1.5rem',
      borderRadius: '0.75rem',
      border: 'none',
      background: 'linear-gradient(90deg, #6366f1, #22d3ee)',
      color: '#0f172a',
      fontWeight: 700,
      fontSize: '1rem',
      cursor: 'pointer',
      boxShadow: '0 8px 18px rgba(15, 23, 42, 0.25)',
    },
    saveButtonDisabled: {
      opacity: 0.6,
      cursor: 'not-allowed',
      boxShadow: 'none',
    },
    statusMessage: {
      color: '#2563eb',
      fontWeight: 600,
      textAlign: 'center',
    },
    errorMessage: {
      color: '#dc2626',
      fontWeight: 600,
      textAlign: 'center',
    },
  };

  const selectedFormatOptionDisplay =
    formatOptions.find((option) => option.mimeType === selectedFormat) ||
    findFormatOption(selectedFormat) ||
    null;
  const selectedMimeForDisplay =
    selectedFormatOptionDisplay?.mimeType || selectedFormat || 'video/webm';
  const selectedExtensionForDisplay =
    selectedFormatOptionDisplay?.extension ||
    extensionFromMime(selectedMimeForDisplay, selectedFormat);
  const formatSelectDisabled = formatOptions.length <= 1;
  const buttonSuffix = selectedExtensionForDisplay
    ? ` (.${selectedExtensionForDisplay.toLowerCase()})`
    : '';
  const preparingDownloadLabel = selectedExtensionForDisplay
    ? `Preparing ${selectedExtensionForDisplay.toUpperCase()} Download…`
    : 'Preparing Download…';
  const actionButtonLabel = runningInTauri
    ? `Save Loop${buttonSuffix}`
    : `Download Loop${buttonSuffix}`;

  useEffect(() => {
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
    };
  }, [videoURL]);

  useEffect(() => () => {
    if (processedURL) URL.revokeObjectURL(processedURL);
  }, [processedURL]);

  useEffect(() => {
    if (!duration || !targetSeconds || targetSeconds <= 0) {
      setLoopsNeeded(0);
      setLoopsCompleted(0);
      return;
    }

    const { fullLoops } = computeLoopPlan(targetSeconds, duration);
    setLoopsNeeded(fullLoops);
    setLoopsCompleted((prev) => Math.min(prev, fullLoops));
  }, [targetSeconds, duration]);

  useEffect(() => {
    setElapsed((prev) => Math.min(prev, targetSeconds));
  }, [targetSeconds]);

  const cleanupProcessed = useCallback(() => {
    processingTokenRef.current += 1;
    setProcessedBlob(null);
    setProcessedURL((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setStatusMessage('');
    setErrorMessage('');
    setIsRenderingDownload(false);
  }, []);

  const resetToBaseVideo = useCallback(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUseConcatenated(false);
    setVideoURL(url);
    cleanupProcessed();
  }, [cleanupProcessed, file]);

  const chooseOutdir = useCallback(async () => {
    if (!runningInTauri) return;
    try {
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === 'string') {
        setOutdir(dir);
      }
    } catch (err) {
      console.warn('Failed to choose output folder', err);
    }
  }, [runningInTauri]);

  const clearOutdir = useCallback(() => setOutdir(''), []);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    // In Tauri, File object often carries an absolute path
    setFilePath(typeof f?.path === 'string' ? f.path : '');
    setLoopsCompleted(0);
    setElapsed(0);
    setUseConcatenated(false);
    const url = URL.createObjectURL(f);
    setVideoURL(url);
    // Prefer MP4 output if the input is MP4
    if (String(f.type || '').toLowerCase().includes('mp4')) {
      setSelectedFormat('video/mp4;codecs=h264,aac');
    }
    setTargetInput(String(targetSeconds));
    setTargetError('');
    cleanupProcessed();
  };

  const buildConcatenatedSource = (file, loops, clipDurationSeconds) =>
    new Promise((resolve) => {
      if (typeof window === 'undefined' || !('MediaSource' in window)) {
        resolve(null);
        return;
      }

      const loopCount = Math.max(0, Math.floor(Number(loops)));
      if (loopCount <= 0) {
        resolve(null);
        return;
      }

      const clipSeconds = Number(clipDurationSeconds);
      const maxLoopsByDuration = computeConcatLoopLimit(clipSeconds);

      if (maxLoopsByDuration > 0 && loopCount > maxLoopsByDuration) {
        console.warn(
          'Requested concatenation exceeds the safety limit. Falling back to looped playback.',
          {
            requestedLoops: loopCount,
            clipSeconds,
            maxLoops: maxLoopsByDuration,
          }
        );
        resolve(null);
        return;
      }

      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);

      const cleanupAndResolveNull = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };

      const waitForUpdate = (sourceBuffer) =>
        new Promise((res) => {
          if (!sourceBuffer.updating) {
            res();
            return;
          }
          sourceBuffer.addEventListener('updateend', res, { once: true });
        });

      mediaSource.addEventListener(
        'sourceopen',
        async () => {
          try {
            if (!MediaSource.isTypeSupported(file.type)) {
              alert(
                'This video format is not supported for seamless looping; using basic repeat.'
              );
              cleanupAndResolveNull();
              return;
            }

            const sourceBuffer = mediaSource.addSourceBuffer(file.type);
            sourceBuffer.mode = 'sequence';
            let fileBuffer = await file.arrayBuffer();
            // SourceBuffer copies data on append, so we can safely reuse the same view
            // without allocating fresh ArrayBuffers for every loop.
            const reusableSegment = new Uint8Array(fileBuffer);
            fileBuffer = null;

            for (let appended = 0; appended < loopCount; appended += 1) {
              await waitForUpdate(sourceBuffer);
              sourceBuffer.appendBuffer(reusableSegment);
            }

            await waitForUpdate(sourceBuffer);
            mediaSource.endOfStream();
            mediaSource.removeEventListener('error', cleanupAndResolveNull);
            resolve(url);
            return;
          } catch (err) {
            console.error('MediaSource error', err);
            cleanupAndResolveNull();
          }
        },
        { once: true }
      );

      mediaSource.addEventListener('error', cleanupAndResolveNull, { once: true });
    });

  const selectRecorderMimeType = useCallback(() => {
    const preferred = selectedFormat;
    const hasSupportCheck =
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function';

    if (!hasSupportCheck) {
      return preferred || formatOptions[0]?.mimeType || '';
    }

    const tryCandidate = (candidate) => {
      if (!candidate) return false;
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch (err) {
        console.warn('MediaRecorder support check failed', err);
        return false;
      }
    };

    if (preferred && tryCandidate(preferred)) {
      return preferred;
    }

    for (const option of formatOptions) {
      const candidate = option?.mimeType;
      if (!candidate) continue;
      if (normalizeMime(candidate) === normalizeMime(preferred)) continue;
      if (tryCandidate(candidate)) {
        return candidate;
      }
    }

    return preferred || formatOptions[0]?.mimeType || '';
  }, [formatOptions, selectedFormat]);

  const startProcessingDownload = useCallback(
    async (sourceUrl, opts = {}) => {
      if (!sourceUrl) return;
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
      }

      const token = processingTokenRef.current + 1;
      processingTokenRef.current = token;

      setProcessedBlob(null);
      setProcessedURL((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      setStatusMessage('');
      setErrorMessage('');
      setIsRenderingDownload(false);

      if (typeof MediaRecorder === 'undefined') {
        setErrorMessage(
          'This browser cannot prepare downloadable video loops. Try the desktop app.'
        );
        return;
      }

      const mimeType = selectRecorderMimeType();
      const extensionForStatus = extensionFromMime(mimeType, selectedFormat);
      const extensionLabel = extensionForStatus
        ? extensionForStatus.toUpperCase()
        : 'VIDEO';

      setStatusMessage(`Rendering ${extensionLabel} loop… This runs in real time.`);
      setIsRenderingDownload(true);

      let hiddenVideo = null;

      try {
        hiddenVideo = document.createElement('video');
        hiddenVideo.src = sourceUrl;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.preload = 'auto';
        hiddenVideo.crossOrigin = 'anonymous';
        hiddenVideo.style.position = 'fixed';
        hiddenVideo.style.opacity = '0';
        hiddenVideo.style.pointerEvents = 'none';
        hiddenVideo.style.width = '1px';
        hiddenVideo.style.height = '1px';
        document.body.appendChild(hiddenVideo);

        await new Promise((resolve, reject) => {
          const handleLoaded = () => {
            hiddenVideo.removeEventListener('error', handleError);
            resolve();
          };
          const handleError = (event) => {
            hiddenVideo.removeEventListener('loadedmetadata', handleLoaded);
            reject(
              event?.error ||
                new Error('Unable to load the looped video for rendering.')
            );
          };
          hiddenVideo.addEventListener('loadedmetadata', handleLoaded, {
            once: true,
          });
          hiddenVideo.addEventListener('error', handleError, { once: true });
        });

        if (processingTokenRef.current !== token) {
          return;
        }

        const captureStream =
          hiddenVideo.captureStream?.() || hiddenVideo.mozCaptureStream?.();
        if (!captureStream) {
          throw new Error(
            'Video captureStream is not supported in this browser. Download disabled.'
          );
        }

        const recorderOptions = mimeType ? { mimeType } : undefined;
        const recorder = new MediaRecorder(captureStream, recorderOptions);
        const chunks = [];

        recorder.addEventListener('dataavailable', (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        });

        const recorderStopped = new Promise((resolve) => {
          recorder.addEventListener('stop', resolve, { once: true });
        });

        const loopPlayback = Boolean(opts.loopPlayback);
        const totalSeconds = Number(opts.totalSeconds) || 0;

        recorder.start();
        hiddenVideo.currentTime = 0;
        hiddenVideo.loop = loopPlayback;
        await hiddenVideo.play();

        let stopTimer;
        if (loopPlayback && totalSeconds > 0) {
          stopTimer = setTimeout(() => {
            try { recorder.stop(); } catch {}
          }, Math.max(0, Math.round(totalSeconds * 1000)));
        } else {
          await new Promise((resolve) => {
            hiddenVideo.addEventListener('ended', resolve, { once: true });
          });
        }

        if (processingTokenRef.current !== token) {
          recorder.stop();
          await recorderStopped;
          return;
        }

        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
        await recorderStopped;

        if (processingTokenRef.current !== token) {
          return;
        }

        const resolvedMime =
          recorder.mimeType || mimeType || selectedFormat || 'video/webm';
        const blob = new Blob(chunks, {
          type: resolvedMime,
        });
        const url = URL.createObjectURL(blob);

        const readyExtension = extensionFromMime(resolvedMime, selectedFormat);
        const readyLabel = readyExtension ? readyExtension.toUpperCase() : 'VIDEO';

        setProcessedBlob(blob);
        setProcessedURL(url);
        setStatusMessage(
          `Loop ready to save as ${readyLabel}. Choose a format and destination below.`
        );
      } catch (err) {
        console.error('Loop rendering error', err);
        if (processingTokenRef.current !== token) {
          return;
        }
        setStatusMessage('');
        const message =
          err instanceof Error ? err.message : 'Unable to prepare the loop.';
        setErrorMessage(message);
      } finally {
        if (hiddenVideo) {
          hiddenVideo.pause();
          hiddenVideo.src = '';
          hiddenVideo.remove();
        }
        if (typeof stopTimer !== 'undefined') {
          clearTimeout(stopTimer);
        }
        if (processingTokenRef.current === token) {
          setIsRenderingDownload(false);
        }
      }
    },
    [selectRecorderMimeType, selectedFormat]
  );

  // Do not auto-start rendering; wait for explicit user action.
  useEffect(() => {
    if (!useConcatenated) {
      cleanupProcessed();
    }
  }, [cleanupProcessed, useConcatenated]);

  const handleLoadedMetadata = async (e) => {
    const dur = e.target.duration;
    const node = videoRef.current;

    if (!node) return;

    if (!useConcatenated) {
      setDuration(dur);

      if (!file) {
        if (targetSeconds > 0) {
          node.play();
        }
        return;
      }

      const { fullLoops, remainder } = computeLoopPlan(targetSeconds, dur);
      const shouldConcatenate =
        fullLoops > 1 && remainder <= REMAINDER_EPSILON;

      if (shouldConcatenate) {
        const limit = computeConcatLoopLimit(dur);
        if (limit > 0 && fullLoops > limit) {
          setStatusMessage(
            'Requested duration is too long to pre-concatenate. Using seamless looping playback instead.'
          );
        } else {
          const concatUrl = await buildConcatenatedSource(file, fullLoops, dur);
          if (concatUrl) {
            setUseConcatenated(true);
            setVideoURL(concatUrl);
            setStatusMessage('');
            return; // wait for concatenated video metadata
          }
          setStatusMessage(
            'Unable to prebuild a concatenated video for this target. Falling back to seamless looping playback.'
          );
        }
      }

      if (targetSeconds > 0) {
        node.play();
      }
    } else if (targetSeconds > 0) {
      node.play();
    }
  };

  const handleTimeUpdate = (e) => {
    if (!targetSeconds || targetSeconds <= 0) {
      setElapsed(0);
      return;
    }

    const node = e.target;
    let totalElapsed = useConcatenated
      ? node.currentTime
      : loopsCompleted * duration + node.currentTime;

    if (totalElapsed >= targetSeconds - REMAINDER_EPSILON) {
      totalElapsed = targetSeconds;
      if (!node.paused) {
        node.pause();
      }
      if (!useConcatenated) {
        setLoopsCompleted((prev) => (prev < loopsNeeded ? loopsNeeded : prev));
      }
    }

    setElapsed(totalElapsed);
  };

  const handleEnded = (e) => {
    if (useConcatenated) return;
    const newLoops = loopsCompleted + 1;
    setLoopsCompleted(newLoops);
    const total = newLoops * duration;
    if (total < targetSeconds) {
      e.target.currentTime = 0;
      e.target.play();
    }
  };

  const handleFormatChange = (e) => {
    const value = e.target.value;
    const matched = findFormatOption(value)?.mimeType || value;
    setSelectedFormat(matched);
    setErrorMessage('');
  };

  const handleTargetInputChange = (e) => {
    setTargetInput(e.target.value);
    if (targetError) setTargetError('');
  };

  const handleTargetSubmit = async (e) => {
    e.preventDefault();
    const trimmed = targetInput.trim();
    if (!trimmed) {
      setTargetError('Please enter a duration in seconds.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setTargetError('Enter a positive number of seconds.');
      return;
    }

    setTargetSeconds(parsed);
    setTargetInput(String(parsed));
    setTargetError('');

    let loops = 0;
    let remainder = 0;

    if (duration) {
      const { fullLoops, remainder: leftover } = computeLoopPlan(
        parsed,
        duration
      );
      loops = fullLoops;
      remainder = leftover;
      setLoopsNeeded(fullLoops);
      setLoopsCompleted((prev) => Math.min(prev, fullLoops));
    }

    if (!file || !duration) return;

    const shouldConcatenate = loops > 1 && remainder <= REMAINDER_EPSILON;

    if (!shouldConcatenate) {
      if (useConcatenated) {
        resetToBaseVideo();
      }
      cleanupProcessed();
      setStatusMessage("Use 'Render Loop' below to export at this length.");
      setErrorMessage('');
      return;
    }

    const maxLoops = computeConcatLoopLimit(duration);
    if (maxLoops > 0 && loops > maxLoops) {
      if (useConcatenated) {
        resetToBaseVideo();
      } else {
        cleanupProcessed();
      }
      setStatusMessage(
        'Requested duration is too long to pre-concatenate. Using seamless looping playback instead.'
      );
      setErrorMessage('');
      return;
    }

    const concatUrl = await buildConcatenatedSource(file, loops, duration);
    if (concatUrl) {
      setUseConcatenated(true);
      setVideoURL(concatUrl);
      setStatusMessage('');
    } else {
      if (useConcatenated) {
        resetToBaseVideo();
      } else {
        cleanupProcessed();
      }
      setStatusMessage(
        'Unable to prebuild a concatenated video for this target. Falling back to seamless looping playback.'
      );
      setErrorMessage('');
    }
  };

  const handleSaveLoop = async () => {
    if (!processedBlob) {
      setErrorMessage('The loop is still preparing. Please wait for it to finish.');
      return;
    }

    const userBase = outputName && outputName.trim() ? sanitizeName(outputName.trim()) : '';
    const baseName = userBase
      || (file ? `${file.name.replace(/\.[^/.]+$/, '') || 'loop'}` : 'loop');
    const blobMime = processedBlob.type;
    const resolvedMime =
      blobMime || selectedFormat || formatOptions[0]?.mimeType || 'video/webm';
    const extension = 'mp4';
    const defaultFileName = `${baseName}.${extension}`;
    const extensionLabel = 'MP4';

    setErrorMessage('');

    const localJobId = jobIdRef.current || `loopmaker-${Date.now()}`;
    jobIdRef.current = localJobId;
    const startedAt = new Date().toISOString();

    if (sharedReady) {
      updateSection('loopMaker', () => ({
        activeJobId: localJobId,
        job: {
          id: localJobId,
          status: 'running',
          startedAt,
          finishedAt: null,
          summary: {
            targetSeconds,
            loops: loopsNeeded || 0,
            downloadName: defaultFileName,
            savedPath: '',
            savedToDisk: false,
            mimeType: resolvedMime,
            statusMessage: '',
            success: false,
            error: null,
          },
        },
      }));
    }

    if (runningInTauri) {
      setStatusMessage('Preparing save dialog…');
      try {
        // If user selected an output folder, prefill save dialog with that path
        let defaultPath = defaultFileName;
        if (outdir) {
          const sep = outdir.includes('\\') ? '\\' : '/';
          const base = outdir.replace(/[\\/]$/, '');
          defaultPath = `${base}${sep}${defaultFileName}`;
        }
        const savePath = await save({ defaultPath });

        if (!savePath) {
          setStatusMessage('Save cancelled.');
          if (sharedReady) {
            updateSection('loopMaker', (prev) => {
              const prevJob = prev.job || {};
              const summary = {
                ...(prevJob.summary || {}),
                targetSeconds,
                loops: loopsNeeded || 0,
                downloadName: defaultFileName,
                savedPath: '',
                savedToDisk: false,
                mimeType: resolvedMime,
                statusMessage: 'Save cancelled.',
                success: false,
                error: null,
              };
              return {
                activeJobId: null,
                job: {
                  id: localJobId,
                  status: 'cancelled',
                  startedAt: prevJob.id === localJobId ? prevJob.startedAt : startedAt,
                  finishedAt: new Date().toISOString(),
                  summary,
                },
              };
            });
          }
          return;
        }

        setStatusMessage(`Saving to ${savePath}…`);
        const arrayBuffer = await processedBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        await writeBinaryFile(savePath, bytes);
        setStatusMessage(`Saved successfully to ${savePath}`);
        try {
          const jobArgs = [
            `targetSeconds=${targetSeconds}`,
            `loops=${loopsNeeded || 0}`,
            `mimeType=${resolvedMime}`,
          ];
          const jobIdValue = await invoke('record_manual_job', {
            kind: 'loop-maker',
            label: defaultFileName,
            args: jobArgs,
            artifacts: [{ name: defaultFileName, path: savePath }],
            stdout: [`Saved to ${savePath}`],
          });
          setLastJobId(jobIdValue);
          refreshJobs();
          if (sharedReady) {
            const completedAt = new Date().toISOString();
            updateSection('loopMaker', (prev) => {
              const summary = {
                targetSeconds,
                loops: loopsNeeded || 0,
                downloadName: defaultFileName,
                savedPath,
                savedToDisk: true,
                mimeType: resolvedMime,
                statusMessage: `Saved successfully to ${savePath}`,
                success: true,
                error: null,
                completedAt,
                jobRecordId: jobIdValue,
              };
              return {
                activeJobId: null,
                job: {
                  id: jobIdValue,
                  status: 'completed',
                  startedAt: prev.job?.id === localJobId ? prev.job.startedAt : startedAt,
                  finishedAt: completedAt,
                  summary,
                },
                lastSummary: summary,
                lastJobId: jobIdValue,
              };
            });
          }
        } catch (recordErr) {
          console.error('failed to record loop job', recordErr);
        }
      } catch (err) {
        console.error('Save failed', err);
        const message = err instanceof Error ? err.message : String(err);
        setStatusMessage('');
        setErrorMessage(`Save failed: ${message}`);
        if (sharedReady) {
          const completedAt = new Date().toISOString();
          updateSection('loopMaker', (prev) => {
            const prevJob = prev.job || {};
            const summary = {
              ...(prevJob.summary || {}),
              targetSeconds,
              loops: loopsNeeded || 0,
              downloadName: defaultFileName,
              savedPath: '',
              savedToDisk: false,
              mimeType: resolvedMime,
              statusMessage: '',
              success: false,
              error: message,
              completedAt,
            };
            return {
              activeJobId: null,
              job: {
                id: localJobId,
                status: 'error',
                startedAt:
                  prevJob.id === localJobId ? prevJob.startedAt : startedAt,
                finishedAt: completedAt,
                summary,
              },
              lastSummary: summary,
            };
          });
        }
      }

      return;
    }

    setStatusMessage(`Preparing ${extensionLabel} Download…`);
    let tempURL = '';

    try {
      const href = processedURL || URL.createObjectURL(processedBlob);
      if (!processedURL) {
        tempURL = href;
      }

      const link = document.createElement('a');
      link.href = href;
      link.download = defaultFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatusMessage(`${extensionLabel} download started.`);
      try {
        const jobArgs = [
          `targetSeconds=${targetSeconds}`,
          `loops=${loopsNeeded || 0}`,
          `mimeType=${resolvedMime}`,
        ];
        const jobIdValue = await invoke('record_manual_job', {
          kind: 'loop-maker',
          label: defaultFileName,
          args: jobArgs,
          stdout: ['Download started'],
        });
        setLastJobId(jobIdValue);
        refreshJobs();
        if (sharedReady) {
          const completedAt = new Date().toISOString();
          updateSection('loopMaker', (prev) => {
            const summary = {
              targetSeconds,
              loops: loopsNeeded || 0,
              downloadName: defaultFileName,
              savedPath: '',
              savedToDisk: false,
              mimeType: resolvedMime,
              statusMessage: `${extensionLabel} download started.`,
              success: true,
              error: null,
              completedAt,
              jobRecordId: jobIdValue,
            };
            return {
              activeJobId: null,
              job: {
                id: jobIdValue,
                status: 'completed',
                startedAt:
                  prev.job?.id === localJobId ? prev.job.startedAt : startedAt,
                finishedAt: completedAt,
                summary,
              },
              lastSummary: summary,
              lastJobId: jobIdValue,
            };
          });
        }
      } catch (recordErr) {
        console.error('failed to record loop job', recordErr);
      }
    } catch (err) {
      console.error('Download failed', err);
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage('');
      setErrorMessage(`Download failed: ${message}`);
      if (sharedReady) {
        const completedAt = new Date().toISOString();
        updateSection('loopMaker', (prev) => {
          const prevJob = prev.job || {};
          const summary = {
            ...(prevJob.summary || {}),
            targetSeconds,
            loops: loopsNeeded || 0,
            downloadName: defaultFileName,
            savedPath: '',
            savedToDisk: false,
            mimeType: resolvedMime,
            statusMessage: '',
            success: false,
            error: message,
            completedAt,
          };
          return {
            activeJobId: null,
            job: {
              id: localJobId,
              status: 'error',
              startedAt:
                prevJob.id === localJobId ? prevJob.startedAt : startedAt,
              finishedAt: completedAt,
              summary,
            },
            lastSummary: summary,
          };
        });
      }
    } finally {
      if (tempURL) {
        URL.revokeObjectURL(tempURL);
      }
    }
  };

  const handleRenderOrSave = async () => {
    if (runningInTauri) {
      if (!filePath) {
        setErrorMessage('Select a local video file to export.');
        return;
      }
      if (!targetSeconds || targetSeconds <= 0 || !duration) {
        setErrorMessage('Set a valid target length first.');
        return;
      }
      setStatusMessage('Exporting MP4…');
      setErrorMessage('');
      try {
        const outPath = await invoke('export_loop_video', {
          inputPath: filePath,
          targetSeconds: Number(targetSeconds),
          clipSeconds: Number(duration),
          outdir: outdir || undefined,
          outputName: outputName || undefined,
        });
        setStatusMessage(`Saved to ${outPath}`);
        try {
          const jobArgs = [`targetSeconds=${targetSeconds}`];
          const jobIdValue = await invoke('record_manual_job', {
            kind: 'loop-maker',
            label: outputName || (file ? file.name.replace(/\.[^/.]+$/, '') : 'loop'),
            args: jobArgs,
            artifacts: [{ name: outputName || 'loop', path: outPath }],
            stdout: [`Saved to ${outPath}`],
          });
          setLastJobId(jobIdValue);
        } catch {}
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
        setStatusMessage('');
      }
      return;
    }
    // Browser fallback: record playback to MP4-like output
    if (!processedBlob) {
      const loopPlayback = !useConcatenated;
      const totalSeconds = Math.max(0, Number(targetSeconds || 0));
      await startProcessingDownload(videoURL, { totalSeconds, loopPlayback });
      return;
    }
    await handleSaveLoop();
  };

  return (
    <div style={styles.page}>
      <BackButton />
      <h1>Loop Maker</h1>
      <p style={styles.description}>
        Upload a video clip, preview how it loops to reach a target duration, and
        save the rendered result once it&apos;s ready.
      </p>
      {lastJobId && (
        <p style={{ color: '#2563eb', fontWeight: 600 }}>
          Last saved job ID: <strong>{lastJobId}</strong>
        </p>
      )}
      <input type="file" accept="video/*" onChange={handleFileChange} />
      <form style={styles.targetControls} onSubmit={handleTargetSubmit}>
        <label style={styles.targetLabel}>
          Target Length (seconds)
          <input
            type="number"
            min="1"
            step="1"
            value={targetInput}
            onChange={handleTargetInputChange}
            style={styles.targetInput}
          />
        </label>
        <label style={styles.targetLabel}>
          Title
          <input
            type="text"
            placeholder={file ? file.name.replace(/\.[^/.]+$/, '') : 'loop'}
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            style={styles.targetInput}
          />
        </label>
        <button type="submit" style={styles.targetButton}>
          Update
        </button>
      </form>
      {targetError && <div style={styles.targetError}>{targetError}</div>}
      {videoURL && (
        <div style={styles.layout}>
          <div style={styles.frame}>
            <video
              ref={videoRef}
              src={videoURL}
              muted
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              style={styles.video}
            />
          </div>
          <div style={styles.counters}>
            <div style={styles.counterBox}>
              Progress: {Math.floor(elapsed)} / {targetSeconds} seconds
            </div>
            {!useConcatenated && loopsNeeded > 0 && (
              <div style={styles.counterBox}>
                Loops: {loopsCompleted} / {loopsNeeded}
              </div>
            )}
          </div>
          <div style={styles.progressTrack}>
            <div style={styles.progressFill} />
          </div>
          {(useConcatenated || (file && targetSeconds > 0)) && (
            <div style={styles.downloadBar}>
              {runningInTauri && (
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontWeight: 700, color: '#111827' }}>Output Folder</label>
                  <button type="button" onClick={chooseOutdir} style={styles.saveButton}>
                    Choose…
                  </button>
                  {outdir ? (
                    <>
                      <span title={outdir} style={{ color: '#374151', maxWidth: '40ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {outdir}
                      </span>
                      <button type="button" onClick={clearOutdir} style={{ ...styles.saveButton, background: '#e5e7eb' }}>
                        Clear
                      </button>
                    </>
                  ) : (
                    <span style={{ color: '#6b7280' }}>not set</span>
                  )}
                </div>
              )}
              <span style={styles.formatHint}>Output: MP4 (.mp4)</span>
              <button
                type="button"
                onClick={handleRenderOrSave}
                style={{
                  ...styles.saveButton,
                  ...(isRenderingDownload ? styles.saveButtonDisabled : {}),
                }}
                disabled={isRenderingDownload}
              >
                {isRenderingDownload
                  ? preparingDownloadLabel
                  : processedBlob
                  ? actionButtonLabel
                  : `Render Loop${buttonSuffix}`}
              </button>
            </div>
          )}
          {statusMessage && (
            <div style={styles.statusMessage} role="status" aria-live="polite">
              {statusMessage}
            </div>
          )}
      {errorMessage && (
        <div style={styles.errorMessage} role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  )}
      <section style={{ width: '100%', marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
          Completed Jobs
        </h2>
        {completedJobs.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.label || job.args?.[0] || ''}</td>
                    <td>{formatTimestamp(job.created_at || job.createdAt)}</td>
                    <td>{formatTimestamp(job.finished_at || job.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No completed jobs yet.</p>
        )}
      </section>
    </div>
  );
}
