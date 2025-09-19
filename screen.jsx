export default function Screen({ title = 'Blossom', children, sources }) {
  const videoRef = useRef(null);
  // Default video sources (tries in order until one works)
  const defaultSources = [
    '/assets/video/Happy_Blossom.webm',
    '/assets/video/Happy_Blossom.mp4',
    '/video/Happy_Blossom.webm',
    '/video/Happy_Blossom.mp4',
  ];
  const videoSources = Array.isArray(sources) && sources.length ? sources : defaultSources;
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const tryPlay = async () => {
      try {
        await el.play();
      } catch {}
    };
    const onLoaded = () => tryPlay();
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('canplay', onLoaded, { once: true });
    tryPlay();
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('canplay', onLoaded);
    };
  }, []);
  return (
    <div className="screen" role="region" aria-label={title}>
      <video
import { useEffect, useRef } from 'react';
        ref={videoRef}
        className="screen-video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        {videoSources.map((src) => (
          <source key={src} src={src} type={src.endsWith('.mp4') ? 'video/mp4' : undefined} />
        ))}
      </video>
      <div className="screen-glass" />
      <div className="screen-content">
        {children ?? <h2 className="screen-title">{title}</h2>}
      </div>
    </div>
  );
}
