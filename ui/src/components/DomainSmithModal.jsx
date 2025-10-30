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
  const errorCode = status?.errorCode || '';
  const rawDetails = status?.details;
  const busy = stage === 'generating' || stage === 'saving';
  const success = stage === 'success';
  const forgedDomain = success && status?.domain ? status.domain : null;
  const canForgeCounties = Boolean(forgedDomain && onForgeCounties);
  const options = Array.isArray(regionOptions) ? regionOptions : [];
  const npcChoices = Array.isArray(npcOptions) ? npcOptions : [];

  const formatErrorDetails = (value) => {
    if (value == null) return '';
    if (typeof value === 'string') {
      return value.trim();
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const formattedError = (() => {
    if (errorCode && error) return `Error ${errorCode}: ${error}`;
    if (errorCode) return `Error ${errorCode}`;
    return error;
  })();

  const errorDetails = formatErrorDetails(rawDetails);

  const {
    name = '',
    category = '',
    capital = '',
    population: rawPopulationValue,
    population_range: rawPopulationRange,
    populationRange: camelPopulationRange,
    rulerId = null,
    regionPath = '',
    aliases = [],
    affiliation = [],
    tags = [],
    keywords = [],
    alignmentOrReputation = [],
    overviewSummary = '',
    canonicalSummary = '',
    embeddingSummary = '',
    playerFacing = [],
    gmSecrets = [],
    refusalRules = [],
    legends = [],
    rumors = [],
    relatedDocs = [],
    musicCuePrompt = '',
    privacy = '',
  } = form || {};

  const geographySection = form?.geography && typeof form.geography === 'object' ? form.geography : {};
  const terrainDescription = typeof geographySection.terrain === 'string' ? geographySection.terrain : '';
  const climateDescription = typeof geographySection.climate === 'string' ? geographySection.climate : '';
  const landmarks = Array.isArray(geographySection.landmarks) ? geographySection.landmarks : [];
  const hazards = Array.isArray(geographySection.hazards) ? geographySection.hazards : [];
  const resources = Array.isArray(geographySection.resources) ? geographySection.resources : [];

  const historySection = form?.history && typeof form.history === 'object' ? form.history : {};
  const foundingStory = typeof historySection.founding === 'string' ? historySection.founding : '';
  const riseToPower = typeof historySection.rise_to_power === 'string' ? historySection.rise_to_power : '';
  const majorEvents = Array.isArray(historySection.major_events) ? historySection.major_events : [];
  const recentHistory = typeof historySection.recent_history === 'string' ? historySection.recent_history : '';

  const politicsSection = form?.politics && typeof form.politics === 'object' ? form.politics : {};
  const systemOfRule = typeof politicsSection.system_of_rule === 'string' ? politicsSection.system_of_rule : '';
  const rulingFactions = Array.isArray(politicsSection.ruling_factions) ? politicsSection.ruling_factions : [];
  const lawsAndJustice = Array.isArray(politicsSection.laws_and_justice) ? politicsSection.laws_and_justice : [];
  const foreignRelations = Array.isArray(politicsSection.foreign_relations) ? politicsSection.foreign_relations : [];

  const administrativeDivisionsSection =
    form?.administrative_divisions && typeof form.administrative_divisions === 'object'
      ? form.administrative_divisions
      : {};
  const counties = Array.isArray(administrativeDivisionsSection.counties)
    ? administrativeDivisionsSection.counties
    : [];
  const marches = Array.isArray(administrativeDivisionsSection.marches)
    ? administrativeDivisionsSection.marches
    : [];
  const prefectures = Array.isArray(administrativeDivisionsSection.prefectures)
    ? administrativeDivisionsSection.prefectures
    : [];

  const cultureSection = form?.culture && typeof form.culture === 'object' ? form.culture : {};
  const appearanceAndDress = Array.isArray(cultureSection.appearance_and_dress) ? cultureSection.appearance_and_dress : [];
  const festivalsAndHolidays = Array.isArray(cultureSection.festivals_and_holidays)
    ? cultureSection.festivals_and_holidays
    : [];
  const religionAndBeliefs = Array.isArray(cultureSection.religion_and_beliefs)
    ? cultureSection.religion_and_beliefs
    : [];
  const artsAndEntertainment = Array.isArray(cultureSection.arts_and_entertainment)
    ? cultureSection.arts_and_entertainment
    : [];
  const dailyLife = Array.isArray(cultureSection.daily_life) ? cultureSection.daily_life : [];
  const valuesAndTaboos = Array.isArray(cultureSection.values_and_taboos) ? cultureSection.values_and_taboos : [];

  const economySection = form?.economy && typeof form.economy === 'object' ? form.economy : {};
  const exports = Array.isArray(economySection.exports) ? economySection.exports : [];
  const imports = Array.isArray(economySection.imports) ? economySection.imports : [];
  const currency = typeof economySection.currency === 'string' ? economySection.currency : '';
  const industries = Array.isArray(economySection.industries) ? economySection.industries : [];
  const tradeRoutes = Array.isArray(economySection.trade_routes) ? economySection.trade_routes : [];

  const militarySection = form?.military && typeof form.military === 'object' ? form.military : {};
  const standingForces = typeof militarySection.standing_forces === 'string' ? militarySection.standing_forces : '';
  const specialUnits = Array.isArray(militarySection.special_units) ? militarySection.special_units : [];
  const fortifications = Array.isArray(militarySection.fortifications) ? militarySection.fortifications : [];
  const tacticsAndStrategies = Array.isArray(militarySection.tactics_and_strategies)
    ? militarySection.tactics_and_strategies
    : [];

  const locationsSection = form?.locations && typeof form.locations === 'object' ? form.locations : {};
  const capitalSummary = typeof locationsSection.capital_summary === 'string' ? locationsSection.capital_summary : '';
  const secondarySettlements = Array.isArray(locationsSection.secondary_settlements)
    ? locationsSection.secondary_settlements
    : [];
  const strongholdsOrSites = Array.isArray(locationsSection.strongholds_or_sites)
    ? locationsSection.strongholds_or_sites
    : [];

  const relationshipsSection = form?.relationships && typeof form.relationships === 'object' ? form.relationships : {};
  const allies = Array.isArray(relationshipsSection.allies) ? relationshipsSection.allies : [];
  const rivals = Array.isArray(relationshipsSection.rivals) ? relationshipsSection.rivals : [];
  const vassals = Array.isArray(relationshipsSection.vassals) ? relationshipsSection.vassals : [];
  const foreignTies = Array.isArray(relationshipsSection.foreign_ties) ? relationshipsSection.foreign_ties : [];

  const politicalStateSection =
    form?.political_state && typeof form.political_state === 'object' ? form.political_state : {};
  const politicalStability = typeof politicalStateSection.stability === 'string' ? politicalStateSection.stability : '';
  const politicalProsperity = typeof politicalStateSection.prosperity === 'string' ? politicalStateSection.prosperity : '';
  const politicalUnrest = typeof politicalStateSection.unrest_level === 'string' ? politicalStateSection.unrest_level : '';

  const sessionStateSection = form?.session_state && typeof form.session_state === 'object' ? form.session_state : {};
  const lastSeen = typeof sessionStateSection.last_seen === 'string' ? sessionStateSection.last_seen : '';
  const recentEvents = Array.isArray(sessionStateSection.recent_events) ? sessionStateSection.recent_events : [];

  const artSection = form?.art && typeof form.art === 'object' ? form.art : {};
  const mapAsset = typeof artSection.map === 'string' ? artSection.map : '';
  const countiesMapAsset = typeof artSection.counties_map === 'string' ? artSection.counties_map : '';
  const emblemAsset = typeof artSection.emblem === 'string' ? artSection.emblem : '';

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

  const normalizePopulationNumber = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return clampNumber(num, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
  };

  const normalizedPopulationValue = normalizePopulationNumber(rawPopulationValue);

  const normalizedPopulationRange = (() => {
    const candidate = camelPopulationRange && typeof camelPopulationRange === 'object'
      ? camelPopulationRange
      : rawPopulationRange && typeof rawPopulationRange === 'object'
        ? rawPopulationRange
        : null;
    if (!candidate) return null;
    const minValue = normalizePopulationNumber(candidate.min);
    const maxValue = normalizePopulationNumber(candidate.max);
    if (minValue == null && maxValue == null) return null;
    const fallback = minValue ?? maxValue;
    if (fallback == null) return null;
    const safeMin = minValue ?? fallback;
    const safeMax = maxValue ?? fallback;
    return {
      min: Math.min(safeMin, safeMax),
      max: Math.max(safeMin, safeMax),
    };
  })();

  const sliderBaseMin = normalizedPopulationRange?.min ?? normalizedPopulationValue ?? POPULATION_MIN_LIMIT;
  const sliderBaseMax = normalizedPopulationRange?.max ?? normalizedPopulationValue ?? POPULATION_MIN_LIMIT;
  const normalizedSliderMin = normalizePopulationNumber(sliderBaseMin) ?? POPULATION_MIN_LIMIT;
  const normalizedSliderMax = normalizePopulationNumber(sliderBaseMax) ?? POPULATION_MIN_LIMIT;
  const sliderMinValue = Math.min(normalizedSliderMin, normalizedSliderMax);
  const sliderMaxValue = Math.max(normalizedSliderMin, normalizedSliderMax);
  const hasPopulationSelection = normalizedPopulationValue != null || normalizedPopulationRange != null;
  const resolvedPopulationValue = normalizedPopulationValue != null
    ? normalizedPopulationValue
    : hasPopulationSelection
      ? Math.round((sliderMinValue + sliderMaxValue) / 2)
      : null;

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

  const createSectionTextHandler = (section, field) => (event) => {
    onChange({ [section]: { [field]: event.target.value } });
  };

  const createSectionMultilineHandler = (section, field) => (event) => {
    onChange({ [section]: { [field]: parseMultiline(event.target.value) } });
  };

  const handleAliasesChange = createCommaListHandler('aliases');
  const handleAffiliationChange = createCommaListHandler('affiliation');
  const handleTagsChange = createCommaListHandler('tags');
  const handleKeywordsChange = createCommaListHandler('keywords');
  const handleAlignmentChange = createCommaListHandler('alignmentOrReputation');
  const handleOverviewSummaryChange = createTextHandler('overviewSummary');
  const handleCanonicalSummaryChange = createTextHandler('canonicalSummary');
  const handleEmbeddingSummaryChange = createTextHandler('embeddingSummary');
  const handlePlayerFacingChange = createMultilineHandler('playerFacing');
  const handleGmSecretsChange = createMultilineHandler('gmSecrets');
  const handleRefusalRulesChange = createMultilineHandler('refusalRules');
  const handleTerrainChange = createSectionTextHandler('geography', 'terrain');
  const handleClimateChange = createSectionTextHandler('geography', 'climate');
  const handleLandmarksChange = createSectionMultilineHandler('geography', 'landmarks');
  const handleHazardsChange = createSectionMultilineHandler('geography', 'hazards');
  const handleResourcesChange = createSectionMultilineHandler('geography', 'resources');
  const handleFoundingChange = createSectionTextHandler('history', 'founding');
  const handleRiseToPowerChange = createSectionTextHandler('history', 'rise_to_power');
  const handleMajorEventsChange = createSectionMultilineHandler('history', 'major_events');
  const handleRecentHistoryChange = createSectionTextHandler('history', 'recent_history');
  const handleSystemOfRuleChange = createSectionTextHandler('politics', 'system_of_rule');
  const handleRulingFactionsChange = createSectionMultilineHandler('politics', 'ruling_factions');
  const handleLawsChange = createSectionMultilineHandler('politics', 'laws_and_justice');
  const handleForeignRelationsChange = createSectionMultilineHandler('politics', 'foreign_relations');
  const handleMarchesChange = createSectionMultilineHandler('administrativeDivisions', 'marches');
  const handlePrefecturesChange = createSectionMultilineHandler('administrativeDivisions', 'prefectures');
  const handleAppearanceChange = createSectionMultilineHandler('culture', 'appearance_and_dress');
  const handleFestivalsChange = createSectionMultilineHandler('culture', 'festivals_and_holidays');
  const handleReligionChange = createSectionMultilineHandler('culture', 'religion_and_beliefs');
  const handleArtsChange = createSectionMultilineHandler('culture', 'arts_and_entertainment');
  const handleDailyLifeChange = createSectionMultilineHandler('culture', 'daily_life');
  const handleValuesChange = createSectionMultilineHandler('culture', 'values_and_taboos');
  const handleExportsChange = createSectionMultilineHandler('economy', 'exports');
  const handleImportsChange = createSectionMultilineHandler('economy', 'imports');
  const handleCurrencyChange = createSectionTextHandler('economy', 'currency');
  const handleIndustriesChange = createSectionMultilineHandler('economy', 'industries');
  const handleTradeRoutesChange = createSectionMultilineHandler('economy', 'trade_routes');
  const handleStandingForcesChange = createSectionTextHandler('military', 'standing_forces');
  const handleSpecialUnitsChange = createSectionMultilineHandler('military', 'special_units');
  const handleFortificationsChange = createSectionMultilineHandler('military', 'fortifications');
  const handleTacticsChange = createSectionMultilineHandler('military', 'tactics_and_strategies');
  const handleCapitalSummaryChange = createSectionTextHandler('locations', 'capital_summary');
  const handleSecondarySettlementsChange = createSectionMultilineHandler('locations', 'secondary_settlements');
  const handleStrongholdsChange = createSectionMultilineHandler('locations', 'strongholds_or_sites');
  const handleLegendsChange = createMultilineHandler('legends');
  const handleRumorsChange = createMultilineHandler('rumors');
  const handleAlliesChange = createSectionMultilineHandler('relationships', 'allies');
  const handleRivalsChange = createSectionMultilineHandler('relationships', 'rivals');
  const handleVassalsChange = createSectionMultilineHandler('relationships', 'vassals');
  const handleForeignTiesChange = createSectionMultilineHandler('relationships', 'foreign_ties');
  const handleRelatedDocsChange = createMultilineHandler('relatedDocs');
  const handleMapAssetChange = createSectionTextHandler('art', 'map');
  const handleCountiesMapAssetChange = createSectionTextHandler('art', 'counties_map');
  const handleEmblemAssetChange = createSectionTextHandler('art', 'emblem');
  const handleMusicCueChange = createTextHandler('musicCuePrompt');
  const handlePoliticalStabilityChange = createSectionTextHandler('politicalState', 'stability');
  const handlePoliticalProsperityChange = createSectionTextHandler('politicalState', 'prosperity');
  const handlePoliticalUnrestChange = createSectionTextHandler('politicalState', 'unrest_level');
  const handleLastSeenChange = createSectionTextHandler('sessionState', 'last_seen');
  const handleRecentEventsChange = createSectionMultilineHandler('sessionState', 'recent_events');
  const handlePrivacyChange = createTextHandler('privacy');

  const handleCategoryChange = (event) => {
    onChange({ category: event.target.value });
  };

  const handleCapitalChange = (event) => {
    const { value } = event.target;
    onChange({ capital: value, seatOfPower: value });
  };

  const handlePopulationRangeChange = ([nextMinRaw, nextMaxRaw]) => {
    const nextMin = clampNumber(nextMinRaw, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const nextMax = clampNumber(nextMaxRaw, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT);
    const safeMin = Math.min(nextMin, nextMax);
    const safeMax = Math.max(nextMin, nextMax);
    const resolvedValue = Math.round((safeMin + safeMax) / 2);
    onChange({
      population: clampNumber(resolvedValue, POPULATION_MIN_LIMIT, POPULATION_MAX_LIMIT),
      populationRange: { min: safeMin, max: safeMax },
    });
  };

  const handleRulerChange = (value) => {
    onChange({ rulerId: value || null });
  };

  const handleRegionChange = (event) => {
    onChange({ regionPath: event.target.value });
  };

  const normalizedCounties = Array.isArray(counties) ? counties : [];

  const demographicsSource = Array.isArray(form?.populationDemographics)
    ? form.populationDemographics
    : Array.isArray(form?.population_demographics)
      ? form.population_demographics
      : [];

  const clampShare = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
  };

  const getOtherIndex = (list) => list.findIndex(
    (entry) => String(entry?.group ?? '').trim().toLowerCase() === 'other',
  );

  const rebalanceDemographicList = (list) => {
    const sanitized = list.map((entry) => ({
      group: typeof entry?.group === 'string' ? entry.group : String(entry?.group ?? ''),
      share: clampShare(entry?.share),
    }));
    const otherIdx = getOtherIndex(sanitized);
    if (otherIdx !== -1) {
      const totalNonOther = sanitized.reduce((sum, entry, idx) => (
        idx === otherIdx ? sum : sum + clampShare(entry.share)
      ), 0);
      const remainder = clampShare(100 - totalNonOther);
      sanitized[otherIdx] = {
        ...sanitized[otherIdx],
        group: sanitized[otherIdx].group || 'Other',
        share: remainder,
      };
    }
    return sanitized;
  };

  const seededDemographics = (
    Array.isArray(demographicsSource) && demographicsSource.length
      ? demographicsSource
      : [{ group: 'Other', share: 100 }]
  ).map((entry) => ({
    group: typeof entry?.group === 'string' ? entry.group : String(entry?.group ?? ''),
    share: clampShare(entry?.share),
  }));

  const resolvedDemographics = rebalanceDemographicList(seededDemographics);
  const otherIndex = getOtherIndex(resolvedDemographics);
  const hasAutoOther = otherIndex !== -1;
  const otherShare = hasAutoOther ? resolvedDemographics[otherIndex].share : 0;

  const groupsHaveNames = resolvedDemographics.every((entry) => entry.group.trim());
  const demographicsTotal = resolvedDemographics.reduce((sum, entry) => sum + clampShare(entry.share), 0);
  const demographicsTotalRounded = Math.round(demographicsTotal * 10) / 10;
  const demographicsTotalValid = Math.abs(demographicsTotal - 100) <= 0.5;
  const demographicsValid = groupsHaveNames && demographicsTotalValid;

  let demographicsStatusMessage = '';
  if (!groupsHaveNames) {
    demographicsStatusMessage = 'Every group needs a name.';
  } else if (!demographicsTotalValid) {
    demographicsStatusMessage = `Current total: ${demographicsTotalRounded.toFixed(1)}%. Adjust to reach 100%.`;
  } else if (hasAutoOther) {
    demographicsStatusMessage = resolvedDemographics.length === 1
      ? 'Other starts at 100%. Add a group to split the population.'
      : `Other automatically tracks the remaining share (${otherShare}%).`;
  } else {
    demographicsStatusMessage = `Current total: ${demographicsTotalRounded.toFixed(1)}%.`;
  }
  const demographicsStatusColor = demographicsValid
    ? 'rgba(226, 232, 240, 0.75)'
    : 'rgba(248, 113, 113, 0.9)';

  const updateDemographics = (mutator) => {
    const draft = resolvedDemographics.map((entry) => ({ ...entry }));
    const mutated = mutator ? mutator(draft) || draft : draft;
    let normalized = mutated
      .map((entry) => ({
        group: typeof entry?.group === 'string' ? entry.group : String(entry?.group ?? ''),
        share: Number.isFinite(entry?.share) ? entry.share : clampShare(entry?.share),
      }));

    if (!normalized.length) {
      normalized = [{ group: 'Other', share: 100 }];
    }

    normalized = rebalanceDemographicList(normalized);

    onChange({
      populationDemographics: normalized.map((entry) => ({
        group: entry.group,
        share: entry.share,
      })),
    });
  };

  const handleDemographicGroupChange = (index, value) => {
    updateDemographics((entries) => {
      const next = entries.map((entry) => ({ ...entry }));
      if (!next[index]) {
        next[index] = { group: '', share: 0 };
      }
      next[index] = { ...next[index], group: value };
      return next;
    });
  };

  const handleDemographicShareChange = (index, rawValue) => {
    updateDemographics((entries) => {
      const next = entries.map((entry) => ({ ...entry }));
      const otherIdx = getOtherIndex(next);
      const desired = clampShare(rawValue);

      if (otherIdx !== -1 && index !== otherIdx) {
        const totalOfOthers = next.reduce((sum, entry, idx) => {
          if (idx === index || idx === otherIdx) return sum;
          return sum + clampShare(entry.share);
        }, 0);
        const maxShare = Math.max(0, 100 - totalOfOthers);
        next[index].share = Math.min(desired, maxShare);
      } else if (otherIdx === -1) {
        const othersTotal = next.reduce((sum, entry, idx) => (
          idx === index ? sum : sum + clampShare(entry.share)
        ), 0);
        const maxShare = Math.max(0, 100 - othersTotal);
        next[index].share = Math.min(desired, maxShare);
      } else {
        next[index].share = desired;
      }

      return next;
    });
  };

  const handleAddDemographic = () => {
    updateDemographics((entries) => [...entries, { group: '', share: 0 }]);
  };

  const handleRemoveDemographic = (index) => {
    updateDemographics((entries) => {
      const next = entries.filter((_, idx) => idx !== index);
      if (!next.length) {
        return [{ group: 'Other', share: 100 }];
      }
      return next;
    });
  };

  const handleCountyFieldChange = (index, field, value) => {
    const next = normalizedCounties.map((county, idx) => {
      if (idx !== index) return county || {};
      return { ...county, [field]: value };
    });
    onChange({ administrativeDivisions: { counties: next } });
  };

  const handleAddCounty = () => {
    const next = [
      ...normalizedCounties,
      { id: '', name: '', seatOfPower: '', population: '', allegiance: '', notes: '' },
    ];
    onChange({ administrativeDivisions: { counties: next } });
  };

  const handleRemoveCounty = (index) => {
    const next = normalizedCounties.filter((_, idx) => idx !== index);
    onChange({ administrativeDivisions: { counties: next } });
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

  const populationHelperText = resolvedPopulationValue != null
    ? normalizedPopulationRange && normalizedPopulationRange.min !== normalizedPopulationRange.max
      ? `Estimated population around ${formatPopulation(resolvedPopulationValue)} citizens (${formatPopulation(sliderMinValue)} – ${formatPopulation(sliderMaxValue)}).`
      : `Estimated population around ${formatPopulation(resolvedPopulationValue)} citizens.`
    : 'Set the sliders to choose an estimated population (0 – 1,000,000 citizens).';

  const canSubmit = !busy && name.trim() && regionPath.trim() && demographicsValid;

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
        <form onSubmit={onSubmit} className="dnd-modal-body domain-smith-body">
          <div className="dnd-modal-section domain-smith-wide">
            <h3>📁 Save Location</h3>
            <label className="dnd-label">
              <span>Region folder</span>
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

          <div className="dnd-modal-section domain-smith-primary">
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
                value={[sliderMinValue, sliderMaxValue]}
                onChange={handlePopulationRangeChange}
                disabled={busy}
              />
              <small className="muted">{populationHelperText}</small>
            </label>

            <label className="dnd-label">
              <span>Demographic composition</span>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {resolvedDemographics.map((entry, index) => {
                  const isOtherRow = index === otherIndex;
                  const shareValue = clampShare(entry?.share ?? 0);
                  const sliderDisabled = busy || (isOtherRow && hasAutoOther);
                  const removeDisabled = busy || resolvedDemographics.length <= 1;
                  return (
                    <div
                      key={`demographic-${index}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1.8fr) minmax(160px, 1fr) auto',
                        gap: '0.5rem',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        type="text"
                        value={entry?.group ?? ''}
                        onChange={(event) => handleDemographicGroupChange(index, event.target.value)}
                        placeholder={isOtherRow ? 'Other' : 'e.g. High Elves'}
                        disabled={busy}
                        aria-label={`Group ${index + 1}`}
                        style={{ padding: '0.5rem', fontSize: '0.95rem' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={shareValue}
                          onChange={(event) => handleDemographicShareChange(index, Number(event.target.value))}
                          disabled={sliderDisabled}
                          aria-label={`Percentage for ${entry?.group || `group ${index + 1}`}`}
                          style={{ flex: 1 }}
                        />
                        <span style={{ width: '3.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {`${shareValue}%`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleRemoveDemographic(index)}
                        disabled={removeDisabled}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                  marginTop: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <button type="button" className="secondary" onClick={handleAddDemographic} disabled={busy}>
                  Add group
                </button>
                <span style={{ fontSize: '0.85rem', color: demographicsStatusColor }}>
                  {demographicsStatusMessage}
                </span>
              </div>
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
          </div>

          <div className="dnd-modal-section domain-smith-primary">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-primary">
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

          <div className="dnd-modal-section domain-smith-primary">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-primary">
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

          <div className="dnd-modal-section domain-smith-primary">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-lore">
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

          <div className="dnd-modal-section domain-smith-primary">
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

          {formattedError ? (
            <div className="dnd-modal-error domain-smith-wide" role="alert">
              {formattedError}
              {errorDetails ? (
                <pre
                  style={{
                    marginTop: '0.5rem',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
                    fontSize: '0.8rem',
                  }}
                >
                  {errorDetails}
                </pre>
              ) : null}
            </div>
          ) : null}
          {message && !formattedError ? (
            <div role="status" className="domain-smith-wide domain-smith-status">
              {message}
            </div>
          ) : null}

          {canForgeCounties ? (
            <div className="dnd-modal-section domain-smith-wide domain-smith-highlight">
              <h3>Forge this domain&apos;s counties</h3>
              <p>
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

          <footer className="dnd-modal-actions domain-smith-wide">
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
