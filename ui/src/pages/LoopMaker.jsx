import { useRef, useState, useEffect } from 'react';
import BackButton from '../components/BackButton.jsx';

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

  const progressPercent = targetSeconds
    ? Math.min((elapsed / targetSeconds) * 100, 100)
    : 0;

  const styles = {
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
  };

  useEffect(() => {
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
    };
  }, [videoURL]);

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

  const resetToBaseVideo = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setUseConcatenated(false);
    setVideoURL(url);
  };

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
  };

  const buildConcatenatedSource = (file, loops) =>
    new Promise((resolve) => {
      if (!('MediaSource' in window)) return resolve(null);
      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      mediaSource.addEventListener('sourceopen', async () => {
        try {
          if (!MediaSource.isTypeSupported(file.type)) {
            alert(
              'This video format is not supported for seamless looping; using basic repeat.'
            );
            resolve(null);
            return;
          }
          const sourceBuffer = mediaSource.addSourceBuffer(file.type);
          const data = await file.arrayBuffer();
          let i = 0;
          const append = () => {
            if (i >= loops) {
              mediaSource.endOfStream();
              resolve(url);
              return;
            }
            sourceBuffer.addEventListener('updateend', append, { once: true });
            sourceBuffer.appendBuffer(data.slice(0));
            i++;
          };
          append();
        } catch (err) {
          console.error('MediaSource error', err);
          resolve(null);
        }
      });
      mediaSource.addEventListener('error', () => resolve(null));
    });

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
        const concatUrl = await buildConcatenatedSource(file, fullLoops);
        if (concatUrl) {
          setUseConcatenated(true);
          setVideoURL(concatUrl);
          return; // wait for concatenated video metadata
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
      return;
    }

    const concatUrl = await buildConcatenatedSource(file, loops);
    if (concatUrl) {
      setUseConcatenated(true);
      setVideoURL(concatUrl);
    } else if (useConcatenated) {
      resetToBaseVideo();
    }
  };

  return (
    <>
      <BackButton />
      <h1>Loop Maker</h1>
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
        </div>
      )}
    </>
  );
}
