import Icon from './Icon.jsx';

function DomainSmithModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  status,
  regionOptions,
}) {
  if (!open) return null;

  const stage = status?.stage || 'idle';
  const error = status?.error || '';
  const message = status?.message || '';
  const busy = stage === 'generating' || stage === 'saving';
  const success = stage === 'success';
  const options = Array.isArray(regionOptions) ? regionOptions : [];

  const handleBackdrop = (event) => {
    if (busy) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleNameChange = (event) => {
    onChange({ name: event.target.value });
  };

  const handleFlavorChange = (event) => {
    onChange({ flavor: event.target.value });
  };

  const handleRegionChange = (event) => {
    onChange({ regionPath: event.target.value });
  };

  return (
    <div className="dnd-modal-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className="dnd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="domain-smith-title"
      >
        <div className="dnd-modal-header">
          <h2 id="domain-smith-title">Domain Smith</h2>
          <button
            type="button"
            onClick={onClose}
            className="icon"
            aria-label="Close Domain Smith"
            disabled={busy}
          >
            <Icon name="X" size={18} />
          </button>
        </div>
        <p className="dnd-modal-subtitle">
          Capture the domain&apos;s identity and pick where Blossom should save the finished brief.
        </p>
        <form onSubmit={onSubmit} className="dnd-modal-body" style={{ gridTemplateColumns: '1fr' }}>
          <label className="dnd-label">
            <span>Domain name</span>
            <input
              type="text"
              value={form?.name || ''}
              onChange={handleNameChange}
              placeholder="e.g. Bloodreed Hold"
              autoFocus
              disabled={busy}
              required
            />
            <small className="muted">This becomes the headline and filename.</small>
          </label>

          <label className="dnd-label">
            <span>Flavor prompts &amp; guidance</span>
            <textarea
              value={form?.flavor || ''}
              onChange={handleFlavorChange}
              rows={4}
              placeholder="Tone, conflicts, notable features, or inspirations."
              disabled={busy}
            />
            <small className="muted">Give Blossom a compass for tone, geography, or politics.</small>
          </label>

          <label className="dnd-label">
            <span>Target region folder</span>
            <select
              value={form?.regionPath || ''}
              onChange={handleRegionChange}
              disabled={busy}
              required
            >
              <option value="" disabled>
                Select a region folder…
              </option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="muted">Domain markdown will be saved inside this folder.</small>
          </label>

          {error ? (
            <div className="dnd-modal-error" role="alert">
              {error}
            </div>
          ) : null}
          {message && !error ? (
            <div role="status" style={{ color: 'var(--success, #2dca8c)' }}>
              {message}
            </div>
          ) : null}

          <footer className="dnd-modal-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              {success ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" disabled={busy}>
              {busy
                ? stage === 'saving'
                  ? 'Saving…'
                  : 'Generating…'
                : success
                  ? 'Forge Another Domain'
                  : 'Forge Domain'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export default DomainSmithModal;
