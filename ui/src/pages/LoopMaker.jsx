import { useRef, useState, useEffect, useCallback } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile as writeBinaryFile } from '@tauri-apps/plugin-fs';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';

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

  const videoRef = useRef(null);
  const [targetSeconds, setTargetSeconds] = useState(3600);
  const [targetInput, setTargetInput] = useState('3600');
  const [targetError, setTargetError] = useState('');
  const [file, setFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
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

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setLoopsCompleted(0);
    setElapsed(0);
    setUseConcatenated(false);
    const url = URL.createObjectURL(f);
    setVideoURL(url);
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

  const selectRecorderMimeType = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=h264,aac',
    ];
    return candidates.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch (err) {
        console.warn('MediaRecorder support check failed', err);
        return false;
      }
    });
  };

  const startProcessingDownload = useCallback(
    async (sourceUrl) => {
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

      setStatusMessage('Rendering downloadable loop… This runs in real time.');
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

        const mimeType = selectRecorderMimeType();
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

        recorder.start();
        hiddenVideo.currentTime = 0;
        await hiddenVideo.play();

        await new Promise((resolve) => {
          hiddenVideo.addEventListener('ended', resolve, { once: true });
        });

        if (processingTokenRef.current !== token) {
          recorder.stop();
          await recorderStopped;
          return;
        }

        recorder.stop();
        await recorderStopped;

        if (processingTokenRef.current !== token) {
          return;
        }

        const blob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || 'video/webm',
        });
        const url = URL.createObjectURL(blob);

        setProcessedBlob(blob);
        setProcessedURL(url);
        setStatusMessage('Loop ready to save. Choose a destination below.');
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
        if (processingTokenRef.current === token) {
          setIsRenderingDownload(false);
        }
      }
    },
    []
  );

  const extensionFromMime = (mime) => {
    if (!mime) return 'webm';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogv';
    return 'webm';
  };

  useEffect(() => {
    if (useConcatenated && videoURL) {
      startProcessingDownload(videoURL);
    } else if (!useConcatenated) {
      cleanupProcessed();
    }
  }, [cleanupProcessed, startProcessingDownload, useConcatenated, videoURL]);

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
      setStatusMessage(
        'Downloads become available once the target is an exact multiple of the clip length.'
      );
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

    const baseName = file
      ? `${file.name.replace(/\.[^/.]+$/, '') || 'looped-video'}`
      : 'looped-video';
    const mime = processedBlob.type;
    const extension = extensionFromMime(mime);
    const defaultFileName = `${baseName}-loop.${extension}`;

    setErrorMessage('');

    if (runningInTauri) {
      setStatusMessage('Preparing save dialog…');
      try {
        const savePath = await save({ defaultPath: defaultFileName });

        if (!savePath) {
          setStatusMessage('Save cancelled.');
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
        } catch (recordErr) {
          console.error('failed to record loop job', recordErr);
        }
      } catch (err) {
        console.error('Save failed', err);
        const message = err instanceof Error ? err.message : String(err);
        setStatusMessage('');
        setErrorMessage(`Save failed: ${message}`);
      }

      return;
    }

    setStatusMessage('Preparing download…');
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
      setStatusMessage('Download started.');
      try {
        const jobArgs = [
          `targetSeconds=${targetSeconds}`,
          `loops=${loopsNeeded || 0}`,
        ];
        const jobIdValue = await invoke('record_manual_job', {
          kind: 'loop-maker',
          label: defaultFileName,
          args: jobArgs,
          stdout: ['Download started'],
        });
        setLastJobId(jobIdValue);
        refreshJobs();
      } catch (recordErr) {
        console.error('failed to record loop job', recordErr);
      }
    } catch (err) {
      console.error('Download failed', err);
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage('');
      setErrorMessage(`Download failed: ${message}`);
    } finally {
      if (tempURL) {
        URL.revokeObjectURL(tempURL);
      }
    }
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
          {useConcatenated && (
            <div style={styles.downloadBar}>
              <button
                type="button"
                onClick={handleSaveLoop}
                style={{
                  ...styles.saveButton,
                  ...(!processedBlob || isRenderingDownload
                    ? styles.saveButtonDisabled
                    : {}),
                }}
                disabled={!processedBlob || isRenderingDownload}
              >
                {isRenderingDownload
                  ? 'Preparing Download…'
                  : runningInTauri
                  ? 'Save Loop'
                  : 'Download Loop'}
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
