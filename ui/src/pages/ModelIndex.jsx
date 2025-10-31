import { useCallback, useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { BaseDirectory, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const INITIAL_BASE_MODELS = ['SDXL 1.0', 'Flux .1 D', 'WAN Video', 'Qwen', 'Other'];
const INITIAL_TOP_TAGS = ['Flux', 'DND', 'Fantasy', 'LoFi', 'Portrait', 'Character', 'Sci-Fi', 'Nature', 'Cinematic', 'Abstract'];
const MAX_TOP_TAGS = 10;

const INDEX_CANDIDATES = [
  {
    type: 'absolute',
    path: 'D:/Blossom/Blossom_Music/assets/indexed_models_img',
    label: 'D:/Blossom/Blossom_Music/assets/indexed_models_img/model_index',
  },
  {
    type: 'relative',
    dir: BaseDirectory.App,
    path: 'assets/indexed_models_img',
    label: 'App/assets/indexed_models_img/model_index',
  },
  {
    type: 'relative',
    dir: BaseDirectory.AppData,
    path: 'assets/indexed_models_img',
    label: 'AppData/assets/indexed_models_img/model_index',
  },
];

const indexTargetCache = { current: null };
const blockedCandidateIndices = new Set();

function makeModelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `model-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function toErrorMessage(error) {
  return String(error?.message || error || '').toLowerCase();
}

function isExistsError(error) {
  return toErrorMessage(error).includes('exist');
}

function isNotFoundError(error) {
  const message = toErrorMessage(error);
  return (
    message.includes('not found') ||
    message.includes('no such file') ||
    message.includes('enoent')
  );
}

function isForbiddenError(error) {
  return toErrorMessage(error).includes('forbidden');
}

function describeCandidate(candidate) {
  if (!candidate) return 'unknown';
  return candidate.label;
}

function markCandidateBlocked(index) {
  blockedCandidateIndices.add(index);
  if (indexTargetCache.current?.index === index) {
    indexTargetCache.current = null;
  }
}

function normalizeString(value, fallback = '') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue; // eslint-disable-line no-continue
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue; // eslint-disable-line no-continue
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeModelEntry(raw) {
  const entry = typeof raw === 'object' && raw !== null ? raw : {};
  const id = normalizeString(entry.id, makeModelId());
  const name = normalizeString(entry.name, id);
  const baseModel = normalizeString(entry.baseModel);
  const tags = normalizeStringArray(entry.tags);
  const triggerWords = normalizeStringArray(entry.triggerWords);
  const createdAt = normalizeString(entry.createdAt);
  return {
    id,
    name,
    baseModel,
    tags,
    triggerWords,
    createdAt,
  };
}

async function ensureDirectoryForCandidate(candidate, index) {
  if (!candidate) return null;
  try {
    if (candidate.type === 'absolute') {
      await mkdir(candidate.path, { recursive: true });
    } else {
      await mkdir(candidate.path, { dir: candidate.dir, recursive: true });
    }
    return { ...candidate, index };
  } catch (error) {
    if (isExistsError(error)) {
      return { ...candidate, index };
    }
    if (typeof index === 'number') {
      console.warn(
        'ModelIndex: storage location unavailable, skipping candidate',
        describeCandidate(candidate),
        error,
      );
      markCandidateBlocked(index);
    }
    return null;
  }
}

async function resolveIndexTarget() {
  if (
    indexTargetCache.current &&
    !blockedCandidateIndices.has(indexTargetCache.current.index)
  ) {
    return indexTargetCache.current;
  }

  for (let i = 0; i < INDEX_CANDIDATES.length; i += 1) {
    if (blockedCandidateIndices.has(i)) {
      continue; // eslint-disable-line no-continue
    }
    const ensured = await ensureDirectoryForCandidate(INDEX_CANDIDATES[i], i);
    if (ensured) {
      indexTargetCache.current = ensured;
      return ensured;
    }
  }

  throw new Error('Unable to locate a writable directory for indexed models.');
}

async function readModelIndex() {
  let attempts = 0;
  while (attempts < INDEX_CANDIDATES.length) {
    attempts += 1;
    let target;
    try {
      target = await resolveIndexTarget();
    } catch (error) {
      throw error;
    }
    try {
      const raw = target.type === 'absolute'
        ? await readTextFile(`${target.path}/model_index`)
        : await readTextFile(`${target.path}/model_index`, { dir: target.dir });
      if (!raw) {
        return { entries: [], target };
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { entries: [], target };
      }
      return { entries: parsed.map(normalizeModelEntry), target };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { entries: [], target };
      }
      if (isForbiddenError(error)) {
        if (typeof target.index === 'number') {
          markCandidateBlocked(target.index);
          continue;
        }
      }
      throw error;
    }
  }
  throw new Error('Unable to locate a readable directory for indexed models.');
}

async function writeModelIndex(entries) {
  let attempts = 0;
  const payload = JSON.stringify(entries, null, 2);
  while (attempts < INDEX_CANDIDATES.length) {
    attempts += 1;
    const target = await resolveIndexTarget();
    try {
      if (target.type === 'absolute') {
        await writeTextFile(`${target.path}/model_index`, payload);
      } else {
        await writeTextFile(`${target.path}/model_index`, payload, { dir: target.dir });
      }
      return target;
    } catch (error) {
      if (isForbiddenError(error)) {
        if (typeof target.index === 'number') {
          markCandidateBlocked(target.index);
          continue;
        }
        throw new Error(`Storage location is not writable (${describeCandidate(target)}).`);
      }
      throw error;
    }
  }
  throw new Error('Unable to locate a writable directory for indexed models.');
}

function normalizeCommaList(input) {
  const seen = new Set();
  const result = [];
  String(input ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    });
  return result;
}

function combineTopTags(dynamicTags) {
  const seen = new Set();
  const combined = [...dynamicTags, ...INITIAL_TOP_TAGS];
  const unique = [];
  for (const tag of combined) {
    const normalized = String(tag || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue; // eslint-disable-line no-continue
    }
    unique.push(normalized);
    seen.add(normalized);
    if (unique.length === MAX_TOP_TAGS) {
      break;
    }
  }
  if (!unique.length) {
    return INITIAL_TOP_TAGS;
  }
  return unique;
}

export default function ModelIndex() {
  const [isLoRaWizardOpen, setIsLoRaWizardOpen] = useState(false);
  const [loRaName, setLoRaName] = useState('');
  const [loRaError, setLoRaError] = useState('');
  const [baseModelOptions, setBaseModelOptions] = useState(INITIAL_BASE_MODELS);
  const [selectedBaseModel, setSelectedBaseModel] = useState(INITIAL_BASE_MODELS[0]);
  const [customBaseModel, setCustomBaseModel] = useState('');
  const [loRaTagsInput, setLoRaTagsInput] = useState('');
  const [loRaTriggerWordsInput, setLoRaTriggerWordsInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [indexedModels, setIndexedModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [topTagSuggestions, setTopTagSuggestions] = useState(INITIAL_TOP_TAGS);
  const [indexLocationLabel, setIndexLocationLabel] = useState('');

  const modelCount = indexedModels.length;

  const openLoRaWizard = () => {
    setIsLoRaWizardOpen(true);
    setLoRaError('');
  };

  const closeLoRaWizard = () => {
    setIsLoRaWizardOpen(false);
    setLoRaName('');
    setLoRaError('');
    setLoRaTagsInput('');
    setLoRaTriggerWordsInput('');
    const defaultBase = baseModelOptions[0] ?? INITIAL_BASE_MODELS[0];
    setSelectedBaseModel(defaultBase);
    setCustomBaseModel('');
  };

  const loadIndexedModels = useCallback(async () => {
    setIsLoadingModels(true);
    setLoadError('');
    try {
      const { entries, target } = await readModelIndex();
      entries.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime;
      });
      setIndexedModels(entries);
      const aggregatedTags = entries.flatMap((model) => (Array.isArray(model.tags) ? model.tags : []));
      setTopTagSuggestions(combineTopTags(aggregatedTags));
      setIndexLocationLabel(describeCandidate(target));
      return entries;
    } catch (error) {
      console.error('ModelIndex: failed to load indexed models', error);
      setLoadError(error?.message || 'Failed to load indexed models.');
      setIndexedModels([]);
      setTopTagSuggestions(INITIAL_TOP_TAGS);
      setIndexLocationLabel('');
      return [];
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadIndexedModels();
  }, [loadIndexedModels]);

  useEffect(() => {
    if (!indexedModels.length) {
      if (selectedModelId) {
        setSelectedModelId('');
      }
      return;
    }
    if (!indexedModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId(indexedModels[0].id);
    }
  }, [indexedModels, selectedModelId]);

  const selectedModel = useMemo(
    () => indexedModels.find((model) => model.id === selectedModelId) || null,
    [indexedModels, selectedModelId],
  );

  const formatTimestamp = useCallback((value) => {
    if (!value) {
      return 'Unknown';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }, []);

  const handleTagButtonClick = (tag) => {
    setLoRaTagsInput((prev) => {
      const list = normalizeCommaList(prev);
      if (!list.includes(tag)) {
        list.push(tag);
      }
      return list.join(', ');
    });
    setLoRaError('');
  };

  const handleLoRaSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    const name = loRaName.trim();
    if (!name) {
      setLoRaError('Model name is required.');
      return;
    }

    let finalBase = selectedBaseModel;
    if (selectedBaseModel === 'Other') {
      const custom = customBaseModel.trim();
      if (!custom) {
        setLoRaError('Provide a base model when selecting Other.');
        return;
      }
      finalBase = custom;
      const withoutOther = baseModelOptions.filter((option) => option !== 'Other');
      if (!withoutOther.includes(custom)) {
        setBaseModelOptions([...withoutOther, custom, 'Other']);
      }
      setSelectedBaseModel(custom);
      setCustomBaseModel('');
    }

    const tagsList = normalizeCommaList(loRaTagsInput);
    setLoRaTagsInput(tagsList.join(', '));

    const triggerWordsList = normalizeCommaList(loRaTriggerWordsInput);
    setLoRaTriggerWordsInput(triggerWordsList.join(', '));

    const modelId = makeModelId();
    const createdAt = new Date().toISOString();
    const payload = {
      id: modelId,
      name,
      baseModel: finalBase,
      tags: tagsList,
      triggerWords: triggerWordsList,
      createdAt,
    };

    setIsSaving(true);
    setLoRaError('');
    try {
      const { entries, target } = await readModelIndex();
      const existing = entries;
      const updated = [payload, ...existing.filter((entry) => entry.id !== payload.id)];
      const writeTarget = await writeModelIndex(updated);
      await loadIndexedModels();
      setSelectedModelId(modelId);
      if (writeTarget) {
        setIndexLocationLabel(describeCandidate(writeTarget));
      }
      closeLoRaWizard();
    } catch (error) {
      console.error('ModelIndex: failed to save LoRa info', error);
      setLoRaError(error?.message || 'Failed to save model metadata. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <BackButton />
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>
          {`${modelCount} Models currently indexed.`}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <PrimaryButton type="button" onClick={openLoRaWizard}>
            Add New LoRa
          </PrimaryButton>
          <PrimaryButton type="button">
            Add New Checkpoint
          </PrimaryButton>
          <PrimaryButton type="button">
            Add New Workflow
          </PrimaryButton>
        </div>
      </div>

      {indexLocationLabel && (
        <p className="card-caption" style={{ marginTop: '0.5rem' }}>
          Index file: {indexLocationLabel}
        </p>
      )}

      {loadError && (
        <section
          className="card"
          role="alert"
          style={{
            marginTop: '1rem',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            display: 'grid',
            gap: '0.35rem',
          }}
        >
          <strong>Unable to load model index</strong>
          <span className="card-caption">{loadError}</span>
        </section>
      )}

      {isLoRaWizardOpen && (
        <section
          className="card"
          style={{
            marginTop: '1rem',
            display: 'grid',
            gap: '0.75rem',
            maxWidth: 'min(100%, 720px)',
          }}
        >
          <header>
            <h2 style={{ marginBottom: '0.25rem' }}>Add LoRa Model</h2>
          </header>
          <form
            onSubmit={handleLoRaSubmit}
            style={{
              display: 'grid',
              gap: '0.75rem',
            }}
          >
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Model Name</span>
              <input
                type="text"
                value={loRaName}
                onChange={(event) => {
                  setLoRaName(event.target.value);
                  setLoRaError('');
                }}
                placeholder="e.g. dreamy-landscapes-lora"
                style={{
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                  fontSize: '1rem',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Base Model</span>
              <select
                value={selectedBaseModel}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedBaseModel(value);
                  setLoRaError('');
                  if (value !== 'Other') {
                    setCustomBaseModel('');
                  }
                }}
                style={{
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                  fontSize: '1rem',
                }}
              >
                {baseModelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {selectedBaseModel === 'Other' && (
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Custom Base Model</span>
                <input
                  type="text"
                  value={customBaseModel}
                  onChange={(event) => {
                    setCustomBaseModel(event.target.value);
                    setLoRaError('');
                  }}
                  placeholder="Enter base model identifier"
                  style={{
                    padding: '0.65rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(15, 23, 42, 0.2)',
                    background: 'var(--card-bg)',
                    color: 'var(--text)',
                    fontSize: '1rem',
                  }}
                />
              </label>
            )}

            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Popular Tags</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {topTagSuggestions.length ? (
                  topTagSuggestions.slice(0, MAX_TOP_TAGS).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleTagButtonClick(tag)}
                      style={{
                        border: '1px solid rgba(15, 23, 42, 0.2)',
                        borderRadius: '999px',
                        padding: '0.35rem 0.75rem',
                        background: 'var(--card-bg)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <span className="card-caption">No tags indexed yet.</span>
                )}
              </div>
            </div>

            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Tags</span>
              <textarea
                value={loRaTagsInput}
                onChange={(event) => {
                  setLoRaTagsInput(event.target.value);
                  setLoRaError('');
                }}
                rows={2}
                placeholder="Flux, DND, etc."
                style={{
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                  fontSize: '1rem',
                  resize: 'vertical',
                }}
              />
              <span className="card-caption">Separate tags with commas (Flux, DND, etc.).</span>
            </label>

            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Trigger Words</span>
              <textarea
                value={loRaTriggerWordsInput}
                onChange={(event) => {
                  setLoRaTriggerWordsInput(event.target.value);
                  setLoRaError('');
                }}
                rows={2}
                placeholder="High detail, cinematic lighting, etc."
                style={{
                  padding: '0.65rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(15, 23, 42, 0.2)',
                  background: 'var(--card-bg)',
                  color: 'var(--text)',
                  fontSize: '1rem',
                  resize: 'vertical',
                }}
              />
              <span className="card-caption">Separate trigger words with commas.</span>
            </label>

            {loRaError && (
              <p className="card-caption" style={{ color: 'var(--accent)' }}>
                {loRaError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <PrimaryButton type="submit" loading={isSaving} loadingText="Saving..." disabled={isSaving}>
                Save
              </PrimaryButton>
              <button
                type="button"
                onClick={closeLoRaWizard}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  padding: '0.65rem 0.9rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section
        className="card"
        style={{
          marginTop: '1rem',
          display: 'grid',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0 }}>Indexed Models</h2>
          {isLoadingModels && (
            <span className="card-caption">Refreshing index...</span>
          )}
        </div>
        {indexedModels.length === 0 ? (
          <p className="card-caption">
            No LoRa models indexed yet. Save one to populate this list.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '1rem',
            }}
          >
            {indexedModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => setSelectedModelId(model.id)}
                className="card"
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  textAlign: 'left',
                  border: selectedModelId === model.id ? '2px solid var(--accent)' : undefined,
                }}
              >
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '12px',
                    background: 'rgba(15, 23, 42, 0.08)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: 'var(--text)',
                  }}
                >
                  ?
                </div>
                <div style={{ display: 'grid', gap: '0.25rem' }}>
                  <strong style={{ fontSize: '1.1rem' }}>{model.name}</strong>
                  <span className="card-caption">
                    {model.baseModel || 'Base model TBD'}
                  </span>
                  {model.tags.length > 0 && (
                    <span className="card-caption">
                      Tags: {model.tags.slice(0, 3).join(', ')}
                      {model.tags.length > 3 ? '…' : ''}
                    </span>
                  )}
                  {model.createdAt && (
                    <span className="card-caption">
                      Saved {formatTimestamp(model.createdAt)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedModel && (
        <section
          className="card"
          style={{
            marginTop: '1rem',
            display: 'grid',
            gap: '0.5rem',
          }}
        >
          <header style={{ display: 'grid', gap: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>{selectedModel.name}</h2>
            <span className="card-caption">
              Saved {formatTimestamp(selectedModel.createdAt)}
            </span>
          </header>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
              margin: 0,
            }}
          >
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <dt style={{ fontWeight: 600 }}>Base Model</dt>
              <dd style={{ margin: 0 }}>{selectedModel.baseModel || 'Not set'}</dd>
            </div>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <dt style={{ fontWeight: 600 }}>Tags</dt>
              <dd style={{ margin: 0 }}>
                {selectedModel.tags.length ? selectedModel.tags.join(', ') : 'None'}
              </dd>
            </div>
            <div style={{ display: 'grid', gap: '0.25rem' }}>
              <dt style={{ fontWeight: 600 }}>Trigger Words</dt>
              <dd style={{ margin: 0 }}>
                {selectedModel.triggerWords.length
                  ? selectedModel.triggerWords.join(', ')
                  : 'None'}
              </dd>
            </div>
          </dl>
          <footer style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="card-caption">
              Stored in {indexLocationLabel || 'AppData/model_index'}
            </span>
            <span className="card-caption">
              Entry ID: {selectedModel.id}
            </span>
          </footer>
        </section>
      )}
    </>
  );
}
