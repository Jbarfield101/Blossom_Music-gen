import Icon from './Icon.jsx';
import EntityLinkPicker from '../components/EntityLinkPicker.jsx';

function DomainSmithModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  status,
  regionOptions,
  npcOptions,
}) {
  if (!open) return null;

  const stage = status?.stage || 'idle';
  const error = status?.error || '';
  const message = status?.message || '';
  const busy = stage === 'generating' || stage === 'saving';
  const success = stage === 'success';
  const options = Array.isArray(regionOptions) ? regionOptions : [];
  const npcChoices = Array.isArray(npcOptions) ? npcOptions : [];

  const {
    name = '',
    category = '',
    capital = '',
    populationMin: rawPopulationMin,
    populationMax: rawPopulationMax,
    rulerId = null,
    regionPath = '',
  } = form || {};

  const clampNumber = (value, minimum, maximum) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return minimum;
    if (num < minimum) return minimum;
    if (num > maximum) return maximum;
    return num;
  };

  const POPULATION_MIN_LIMIT = 0;
  const POPULATION_MAX_LIMIT = 1000000;
  const POPULATION_STEP = 1000;

  const normalizedPopulationMin = clampNumber(
    rawPopulationMin,
    POPULATION_MIN_LIMIT,
    POPULATION_MAX_LIMIT,
  );
  const normalizedPopulationMax = Math.max(
    normalizedPopulationMin,
    clampNumber(rawPopulationMax, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT),
  );

  const handleBackdrop = (event) => {
    if (busy) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleNameChange = (event) => {
    onChange({ name: event.target.value });
  };

  const handleCategoryChange = (event) => {
    onChange({ category: event.target.value });
  };

  const handleCapitalChange = (event) => {
    onChange({ capital: event.target.value });
  };

  const handlePopulationMinChange = (event) => {
    const nextMin = clampNumber(event.target.value, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const nextMax = Math.max(
      nextMin,
      clampNumber(rawPopulationMax, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT),
    );
    onChange({ populationMin: nextMin, populationMax: nextMax });
  };

  const handlePopulationMaxChange = (event) => {
    const nextMax = clampNumber(event.target.value, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const nextMin = Math.min(
      clampNumber(rawPopulationMin, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT),
      nextMax,
    );
    onChange({ populationMin: nextMin, populationMax: nextMax });
  };

  const handleRulerChange = (value) => {
    onChange({ rulerId: value || null });
  };

  const handleRegionChange = (event) => {
    onChange({ regionPath: event.target.value });
  };

  const formatPopulation = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return num.toLocaleString();
  };

  const sampleRulers = npcChoices
    .map((choice) => choice?.label || choice?.name || '')
    .filter(Boolean)
    .slice(0, 3);

  const rulerHelperText = sampleRulers.length > 0
    ? `Recent rulers: ${sampleRulers.join(', ')}`
    : 'Link an existing NPC to anchor this domain.';

  const populationHelperText =
    normalizedPopulationMin !== 0 || normalizedPopulationMax !== 0
      ? `Estimated population between ${formatPopulation(normalizedPopulationMin)} and ${formatPopulation(normalizedPopulationMax)} citizens.`
      : 'Set the sliders to choose an estimated population (0 – 1,000,000 citizens).';

  const canSubmit = !busy && name.trim() && regionPath.trim();

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
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Bloodreed Hold"
              autoFocus
              disabled={busy}
              required
            />
            <small className="muted">This becomes the headline and filename.</small>
          </label>

          <label className="dnd-label">
            <span>Domain Category (Theme or Sphere)</span>
            <input
              type="text"
              value={category}
              onChange={handleCategoryChange}
              placeholder="e.g. Twilight, Tempest, or Harvest"
              disabled={busy}
            />
            <small className="muted">Describe the domain’s nature — Twilight, Tempest, Harvest, etc.</small>
          </label>

          <label className="dnd-label">
            <span>Primary Seat of Power (optional)</span>
            <input
              type="text"
              value={capital}
              onChange={handleCapitalChange}
              placeholder="e.g. Moonpetal Citadel"
              disabled={busy}
            />
            <small className="muted">Optional: describe the primary seat anchoring this domain.</small>
          </label>

          <label className="dnd-label">
            <span>Population range</span>
            <div className="population-range-inputs">
              <input
                type="range"
                min={POPULATION_MIN_LIMIT}
                max={POPULATION_MAX_LIMIT}
                step={POPULATION_STEP}
                value={normalizedPopulationMin}
                onChange={handlePopulationMinChange}
                disabled={busy}
              />
              <input
                type="range"
                min={POPULATION_MIN_LIMIT}
                max={POPULATION_MAX_LIMIT}
                step={POPULATION_STEP}
                value={normalizedPopulationMax}
                onChange={handlePopulationMaxChange}
                disabled={busy}
              />
            </div>
            <small className="muted">{populationHelperText}</small>
          </label>

          <label className="dnd-label">
            <span>Ruling NPC</span>
            <EntityLinkPicker
              value={rulerId || ''}
              onChange={handleRulerChange}
              entityTypes={['npc']}
              placeholder="Search for an NPC by name or ID…"
              disabled={busy}
              helperText={rulerHelperText}
            />
          </label>

          <label className="dnd-label">
            <span>Save Location</span>
            <select
              value={regionPath}
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
            <small className="muted">Select which regional folder this domain file will be stored in.</small>
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
            <button type="submit" disabled={!canSubmit}>
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
