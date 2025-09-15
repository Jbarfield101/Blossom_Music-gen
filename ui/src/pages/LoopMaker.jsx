import { useRef, useState, useEffect } from 'react';
import BackButton from '../components/BackButton.jsx';

const TARGET_SECONDS = 3600;

export default function LoopMaker() {
  const videoRef = useRef(null);
  const [file, setFile] = useState(null);
  const [videoURL, setVideoURL] = useState(null);
  const [duration, setDuration] = useState(0);
  const [loopsNeeded, setLoopsNeeded] = useState(0);
  const [loopsCompleted, setLoopsCompleted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [useConcatenated, setUseConcatenated] = useState(false);

  const progressPercent = TARGET_SECONDS
    ? Math.min((elapsed / TARGET_SECONDS) * 100, 100)
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
  };

  useEffect(() => {
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
    };
  }, [videoURL]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setLoopsCompleted(0);
    setElapsed(0);
    setUseConcatenated(false);
    const url = URL.createObjectURL(f);
    setVideoURL(url);
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
    setDuration(dur);
    if (!useConcatenated && file) {
      const loops = Math.ceil(TARGET_SECONDS / dur);
      setLoopsNeeded(loops);
      const concatUrl = await buildConcatenatedSource(file, loops);
      if (concatUrl) {
        setUseConcatenated(true);
        setVideoURL(concatUrl);
        return; // wait for concatenated video metadata
      }
      videoRef.current.play();
    } else {
      // concatenated video loaded or no file
      setLoopsNeeded(1);
      videoRef.current.play();
    }
  };

  const handleTimeUpdate = (e) => {
    if (useConcatenated) {
      setElapsed(Math.min(e.target.currentTime, TARGET_SECONDS));
    } else {
      const t = loopsCompleted * duration + e.target.currentTime;
      setElapsed(Math.min(t, TARGET_SECONDS));
    }
  };

  const handleEnded = (e) => {
    if (useConcatenated) return;
    const newLoops = loopsCompleted + 1;
    setLoopsCompleted(newLoops);
    const total = newLoops * duration;
    if (total < TARGET_SECONDS) {
      e.target.currentTime = 0;
      e.target.play();
    }
  };

  return (
    <>
      <BackButton />
      <h1>Loop Maker</h1>
      <input type="file" accept="video/*" onChange={handleFileChange} />
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
              Progress: {Math.floor(elapsed)} / {TARGET_SECONDS} seconds
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
