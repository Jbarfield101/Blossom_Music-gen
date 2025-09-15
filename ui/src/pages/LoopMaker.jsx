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
        <div>
          <video
            ref={videoRef}
            src={videoURL}
            muted
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
          />
          <p>
            Progress: {Math.floor(elapsed)} / {TARGET_SECONDS} seconds
          </p>
          {!useConcatenated && loopsNeeded > 0 && (
            <p>
              Loops: {loopsCompleted} / {loopsNeeded}
            </p>
          )}
        </div>
      )}
    </>
  );
}
