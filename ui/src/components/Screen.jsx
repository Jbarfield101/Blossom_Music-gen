export default function Screen({ title = 'Blossom', children, sources }) {
  // Default video sources (tries in order until one works)
  const defaultSources = [
    '/assets/video/Happy_Blossom.webm',
    '/assets/video/Happy_Blossom.mp4',
    '/video/Happy_Blossom.webm',
    '/video/Happy_Blossom.mp4',
  ];
  const videoSources = Array.isArray(sources) && sources.length ? sources : defaultSources;
  return (
    <div className="screen" role="region" aria-label={title}>
      <video
        className="screen-video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        {videoSources.map((src) => (
          <source key={src} src={src} />
        ))}
      </video>
      <div className="screen-glass" />
      <div className="screen-content">
        {children ?? <h2 className="screen-title">{title}</h2>}
      </div>
    </div>
  );
}
