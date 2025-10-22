import Icon from './Icon.jsx';
import DualRangeSlider from './DualRangeSlider.jsx';
import EntityLinkPicker from '../components/EntityLinkPicker.jsx';
import { DOMAIN_CATEGORY_OPTIONS } from '../constants/domainOptions.js';

function DomainSmithModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  status,
  regionOptions,
  npcOptions,
  onForgeCounties,
}) {
  if (!open) return null;

  const stage = status?.stage || 'idle';
  const error = status?.error || '';
  const message = status?.message || '';
  const busy = stage === 'generating' || stage === 'saving';
  const success = stage === 'success';
  const forgedDomain = success && status?.domain ? status.domain : null;
  const canForgeCounties = Boolean(forgedDomain && onForgeCounties);
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
    aliases = [],
    affiliation = [],
    seatOfPower = '',
    primarySpecies = [],
    tags = [],
    keywords = [],
    alignmentOrReputation = [],
    overviewSummary = '',
    canonicalSummary = '',
    embeddingSummary = '',
    playerFacing = [],
    gmSecrets = [],
    refusalRules = [],
    terrainDescription = '',
    climateDescription = '',
    landmarks = [],
    hazards = [],
    resources = [],
    foundingStory = '',
    riseToPower = '',
    majorEvents = [],
    recentHistory = '',
    systemOfRule = '',
    rulingFactions = [],
    lawsAndJustice = [],
    foreignRelations = [],
    counties = [],
    marches = [],
    prefectures = [],
    appearanceAndDress = [],
    festivalsAndHolidays = [],
    religionAndBeliefs = [],
    artsAndEntertainment = [],
    dailyLife = [],
    valuesAndTaboos = [],
    exports = [],
    imports = [],
    currency = '',
    industries = [],
    tradeRoutes = [],
    standingForces = '',
    specialUnits = [],
    fortifications = [],
    tacticsAndStrategies = [],
    capitalSummary = '',
    secondarySettlements = [],
    strongholdsOrSites = [],
    legends = [],
    rumors = [],
    allies = [],
    rivals = [],
    vassals = [],
    foreignTies = [],
    relatedDocs = [],
    mapAsset = '',
    countiesMapAsset = '',
    emblemAsset = '',
    musicCuePrompt = '',
    politicalStability = '',
    politicalProsperity = '',
    politicalUnrest = '',
    lastSeen = '',
    recentEvents = [],
    privacy = '',
  } = form || {};

  const ensureArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      return [trimmed];
    }
    return [];
  };

  const toCommaSeparated = (value) => ensureArray(value).join(', ');

  const parseCommaSeparated = (value) => {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const toMultiline = (value) => {
    if (Array.isArray(value)) return value.join('\n');
    if (typeof value === 'string') return value;
    return '';
  };

  const parseMultiline = (value) => {
    if (!value) return [];
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  };

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

  const createTextHandler = (key) => (event) => {
    onChange({ [key]: event.target.value });
  };

  const createCommaListHandler = (key) => (event) => {
    onChange({ [key]: parseCommaSeparated(event.target.value) });
  };

  const createMultilineHandler = (key) => (event) => {
    onChange({ [key]: parseMultiline(event.target.value) });
  };

  const handleSeatOfPowerChange = createTextHandler('seatOfPower');
  const handleAliasesChange = createCommaListHandler('aliases');
  const handleAffiliationChange = createCommaListHandler('affiliation');
  const handlePrimarySpeciesChange = createCommaListHandler('primarySpecies');
  const handleTagsChange = createCommaListHandler('tags');
  const handleKeywordsChange = createCommaListHandler('keywords');
  const handleAlignmentChange = createCommaListHandler('alignmentOrReputation');
  const handleOverviewSummaryChange = createTextHandler('overviewSummary');
  const handleCanonicalSummaryChange = createTextHandler('canonicalSummary');
  const handleEmbeddingSummaryChange = createTextHandler('embeddingSummary');
  const handlePlayerFacingChange = createMultilineHandler('playerFacing');
  const handleGmSecretsChange = createMultilineHandler('gmSecrets');
  const handleRefusalRulesChange = createMultilineHandler('refusalRules');
  const handleTerrainChange = createTextHandler('terrainDescription');
  const handleClimateChange = createTextHandler('climateDescription');
  const handleLandmarksChange = createMultilineHandler('landmarks');
  const handleHazardsChange = createMultilineHandler('hazards');
  const handleResourcesChange = createMultilineHandler('resources');
  const handleFoundingChange = createTextHandler('foundingStory');
  const handleRiseToPowerChange = createTextHandler('riseToPower');
  const handleMajorEventsChange = createMultilineHandler('majorEvents');
  const handleRecentHistoryChange = createTextHandler('recentHistory');
  const handleSystemOfRuleChange = createTextHandler('systemOfRule');
  const handleRulingFactionsChange = createMultilineHandler('rulingFactions');
  const handleLawsChange = createMultilineHandler('lawsAndJustice');
  const handleForeignRelationsChange = createMultilineHandler('foreignRelations');
  const handleMarchesChange = createMultilineHandler('marches');
  const handlePrefecturesChange = createMultilineHandler('prefectures');
  const handleAppearanceChange = createMultilineHandler('appearanceAndDress');
  const handleFestivalsChange = createMultilineHandler('festivalsAndHolidays');
  const handleReligionChange = createMultilineHandler('religionAndBeliefs');
  const handleArtsChange = createMultilineHandler('artsAndEntertainment');
  const handleDailyLifeChange = createMultilineHandler('dailyLife');
  const handleValuesChange = createMultilineHandler('valuesAndTaboos');
  const handleExportsChange = createMultilineHandler('exports');
  const handleImportsChange = createMultilineHandler('imports');
  const handleCurrencyChange = createTextHandler('currency');
  const handleIndustriesChange = createMultilineHandler('industries');
  const handleTradeRoutesChange = createMultilineHandler('tradeRoutes');
  const handleStandingForcesChange = createTextHandler('standingForces');
  const handleSpecialUnitsChange = createMultilineHandler('specialUnits');
  const handleFortificationsChange = createMultilineHandler('fortifications');
  const handleTacticsChange = createMultilineHandler('tacticsAndStrategies');
  const handleCapitalSummaryChange = createTextHandler('capitalSummary');
  const handleSecondarySettlementsChange = createMultilineHandler('secondarySettlements');
  const handleStrongholdsChange = createMultilineHandler('strongholdsOrSites');
  const handleLegendsChange = createMultilineHandler('legends');
  const handleRumorsChange = createMultilineHandler('rumors');
  const handleAlliesChange = createMultilineHandler('allies');
  const handleRivalsChange = createMultilineHandler('rivals');
  const handleVassalsChange = createMultilineHandler('vassals');
  const handleForeignTiesChange = createMultilineHandler('foreignTies');
  const handleRelatedDocsChange = createMultilineHandler('relatedDocs');
  const handleMapAssetChange = createTextHandler('mapAsset');
  const handleCountiesMapAssetChange = createTextHandler('countiesMapAsset');
  const handleEmblemAssetChange = createTextHandler('emblemAsset');
  const handleMusicCueChange = createTextHandler('musicCuePrompt');
  const handlePoliticalStabilityChange = createTextHandler('politicalStability');
  const handlePoliticalProsperityChange = createTextHandler('politicalProsperity');
  const handlePoliticalUnrestChange = createTextHandler('politicalUnrest');
  const handleLastSeenChange = createTextHandler('lastSeen');
  const handleRecentEventsChange = createMultilineHandler('recentEvents');
  const handlePrivacyChange = createTextHandler('privacy');

  const handleCategoryChange = (event) => {
    onChange({ category: event.target.value });
  };

  const handleCapitalChange = (event) => {
    onChange({ capital: event.target.value });
  };

  const handlePopulationRangeChange = ([nextMinRaw, nextMaxRaw]) => {
    const nextMin = clampNumber(nextMinRaw, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const nextMax = clampNumber(nextMaxRaw, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const safeMin = Math.min(nextMin, nextMax);
    const safeMax = Math.max(nextMin, nextMax);
    onChange({ populationMin: safeMin, populationMax: safeMax });
  };

  const handleRulerChange = (value) => {
    onChange({ rulerId: value || null });
  };

  const handleRegionChange = (event) => {
    onChange({ regionPath: event.target.value });
  };

  const normalizedCounties = Array.isArray(counties) ? counties : [];

  const handleCountyFieldChange = (index, field, value) => {
    const next = normalizedCounties.map((county, idx) => {
      if (idx !== index) return county || {};
      return { ...county, [field]: value };
    });
    onChange({ counties: next });
  };

  const handleAddCounty = () => {
    const next = [
      ...normalizedCounties,
      { id: '', name: '', seatOfPower: '', population: '', allegiance: '', notes: '' },
    ];
    onChange({ counties: next });
  };

  const handleRemoveCounty = (index) => {
    const next = normalizedCounties.filter((_, idx) => idx !== index);
    onChange({ counties: next });
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
          <div className="dnd-modal-section">
            <h3>📘 Basic Information</h3>
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
              <span>Aliases</span>
              <input
                type="text"
                value={toCommaSeparated(aliases)}
                onChange={handleAliasesChange}
                placeholder="comma separated"
                disabled={busy}
              />
              <small className="muted">Enter alternate names separated by commas.</small>
            </label>

            <label className="dnd-label">
              <span>Domain Category (Theme or Sphere)</span>
              <select
                value={category}
                onChange={handleCategoryChange}
                disabled={busy}
              >
                <option value="">Select a domain category</option>
                {DOMAIN_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="muted">
                Choose the domain’s nature —
                {' '}
                {DOMAIN_CATEGORY_OPTIONS.map((option) => option.label).join(', ')}
                .
              </small>
            </label>

            <label className="dnd-label">
              <span>Affiliation</span>
              <input
                type="text"
                value={toCommaSeparated(affiliation)}
                onChange={handleAffiliationChange}
                placeholder="comma separated"
                disabled={busy}
              />
              <small className="muted">Empires, alliances, or patron organizations linked to this domain.</small>
            </label>

            <label className="dnd-label">
              <span>Seat of Power</span>
              <input
                type="text"
                value={seatOfPower}
                onChange={handleSeatOfPowerChange}
                placeholder="e.g. Moonpetal Citadel"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Capital</span>
              <input
                type="text"
                value={capital}
                onChange={handleCapitalChange}
                placeholder="e.g. Moonpetal Citadel"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Population range</span>
              <DualRangeSlider
                className="population-range-slider"
                min={POPULATION_MIN_LIMIT}
                max={POPULATION_MAX_LIMIT}
                step={POPULATION_STEP}
                value={[normalizedPopulationMin, normalizedPopulationMax]}
                onChange={handlePopulationRangeChange}
                disabled={busy}
              />
              <small className="muted">{populationHelperText}</small>
            </label>

            <label className="dnd-label">
              <span>Primary Species</span>
              <input
                type="text"
                value={toCommaSeparated(primarySpecies)}
                onChange={handlePrimarySpeciesChange}
                placeholder="comma separated"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Tags</span>
              <input
                type="text"
                value={toCommaSeparated(tags)}
                onChange={handleTagsChange}
                placeholder="#domain, #province"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Keywords</span>
              <input
                type="text"
                value={toCommaSeparated(keywords)}
                onChange={handleKeywordsChange}
                placeholder="comma separated"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Alignment or Reputation</span>
              <input
                type="text"
                value={toCommaSeparated(alignmentOrReputation)}
                onChange={handleAlignmentChange}
                placeholder="comma separated"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Ruling NPC</span>
              <EntityLinkPicker
                value={rulerId || ''}
                onChange={handleRulerChange}
                entityTypes={['npc']}
                placeholder="Search for an NPC by name or ID…"
                options={npcChoices}
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
          </div>

          <div className="dnd-modal-section">
            <h3>🧭 Overview</h3>
            <label className="dnd-label">
              <span>Overview hook</span>
              <textarea
                value={overviewSummary}
                onChange={handleOverviewSummaryChange}
                placeholder="1–2 sentences introducing the domain."
                disabled={busy}
                rows={2}
              />
            </label>

            <label className="dnd-label">
              <span>Canonical summary</span>
              <textarea
                value={canonicalSummary}
                onChange={handleCanonicalSummaryChange}
                placeholder="A concise canon description."
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Embedding summary</span>
              <textarea
                value={embeddingSummary}
                onChange={handleEmbeddingSummaryChange}
                placeholder="One paragraph for search embeddings."
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Player-facing notes</span>
              <textarea
                value={toMultiline(playerFacing)}
                onChange={handlePlayerFacingChange}
                placeholder="One bullet per line"
                disabled={busy}
                rows={4}
              />
            </label>

            <label className="dnd-label">
              <span>GM secrets</span>
              <textarea
                value={toMultiline(gmSecrets)}
                onChange={handleGmSecretsChange}
                placeholder="One secret per line"
                disabled={busy}
                rows={4}
              />
            </label>

            <label className="dnd-label">
              <span>Refusal rules</span>
              <textarea
                value={toMultiline(refusalRules)}
                onChange={handleRefusalRulesChange}
                placeholder="Guardrails or safety directives, one per line"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🏞️ Geography</h3>
            <label className="dnd-label">
              <span>Terrain description</span>
              <textarea
                value={terrainDescription}
                onChange={handleTerrainChange}
                placeholder="Describe the terrain."
                disabled={busy}
                rows={2}
              />
            </label>

            <label className="dnd-label">
              <span>Climate</span>
              <textarea
                value={climateDescription}
                onChange={handleClimateChange}
                placeholder="Seasonal and weather notes."
                disabled={busy}
                rows={2}
              />
            </label>

            <label className="dnd-label">
              <span>Landmarks</span>
              <textarea
                value={toMultiline(landmarks)}
                onChange={handleLandmarksChange}
                placeholder="One landmark per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Hazards</span>
              <textarea
                value={toMultiline(hazards)}
                onChange={handleHazardsChange}
                placeholder="One hazard per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Resources</span>
              <textarea
                value={toMultiline(resources)}
                onChange={handleResourcesChange}
                placeholder="Notable resources, one per line"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>📜 History</h3>
            <label className="dnd-label">
              <span>Founding story</span>
              <textarea
                value={foundingStory}
                onChange={handleFoundingChange}
                placeholder="Origins and founding myth."
                disabled={busy}
                rows={2}
              />
            </label>

            <label className="dnd-label">
              <span>Rise to power</span>
              <textarea
                value={riseToPower}
                onChange={handleRiseToPowerChange}
                placeholder="How the domain gained influence."
                disabled={busy}
                rows={2}
              />
            </label>

            <label className="dnd-label">
              <span>Major events</span>
              <textarea
                value={toMultiline(majorEvents)}
                onChange={handleMajorEventsChange}
                placeholder="Chronicle key events, one per line"
                disabled={busy}
                rows={4}
              />
            </label>

            <label className="dnd-label">
              <span>Recent history</span>
              <textarea
                value={recentHistory}
                onChange={handleRecentHistoryChange}
                placeholder="What has happened lately?"
                disabled={busy}
                rows={2}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>⚖️ Political Structure</h3>
            <label className="dnd-label">
              <span>System of rule</span>
              <input
                type="text"
                value={systemOfRule}
                onChange={handleSystemOfRuleChange}
                placeholder="Monarchy, council, dominion…"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Ruling factions</span>
              <textarea
                value={toMultiline(rulingFactions)}
                onChange={handleRulingFactionsChange}
                placeholder="Faction names or IDs, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Laws and justice</span>
              <textarea
                value={toMultiline(lawsAndJustice)}
                onChange={handleLawsChange}
                placeholder="Key laws, punishments, courts…"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Foreign relations</span>
              <textarea
                value={toMultiline(foreignRelations)}
                onChange={handleForeignRelationsChange}
                placeholder="Allies, rivals, and diplomatic stances"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🧩 Administrative Divisions</h3>
            <div className="county-list" style={{ display: 'grid', gap: '1rem' }}>
              {normalizedCounties.length === 0 ? (
                <p className="muted">No counties added yet.</p>
              ) : (
                normalizedCounties.map((county, index) => (
                  <div
                    key={`county-${index}`}
                    className="county-card"
                    style={{
                      border: '1px solid var(--border-muted, rgba(255, 255, 255, 0.1))',
                      borderRadius: '12px',
                      padding: '0.75rem',
                      display: 'grid',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      <label className="dnd-label">
                        <span>County ID</span>
                        <input
                          type="text"
                          value={county?.id || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'id', event.target.value)}
                          placeholder="county_slug_hash"
                          disabled={busy}
                        />
                      </label>
                      <label className="dnd-label">
                        <span>County name</span>
                        <input
                          type="text"
                          value={county?.name || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'name', event.target.value)}
                          placeholder="e.g. Dawnward March"
                          disabled={busy}
                        />
                      </label>
                      <label className="dnd-label">
                        <span>Seat of power</span>
                        <input
                          type="text"
                          value={county?.seatOfPower || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'seatOfPower', event.target.value)}
                          placeholder="Chief town or fortress"
                          disabled={busy}
                        />
                      </label>
                      <label className="dnd-label">
                        <span>Population</span>
                        <input
                          type="text"
                          value={county?.population || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'population', event.target.value)}
                          placeholder="Approximate population"
                          disabled={busy}
                        />
                      </label>
                      <label className="dnd-label">
                        <span>Allegiance</span>
                        <input
                          type="text"
                          value={county?.allegiance || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'allegiance', event.target.value)}
                          placeholder="House, faction, or sworn lord"
                          disabled={busy}
                        />
                      </label>
                      <label className="dnd-label">
                        <span>Notes</span>
                        <textarea
                          value={county?.notes || ''}
                          onChange={(event) => handleCountyFieldChange(index, 'notes', event.target.value)}
                          placeholder="One-line hook or key detail"
                          disabled={busy}
                          rows={2}
                        />
                      </label>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleRemoveCounty(index)}
                        disabled={busy}
                      >
                        Remove county
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={handleAddCounty}
              disabled={busy}
              style={{ marginTop: '0.75rem' }}
            >
              Add county
            </button>

            <label className="dnd-label">
              <span>Marches</span>
              <textarea
                value={toMultiline(marches)}
                onChange={handleMarchesChange}
                placeholder="List marches, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Prefectures</span>
              <textarea
                value={toMultiline(prefectures)}
                onChange={handlePrefecturesChange}
                placeholder="List prefectures, one per line"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🎭 Culture &amp; Society</h3>
            <label className="dnd-label">
              <span>Appearance and dress</span>
              <textarea
                value={toMultiline(appearanceAndDress)}
                onChange={handleAppearanceChange}
                placeholder="Describe fashion cues, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Festivals and holidays</span>
              <textarea
                value={toMultiline(festivalsAndHolidays)}
                onChange={handleFestivalsChange}
                placeholder="Seasonal celebrations, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Religion and beliefs</span>
              <textarea
                value={toMultiline(religionAndBeliefs)}
                onChange={handleReligionChange}
                placeholder="Faiths, rituals, or omens"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Arts and entertainment</span>
              <textarea
                value={toMultiline(artsAndEntertainment)}
                onChange={handleArtsChange}
                placeholder="Performances, crafts, or games"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Daily life</span>
              <textarea
                value={toMultiline(dailyLife)}
                onChange={handleDailyLifeChange}
                placeholder="Customs and routines"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Values and taboos</span>
              <textarea
                value={toMultiline(valuesAndTaboos)}
                onChange={handleValuesChange}
                placeholder="Cultural pillars, one per line"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>💰 Economy</h3>
            <label className="dnd-label">
              <span>Exports</span>
              <textarea
                value={toMultiline(exports)}
                onChange={handleExportsChange}
                placeholder="Primary exports, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Imports</span>
              <textarea
                value={toMultiline(imports)}
                onChange={handleImportsChange}
                placeholder="Imports needed to thrive"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Currency</span>
              <input
                type="text"
                value={currency}
                onChange={handleCurrencyChange}
                placeholder="Coinage or barter system"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Industries</span>
              <textarea
                value={toMultiline(industries)}
                onChange={handleIndustriesChange}
                placeholder="Dominant industries, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Trade routes</span>
              <textarea
                value={toMultiline(tradeRoutes)}
                onChange={handleTradeRoutesChange}
                placeholder="Roads, ports, caravans"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🛡️ Military &amp; Defense</h3>
            <label className="dnd-label">
              <span>Standing forces</span>
              <textarea
                value={standingForces}
                onChange={handleStandingForcesChange}
                placeholder="Army size, readiness, command"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Special units</span>
              <textarea
                value={toMultiline(specialUnits)}
                onChange={handleSpecialUnitsChange}
                placeholder="Unique regiments or monsters"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Fortifications</span>
              <textarea
                value={toMultiline(fortifications)}
                onChange={handleFortificationsChange}
                placeholder="Walls, citadels, bastions"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Tactics &amp; strategies</span>
              <textarea
                value={toMultiline(tacticsAndStrategies)}
                onChange={handleTacticsChange}
                placeholder="Battle plans, doctrines, tricks"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🏛️ Notable Locations</h3>
            <label className="dnd-label">
              <span>Capital summary</span>
              <textarea
                value={capitalSummary}
                onChange={handleCapitalSummaryChange}
                placeholder="One paragraph overview"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Secondary settlements</span>
              <textarea
                value={toMultiline(secondarySettlements)}
                onChange={handleSecondarySettlementsChange}
                placeholder="Towns or villages, one per line"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Strongholds or sites</span>
              <textarea
                value={toMultiline(strongholdsOrSites)}
                onChange={handleStrongholdsChange}
                placeholder="Forts, ruins, shrines"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🕯️ Legends &amp; Lore</h3>
            <label className="dnd-label">
              <span>Legends</span>
              <textarea
                value={toMultiline(legends)}
                onChange={handleLegendsChange}
                placeholder="Folktales or myths"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Rumors</span>
              <textarea
                value={toMultiline(rumors)}
                onChange={handleRumorsChange}
                placeholder="Player-facing rumors"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🤝 Relationships</h3>
            <label className="dnd-label">
              <span>Allies</span>
              <textarea
                value={toMultiline(allies)}
                onChange={handleAlliesChange}
                placeholder="Trusted partners"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Rivals</span>
              <textarea
                value={toMultiline(rivals)}
                onChange={handleRivalsChange}
                placeholder="Opposing powers"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Vassals</span>
              <textarea
                value={toMultiline(vassals)}
                onChange={handleVassalsChange}
                placeholder="Sworn vassals or subjects"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Foreign ties</span>
              <textarea
                value={toMultiline(foreignTies)}
                onChange={handleForeignTiesChange}
                placeholder="Treaties or special arrangements"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Related documents</span>
              <textarea
                value={toMultiline(relatedDocs)}
                onChange={handleRelatedDocsChange}
                placeholder="Link NPC, faction, quest IDs"
                disabled={busy}
                rows={3}
              />
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>🖼️ Media &amp; Ambience</h3>
            <label className="dnd-label">
              <span>Map asset</span>
              <input
                type="text"
                value={mapAsset}
                onChange={handleMapAssetChange}
                placeholder="vault://images/domains/<id>.png"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Counties map</span>
              <input
                type="text"
                value={countiesMapAsset}
                onChange={handleCountiesMapAssetChange}
                placeholder="vault://images/domains/<id>_counties.png"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Emblem</span>
              <input
                type="text"
                value={emblemAsset}
                onChange={handleEmblemAssetChange}
                placeholder="vault://images/domains/<id>_emblem.png"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Music cue prompt</span>
              <textarea
                value={musicCuePrompt}
                onChange={handleMusicCueChange}
                placeholder="Prompt for generating ambience music"
                disabled={busy}
                rows={3}
              />
            </label>

            <label className="dnd-label">
              <span>Privacy</span>
              <select value={privacy} onChange={handlePrivacyChange} disabled={busy}>
                <option value="">Select privacy</option>
                <option value="gm">GM only</option>
                <option value="player">Player visible</option>
                <option value="mixed">Mixed / custom</option>
              </select>
            </label>
          </div>

          <div className="dnd-modal-section">
            <h3>⚙️ Campaign State</h3>
            <label className="dnd-label">
              <span>Political stability</span>
              <input
                type="text"
                value={politicalStability}
                onChange={handlePoliticalStabilityChange}
                placeholder="stable, tense, collapsing…"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Political prosperity</span>
              <input
                type="text"
                value={politicalProsperity}
                onChange={handlePoliticalProsperityChange}
                placeholder="poor, balanced, rich…"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Unrest level</span>
              <input
                type="text"
                value={politicalUnrest}
                onChange={handlePoliticalUnrestChange}
                placeholder="low, medium, high…"
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Last seen in session</span>
              <input
                type="date"
                value={lastSeen}
                onChange={handleLastSeenChange}
                disabled={busy}
              />
            </label>

            <label className="dnd-label">
              <span>Recent events</span>
              <textarea
                value={toMultiline(recentEvents)}
                onChange={handleRecentEventsChange}
                placeholder="Session highlights, one per line"
                disabled={busy}
                rows={3}
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

          {canForgeCounties ? (
            <div className="dnd-modal-section" style={{ border: '1px solid var(--accent-border, rgba(45, 202, 140, 0.35))', borderRadius: '12px', padding: '1rem', background: 'var(--accent-bg, rgba(45, 202, 140, 0.06))' }}>
              <h3 style={{ marginTop: 0 }}>Forge this domain&apos;s counties</h3>
              <p style={{ marginBottom: '0.75rem' }}>
                Detail the counties that belong to <strong>{forgedDomain.name}</strong> next.
                You can generate one county at a time using the dedicated template.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => onForgeCounties(forgedDomain)}
                disabled={busy}
              >
                Start forging counties
              </button>
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
