import Icon from './Icon.jsx';

function CountySmithModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  status,
  regionOptions,
  domain,
}) {
  if (!open) return null;

  const stage = status?.stage || 'idle';
  const error = status?.error || '';
  const message = status?.message || '';
  const busy = stage === 'generating' || stage === 'saving';
  const success = stage === 'success';

  const {
    name = '',
    category = '',
    seatOfPower = '',
    capital = '',
    governanceType = '',
    rulingHouse = '',
    population = '',
    allegiance = '',
    targetDir = '',
    notes = '',
    domainId: rawDomainId,
    domainName: rawDomainName,
    primarySpecies = '',
  } = form || {};

  const domainId = rawDomainId || domain?.id || '';
  const domainName = rawDomainName || domain?.name || '';

  const options = Array.isArray(regionOptions) ? regionOptions : [];
  const hasCustomTarget = targetDir && !options.some((option) => option.value === targetDir);
  const saveOptions = hasCustomTarget ? [...options, { value: targetDir, label: targetDir }] : options;

  const canSubmit = !busy && name.trim() && targetDir.trim() && domainId.trim();

  const handleBackdrop = (event) => {
    if (busy) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleInputChange = (key) => (event) => {
    onChange({ [key]: event.target.value });
  };

  return (
    <div className="dnd-modal-backdrop" role="presentation" onClick={handleBackdrop}>
      <div
        className="dnd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="county-smith-title"
      >
        <div className="dnd-modal-header">
          <h2 id="county-smith-title">County Smith</h2>
          <button
            type="button"
            onClick={onClose}
            className="icon"
            aria-label="Close County Smith"
            disabled={busy}
          >
            <Icon name="X" size={18} />
          </button>
        </div>
        <p className="dnd-modal-subtitle">
          Shape a county within the newly forged domain and choose where Blossom should save the dossier.
        </p>
        <form onSubmit={onSubmit} className="dnd-modal-body" style={{ gridTemplateColumns: '1fr' }}>
          <div className="dnd-modal-section">
            <h3>Domain context</h3>
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              Generating counties helps flesh out <strong>{domainName || 'this domain'}</strong>. You can adjust the
              linkage if needed.
            </p>
            <label className="dnd-label">
              <span>Domain name (for flavor)</span>
              <input
                type="text"
                value={domainName}
                onChange={handleInputChange('domainName')}
                placeholder="e.g. Bloodreed Hold"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Domain ID (YAML)</span>
              <input
                type="text"
                value={domainId}
                onChange={handleInputChange('domainId')}
                placeholder="e.g. domain_bloodreed_hold_8b2c"
                required
                disabled={busy}
              />
              <small className="muted">Set this to the parent domain&apos;s id so the template links correctly.</small>
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>Identity</h3>
            <label className="dnd-label">
              <span>County name</span>
              <input
                type="text"
                value={name}
                onChange={handleInputChange('name')}
                placeholder="e.g. Blackfen March"
                autoFocus
                required
                disabled={busy}
              />
              <small className="muted">Becomes the headline and filename.</small>
            </label>
            <label className="dnd-label">
              <span>County descriptors</span>
              <input
                type="text"
                value={category}
                onChange={handleInputChange('category')}
                placeholder="e.g. march, swamp barony"
                disabled={busy}
              />
              <small className="muted">Comma-separated list that will populate the category array.</small>
            </label>
            <label className="dnd-label">
              <span>Primary species (optional)</span>
              <input
                type="text"
                value={primarySpecies}
                onChange={handleInputChange('primarySpecies')}
                placeholder="e.g. humans, dusk elves"
                disabled={busy}
              />
              <small className="muted">Comma-separated values become the YAML primary_species list.</small>
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>Seat & rule</h3>
            <label className="dnd-label">
              <span>Seat of power</span>
              <input
                type="text"
                value={seatOfPower}
                onChange={handleInputChange('seatOfPower')}
                placeholder="e.g. Mireholt Keep"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Capital (if different)</span>
              <input
                type="text"
                value={capital}
                onChange={handleInputChange('capital')}
                placeholder="e.g. Fenwatch"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Ruling house or steward</span>
              <input
                type="text"
                value={rulingHouse}
                onChange={handleInputChange('rulingHouse')}
                placeholder="e.g. House Varyn"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Governance type</span>
              <input
                type="text"
                value={governanceType}
                onChange={handleInputChange('governanceType')}
                placeholder="e.g. hereditary march"
                disabled={busy}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>Scope & storage</h3>
            <label className="dnd-label">
              <span>Population estimate</span>
              <input
                type="text"
                value={population}
                onChange={handleInputChange('population')}
                placeholder="e.g. 45,000"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Allegiance or faction</span>
              <input
                type="text"
                value={allegiance}
                onChange={handleInputChange('allegiance')}
                placeholder="e.g. Loyal to the Witch-Queen"
                disabled={busy}
              />
            </label>
            <label className="dnd-label">
              <span>Save location</span>
              <select
                value={targetDir}
                onChange={handleInputChange('targetDir')}
                disabled={busy}
                required
              >
                <option value="" disabled>
                  Select a folder…
                </option>
                {saveOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="muted">Choose the vault folder where the county file will live.</small>
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>Creative guidance</h3>
            <label className="dnd-label">
              <span>Notes for Blossom (optional)</span>
              <textarea
                value={notes}
                onChange={handleInputChange('notes')}
                placeholder="Tone, threats, hooks you want emphasized…"
                rows={4}
                disabled={busy}
              />
            </label>
          </div>

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
            <button type="submit" disabled={!canSubmit}>
              {busy
                ? stage === 'saving'
                  ? 'Saving…'
                  : 'Generating…'
                : success
                  ? 'Forge Another County'
                  : 'Forge County'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export default CountySmithModal;
