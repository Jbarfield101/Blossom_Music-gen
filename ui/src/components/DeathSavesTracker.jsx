function buildTrack(count) {
  return Array.from({ length: 3 }, (_, index) => index < count);
}

export default function DeathSavesTracker({ successes = 0, failures = 0, onChange }) {
  const handleToggle = (type, index) => {
    const current = type === 'success' ? successes : failures;
    const next = current === index + 1 ? index : index + 1;
    onChange?.(type, next);
  };

  return (
    <div className="dnd-death-saves">
      <div className="dnd-death-saves-column">
        <span className="dnd-death-saves-label">Successes</span>
        <div className="dnd-death-saves-track">
          {buildTrack(successes).map((filled, index) => (
            <button
              key={`success-${index}`}
              type="button"
              className={`dnd-death-saves-dot ${filled ? 'is-filled' : ''}`}
              onClick={() => handleToggle('success', index)}
              aria-label={`Toggle success ${index + 1}`}
            />
          ))}
        </div>
      </div>
      <div className="dnd-death-saves-column">
        <span className="dnd-death-saves-label">Failures</span>
        <div className="dnd-death-saves-track">
          {buildTrack(failures).map((filled, index) => (
            <button
              key={`failure-${index}`}
              type="button"
              className={`dnd-death-saves-dot ${filled ? 'is-filled' : ''}`}
              onClick={() => handleToggle('failure', index)}
              aria-label={`Toggle failure ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
