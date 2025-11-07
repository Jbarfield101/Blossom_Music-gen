import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { exists, mkdir, writeFile as writeBinaryFile } from '@tauri-apps/plugin-fs';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import Icon from '../components/Icon.jsx';
import { fileSrc } from '../lib/paths.js';
import './ModelIndex.css';

const INITIAL_BASE_MODELS = ['SDXL 1.0', 'Flux .1 D', 'WAN Video', 'Qwen', 'Other'];
const INITIAL_TOP_TAGS = ['Flux', 'DND', 'Fantasy', 'LoFi', 'Portrait', 'Character', 'Sci-Fi', 'Nature', 'Cinematic', 'Abstract'];
const MAX_TOP_TAGS = 10;

const MODEL_INDEX_PATH = 'D:/Documents/DreadHaven/model_index.json';
const MODEL_TEST_IMAGE_ROOT = 'D:/Blossom/Blossom_Music/assets/images/lora_examples';

const DEMO_INDEX_ENTRIES = [
  {
    id: 'demo-texture-garden',
    name: 'Demo Texture Garden',
    baseModel: 'SDXL 1.0',
    tags: ['demo', 'texture', 'garden'],
    triggerWords: ['texture garden'],
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'demo-night-skyline',
    name: 'Demo Night Skyline',
    baseModel: 'Flux .1 D',
    tags: ['demo', 'night', 'city'],
    triggerWords: ['neon skyline'],
    createdAt: '2024-02-01T00:00:00.000Z',
  },
];

function makeModelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `model-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
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
  const thumbnailPath = normalizeString(entry.thumbnailPath);
  const testBatchCountRaw = Number(entry.testBatchCount);
  const testBatchCount = Number.isFinite(testBatchCountRaw) && testBatchCountRaw > 0 ? testBatchCountRaw : 0;
  const lastTest =
    typeof entry.lastTest === 'object' && entry.lastTest !== null
      ? {
          positivePrompt: normalizeString(entry.lastTest.positivePrompt),
          negativePrompt: normalizeString(entry.lastTest.negativePrompt),
          ranAt: normalizeString(entry.lastTest.ranAt),
          seed: normalizeString(entry.lastTest.seed),
          steps: Number.isFinite(Number(entry.lastTest.steps)) ? Number(entry.lastTest.steps) : null,
          cfg: Number.isFinite(Number(entry.lastTest.cfg)) ? Number(entry.lastTest.cfg) : null,
          denoise: Number.isFinite(Number(entry.lastTest.denoise)) ? Number(entry.lastTest.denoise) : null,
          images: Array.isArray(entry.lastTest.images)
            ? entry.lastTest.images.map((imagePath) => normalizeString(imagePath)).filter(Boolean)
            : [],
        }
      : null;
  return {
    id,
    name,
    baseModel,
    tags,
    triggerWords,
    createdAt,
    thumbnailPath,
    testBatchCount,
    lastTest,
  };
}

function sanitizeFileStem(source, fallback = 'lora_image') {
  const base = String(source || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return base || fallback;
}

function buildPath(base, ...segments) {
  const baseStr = String(base || '').trim();
  const useBackslash = /\\/.test(baseStr) && !/\//.test(baseStr);
  const separator = useBackslash ? '\\' : '/';
  const cleanedBase = baseStr.replace(/[\\/]+$/, '');
  const cleanedSegments = segments
    .map((segment) => String(segment || '').trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[\\/]+/g, separator).replace(new RegExp(`^${separator}+`), ''));
  return [cleanedBase, ...cleanedSegments].filter(Boolean).join(separator);
}

async function ensureDirectory(path) {
  if (!path) {
    return;
  }
  const alreadyExists = await exists(path).catch(() => false);
  if (alreadyExists) {
    return;
  }
  await mkdir(path, { recursive: true }).catch(() => {});
}

function describeLocation(path) {
  if (typeof path !== 'string' || !path.trim()) {
    return MODEL_INDEX_PATH;
  }
  return path;
}

async function readModelIndex() {
  const result = await invoke('model_index_read').catch((error) => {
    throw error;
  });
  const path = typeof result?.path === 'string' && result.path ? result.path : MODEL_INDEX_PATH;
  const raw = typeof result?.contents === 'string' ? result.contents : '';
  if (!raw) {
    const seeded = DEMO_INDEX_ENTRIES.map(normalizeModelEntry);
    return {
      entries: seeded,
      target: { path, label: describeLocation(path) },
      needsSeed: true,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      const seeded = DEMO_INDEX_ENTRIES.map(normalizeModelEntry);
      return {
        entries: seeded,
        target: { path, label: describeLocation(path) },
        needsSeed: true,
      };
    }
    return {
      entries: parsed.map(normalizeModelEntry),
      target: { path, label: describeLocation(path) },
      needsSeed: false,
    };
  } catch (error) {
    console.warn('ModelIndex: stored JSON invalid, reseeding', error);
    const seeded = DEMO_INDEX_ENTRIES.map(normalizeModelEntry);
    return {
      entries: seeded,
      target: { path, label: describeLocation(path) },
      needsSeed: true,
    };
  }
}

async function writeModelIndex(entries) {
  const payload = JSON.stringify(entries, null, 2);
  const result = await invoke('model_index_write', { contents: payload }).catch((error) => {
    throw error;
  });
  const path = typeof result?.path === 'string' && result.path ? result.path : MODEL_INDEX_PATH;
  return { path, label: describeLocation(path) };
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
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [editError, setEditError] = useState('');
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [testPositivePrompt, setTestPositivePrompt] = useState('');
  const [testNegativePrompt, setTestNegativePrompt] = useState('');
  const [testImages, setTestImages] = useState([]);
  const [testError, setTestError] = useState('');
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testSuccessMessage, setTestSuccessMessage] = useState('');
  const [testSeed, setTestSeed] = useState('');
  const [testSteps, setTestSteps] = useState('');
  const [testCfg, setTestCfg] = useState('');
  const [testDenoise, setTestDenoise] = useState('');

  const modelCount = indexedModels.length;
  const secondaryButtonStyle = useMemo(
    () => ({
      border: '1px solid rgba(15, 23, 42, 0.2)',
      background: 'transparent',
      color: 'var(--text)',
      padding: '0.55rem 1rem',
      borderRadius: '10px',
      fontWeight: 600,
      cursor: 'pointer',
    }),
    [],
  );

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
      const { entries, target, needsSeed } = await readModelIndex();
      entries.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime;
      });
      setIndexedModels(entries);
      const aggregatedTags = entries.flatMap((model) => (Array.isArray(model.tags) ? model.tags : []));
      setTopTagSuggestions(combineTopTags(aggregatedTags));
      setIndexLocationLabel(describeLocation(target?.path || target?.label));
      if (needsSeed) {
        await writeModelIndex(entries).catch((error) => {
          console.warn('ModelIndex: failed to seed default entries', error);
        });
      }
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

  useEffect(() => {
    setIsEditingModel(false);
    setEditDraft(null);
    setEditError('');
    setIsTestDialogOpen(false);
    setTestPositivePrompt('');
    setTestNegativePrompt('');
    setTestImages([]);
    setTestError('');
    setTestSuccessMessage('');
    setTestSeed('');
    setTestSteps('');
    setTestCfg('');
    setTestDenoise('');
  }, [selectedModelId]);

  const selectedModel = useMemo(
    () => indexedModels.find((model) => model.id === selectedModelId) || null,
    [indexedModels, selectedModelId],
  );

  const testOutputDirectory = useMemo(() => {
    if (!selectedModel) {
      return MODEL_TEST_IMAGE_ROOT;
    }
    return buildPath(MODEL_TEST_IMAGE_ROOT, sanitizeFileStem(selectedModel.name || selectedModel.id, selectedModel.id));
  }, [selectedModel]);

  const beginEditingModel = useCallback(() => {
    if (!selectedModel) {
      return;
    }
    setEditError('');
    setTestSuccessMessage('');
    setIsEditingModel(true);
    setEditDraft({
      name: selectedModel.name,
      baseModel: selectedModel.baseModel,
      tags: selectedModel.tags.join(', '),
      triggerWords: selectedModel.triggerWords.join(', '),
    });
  }, [selectedModel]);

  const cancelEditingModel = useCallback(() => {
    setIsEditingModel(false);
    setEditDraft(null);
    setEditError('');
  }, []);

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

  const updateEditDraftField = useCallback((field, value) => {
    setEditDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!selectedModel || !editDraft) {
      return;
    }
    const name = String(editDraft.name || '').trim();
    if (!name) {
      setEditError('Model name is required.');
      return;
    }
    const baseModel = String(editDraft.baseModel || '').trim();
    const tagsList = normalizeCommaList(editDraft.tags);
    const triggerWordsList = normalizeCommaList(editDraft.triggerWords);

    const updatedModel = {
      ...selectedModel,
      name,
      baseModel,
      tags: tagsList,
      triggerWords: triggerWordsList,
    };

    try {
      const updatedEntries = indexedModels.map((model) =>
        model.id === selectedModel.id ? updatedModel : model,
      );
      const writeTarget = await writeModelIndex(updatedEntries);
      setIndexedModels(updatedEntries);
      const aggregatedTags = updatedEntries.flatMap((model) => (Array.isArray(model.tags) ? model.tags : []));
      setTopTagSuggestions(combineTopTags(aggregatedTags));
      if (writeTarget) {
        setIndexLocationLabel(writeTarget.label || describeLocation(writeTarget.path));
      }
      setEditError('');
      setIsEditingModel(false);
      setEditDraft(null);
      setSelectedModelId(updatedModel.id);
    } catch (error) {
      console.error('ModelIndex: failed to update model metadata', error);
      setEditError(error?.message || 'Failed to update model metadata.');
    }
  }, [editDraft, indexedModels, selectedModel]);

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
      thumbnailPath: '',
      testBatchCount: 0,
      lastTest: null,
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
        setIndexLocationLabel(writeTarget.label || describeLocation(writeTarget.path));
      }
      closeLoRaWizard();
    } catch (error) {
      console.error('ModelIndex: failed to save LoRa info', error);
      setLoRaError(error?.message || 'Failed to save model metadata. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const openTestDialog = useCallback(() => {
    if (!selectedModel) {
      return;
    }
    setIsTestDialogOpen(true);
    setTestSuccessMessage('');
    setTestPositivePrompt(selectedModel.lastTest?.positivePrompt || '');
    setTestNegativePrompt(selectedModel.lastTest?.negativePrompt || '');
    setTestImages([]);
    setTestError('');
    setTestSeed(selectedModel.lastTest?.seed || '');
    setTestSteps(
      selectedModel.lastTest?.steps !== null && selectedModel.lastTest?.steps !== undefined
        ? String(selectedModel.lastTest.steps)
        : '',
    );
    setTestCfg(
      selectedModel.lastTest?.cfg !== null && selectedModel.lastTest?.cfg !== undefined
        ? String(selectedModel.lastTest.cfg)
        : '',
    );
    setTestDenoise(
      selectedModel.lastTest?.denoise !== null && selectedModel.lastTest?.denoise !== undefined
        ? String(selectedModel.lastTest.denoise)
        : '',
    );
  }, [selectedModel]);

  const closeTestDialog = useCallback(() => {
    setIsTestDialogOpen(false);
    setIsRunningTest(false);
    setTestImages([]);
    setTestError('');
    setTestSuccessMessage('');
    setTestPositivePrompt('');
    setTestNegativePrompt('');
    setTestSeed('');
    setTestSteps('');
    setTestCfg('');
    setTestDenoise('');
  }, []);

  const handleTestImageChange = useCallback((event) => {
    const files = Array.from(event?.target?.files || []);
    setTestImages(files);
    if (event?.target) {
      event.target.value = '';
    }
  }, []);

  const handleTestSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (!selectedModel) {
        return;
      }
      if (!testImages.length) {
        setTestError('Add at least one reference image to run a test.');
        return;
      }

      const trimmedSeed = String(testSeed || '').trim();
      const trimmedSteps = String(testSteps || '').trim();
      const trimmedCfg = String(testCfg || '').trim();
      const trimmedDenoise = String(testDenoise || '').trim();

      const parsedSteps =
        trimmedSteps === '' ? null : Number(trimmedSteps);
      if (trimmedSteps && !Number.isFinite(parsedSteps)) {
        setTestError('Steps must be a number.');
        return;
      }
      const parsedCfg =
        trimmedCfg === '' ? null : Number(trimmedCfg);
      if (trimmedCfg && !Number.isFinite(parsedCfg)) {
        setTestError('CFG must be a number.');
        return;
      }
      const parsedDenoise =
        trimmedDenoise === '' ? null : Number(trimmedDenoise);
      if (trimmedDenoise && !Number.isFinite(parsedDenoise)) {
        setTestError('Denoise must be a number between 0 and 1.');
        return;
      }
      if (parsedDenoise !== null && (parsedDenoise < 0 || parsedDenoise > 1)) {
        setTestError('Denoise must be between 0 and 1.');
        return;
      }

      setIsRunningTest(true);
      setTestError('');
      try {
        await ensureDirectory(MODEL_TEST_IMAGE_ROOT);
        const sanitizedStem = sanitizeFileStem(selectedModel.name || selectedModel.id, selectedModel.id);
        const modelDir = buildPath(MODEL_TEST_IMAGE_ROOT, sanitizedStem);
        await ensureDirectory(modelDir);
        const nextBatch = (Number(selectedModel.testBatchCount) || 0) + 1;
        const batchLabel = String(nextBatch).padStart(2, '0');
        const savedImages = [];
        for (let index = 0; index < testImages.length; index += 1) {
          const file = testImages[index];
          const extensionMatch = typeof file?.name === 'string' ? file.name.match(/\.[^.]+$/) : null;
          const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '.png';
          const imageLabel = String(index + 1).padStart(2, '0');
          const targetName = `${sanitizedStem}_batch${batchLabel}_${imageLabel}${extension}`;
          const targetPath = buildPath(modelDir, targetName);
          const buffer = await file.arrayBuffer();
          await writeBinaryFile(targetPath, new Uint8Array(buffer));
          savedImages.push(targetPath);
        }

        const updatedModel = {
          ...selectedModel,
          testBatchCount: nextBatch,
          lastTest: {
            positivePrompt: String(testPositivePrompt || '').trim(),
            negativePrompt: String(testNegativePrompt || '').trim(),
            ranAt: new Date().toISOString(),
            seed: trimmedSeed,
            steps: parsedSteps,
            cfg: parsedCfg,
            denoise: parsedDenoise,
            images: savedImages,
          },
          thumbnailPath: savedImages[0] || selectedModel.thumbnailPath || '',
        };

        const updatedEntries = indexedModels.map((model) =>
          model.id === selectedModel.id ? updatedModel : model,
        );
        const writeTarget = await writeModelIndex(updatedEntries);
        setIndexedModels(updatedEntries);
        const aggregatedTags = updatedEntries.flatMap((model) => (Array.isArray(model.tags) ? model.tags : []));
        setTopTagSuggestions(combineTopTags(aggregatedTags));
        if (writeTarget) {
          setIndexLocationLabel(writeTarget.label || describeLocation(writeTarget.path));
        }
        setSelectedModelId(updatedModel.id);
        setTestSuccessMessage(
          `Saved ${savedImages.length} image${savedImages.length === 1 ? '' : 's'} to ${modelDir}.`,
        );
        setTestSeed('');
        setTestSteps('');
        setTestCfg('');
        setTestDenoise('');
        setIsTestDialogOpen(false);
        setTestImages([]);
        setTestPositivePrompt('');
        setTestNegativePrompt('');
      } catch (error) {
        console.error('ModelIndex: failed to store test run assets', error);
        setTestError(error?.message || 'Failed to store test assets. Make sure the destination is writable.');
      } finally {
        setIsRunningTest(false);
      }
    },
    [indexedModels, selectedModel, testImages, testNegativePrompt, testPositivePrompt, testSeed, testSteps, testCfg, testDenoise],
  );

  const handleDeleteModel = useCallback(
    async (modelId) => {
      if (!modelId) {
        return;
      }
      setLoadError('');
      setIsEditingModel(false);
      setEditDraft(null);
      setEditError('');
      setIsTestDialogOpen(false);
      setIsRunningTest(false);
      setTestImages([]);
      setTestError('');
      setTestSuccessMessage('');
      setTestPositivePrompt('');
      setTestNegativePrompt('');
      setTestSeed('');
      setTestSteps('');
      setTestCfg('');
      setTestDenoise('');
      const remaining = indexedModels.filter((model) => model.id !== modelId);
      if (remaining.length === indexedModels.length) {
        return;
      }
      try {
        const writeTarget = await writeModelIndex(remaining);
        setIndexedModels(remaining);
        const aggregatedTags = remaining.flatMap((model) => (Array.isArray(model.tags) ? model.tags : []));
        setTopTagSuggestions(combineTopTags(aggregatedTags));
        if (selectedModelId === modelId) {
          setSelectedModelId(remaining[0]?.id || '');
        }
        if (writeTarget) {
          setIndexLocationLabel(writeTarget.label || describeLocation(writeTarget.path));
        }
      } catch (error) {
        console.error('ModelIndex: failed to delete model from index', error);
        setLoadError(error?.message || 'Failed to delete model from index.');
      }
    },
    [indexedModels, selectedModelId],
  );

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
        className="card model-index-panel"
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
          <div className="model-index-grid">
            {indexedModels.map((model) => {
              const isSelected = selectedModelId === model.id;
              const visibleTags = model.tags.slice(0, 4);
              const hiddenTagCount = Math.max(0, model.tags.length - visibleTags.length);
              const visibleTriggers = model.triggerWords.slice(0, 2);
              const hiddenTriggerCount = Math.max(0, model.triggerWords.length - visibleTriggers.length);
              const lastTestImageCount = model.lastTest?.images?.length ?? 0;
              const testRuns = Number.isFinite(model.testBatchCount) ? model.testBatchCount : 0;
              const modelInitial = ((model.name || '?').trim().charAt(0) || '?').toUpperCase();

              return (
                <div
                  key={model.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`Select ${model.name}`}
                  onClick={() => setSelectedModelId(model.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedModelId(model.id);
                    }
                  }}
                  className={`card model-index-card${isSelected ? ' is-selected' : ''}`}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${model.name} from index`}
                    title={`Remove ${model.name} from index`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteModel(model.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDeleteModel(model.id);
                      }
                    }}
                    className="model-index-card__delete"
                  >
                    <Icon name="Trash2" size={16} />
                  </span>
                  <div className="model-index-card__header">
                    <div className="model-index-card__thumb">
                      {model.thumbnailPath ? (
                        <img
                          src={fileSrc(model.thumbnailPath)}
                          alt={`${model.name} preview`}
                        />
                      ) : (
                        <span className="model-index-card__thumb-placeholder">
                          {modelInitial}
                        </span>
                      )}
                    </div>
                    <div className="model-index-card__title">
                      <strong>{model.name}</strong>
                      <span className="card-caption">
                        {model.baseModel || 'Base model TBD'}
                      </span>
                      {model.createdAt && (
                        <span className="card-caption">
                          Saved {formatTimestamp(model.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {model.tags.length > 0 ? (
                    <div className="model-index-card__chips">
                      {visibleTags.map((tag, index) => (
                        <span key={`${model.id}-tag-${tag}-${index}`} className="model-index-card__chip">
                          {tag}
                        </span>
                      ))}
                      {hiddenTagCount > 0 && (
                        <span className="model-index-card__chip model-index-card__chip--muted">
                          +{hiddenTagCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="card-caption">No tags captured yet.</span>
                  )}
                  {model.triggerWords.length > 0 && (
                    <span className="card-caption">
                      Triggers: {visibleTriggers.join(', ')}
                      {hiddenTriggerCount > 0 ? ` +${hiddenTriggerCount}` : ''}
                    </span>
                  )}
                  <dl className="model-index-card__stats">
                    <div>
                      <dt>Test Runs</dt>
                      <dd>{testRuns}</dd>
                    </div>
                    <div>
                      <dt>Images</dt>
                      <dd>{lastTestImageCount}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedModel && (
        <section
          className="card"
          style={{
            marginTop: '1rem',
            display: 'grid',
            gap: '0.75rem',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              <h2 style={{ margin: 0 }}>{selectedModel.name}</h2>
              <span className="card-caption">
                Saved {formatTimestamp(selectedModel.createdAt)}
              </span>
              {selectedModel.lastTest?.ranAt && (
                <span className="card-caption">
                  Last tested {formatTimestamp(selectedModel.lastTest.ranAt)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {isEditingModel ? (
                <span className="card-caption" style={{ fontWeight: 600 }}>
                  Editing metadata
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={beginEditingModel}
                    style={secondaryButtonStyle}
                  >
                    Edit
                  </button>
                  <PrimaryButton type="button" onClick={openTestDialog}>
                    Test Model
                  </PrimaryButton>
                </>
              )}
            </div>
          </header>
          {testSuccessMessage && (
            <span className="card-caption" style={{ color: 'var(--success, #16a34a)' }}>
              {testSuccessMessage}
            </span>
          )}
          {editError && (
            <span className="card-caption" style={{ color: 'var(--accent)' }}>
              {editError}
            </span>
          )}
          {isEditingModel && editDraft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleEditSave();
              }}
              style={{
                display: 'grid',
                gap: '0.75rem',
              }}
            >
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Model Name</span>
                <input
                  type="text"
                  value={editDraft.name}
                  onChange={(event) => updateEditDraftField('name', event.target.value)}
                  placeholder="My LoRa Model"
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
                <input
                  type="text"
                  value={editDraft.baseModel}
                  onChange={(event) => updateEditDraftField('baseModel', event.target.value)}
                  placeholder="SDXL 1.0"
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
                <span style={{ fontWeight: 600 }}>Tags</span>
                <textarea
                  value={editDraft.tags}
                  onChange={(event) => updateEditDraftField('tags', event.target.value)}
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
                <span className="card-caption">Separate tags with commas.</span>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Trigger Words</span>
                <textarea
                  value={editDraft.triggerWords}
                  onChange={(event) => updateEditDraftField('triggerWords', event.target.value)}
                  rows={2}
                  placeholder="Cinematic lighting, high detail"
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
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <PrimaryButton type="submit">Save Changes</PrimaryButton>
                <button
                  type="button"
                  onClick={cancelEditingModel}
                  style={secondaryButtonStyle}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
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
              {selectedModel.lastTest && (
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <h3 style={{ margin: 0 }}>Last Test</h3>
                  <span className="card-caption">
                    Ran {formatTimestamp(selectedModel.lastTest.ranAt)} ·{' '}
                    {selectedModel.lastTest.images?.length || 0} image
                    {selectedModel.lastTest.images?.length === 1 ? '' : 's'}
                  </span>
                  {(selectedModel.lastTest.seed ||
                    selectedModel.lastTest.steps !== null ||
                    selectedModel.lastTest.cfg !== null ||
                    selectedModel.lastTest.denoise !== null) && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '0.5rem',
                      }}
                    >
                      {selectedModel.lastTest.seed && (
                        <div style={{ display: 'grid', gap: '0.15rem' }}>
                          <span className="card-caption" style={{ fontWeight: 600 }}>
                            Seed
                          </span>
                          <span>{selectedModel.lastTest.seed}</span>
                        </div>
                      )}
                      {selectedModel.lastTest.steps !== null && (
                        <div style={{ display: 'grid', gap: '0.15rem' }}>
                          <span className="card-caption" style={{ fontWeight: 600 }}>
                            Steps
                          </span>
                          <span>{selectedModel.lastTest.steps}</span>
                        </div>
                      )}
                      {selectedModel.lastTest.cfg !== null && (
                        <div style={{ display: 'grid', gap: '0.15rem' }}>
                          <span className="card-caption" style={{ fontWeight: 600 }}>
                            CFG
                          </span>
                          <span>{selectedModel.lastTest.cfg}</span>
                        </div>
                      )}
                      {selectedModel.lastTest.denoise !== null && (
                        <div style={{ display: 'grid', gap: '0.15rem' }}>
                          <span className="card-caption" style={{ fontWeight: 600 }}>
                            Denoise
                          </span>
                          <span>{selectedModel.lastTest.denoise}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {selectedModel.lastTest.positivePrompt && (
                    <div style={{ display: 'grid', gap: '0.15rem' }}>
                      <span style={{ fontWeight: 600 }}>Positive Prompt</span>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {selectedModel.lastTest.positivePrompt}
                      </p>
                    </div>
                  )}
                  {selectedModel.lastTest.negativePrompt && (
                    <div style={{ display: 'grid', gap: '0.15rem' }}>
                      <span style={{ fontWeight: 600 }}>Negative Prompt</span>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {selectedModel.lastTest.negativePrompt}
                      </p>
                    </div>
                  )}
                  {selectedModel.thumbnailPath && (
                    <div style={{ display: 'grid', gap: '0.25rem' }}>
                      <span style={{ fontWeight: 600 }}>Preview</span>
                      <img
                        src={fileSrc(selectedModel.thumbnailPath)}
                        alt={`${selectedModel.name} preview`}
                        style={{
                          width: '100%',
                          maxWidth: '280px',
                          borderRadius: '12px',
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <footer style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="card-caption">
              Stored in {indexLocationLabel || MODEL_INDEX_PATH}
            </span>
            <span className="card-caption">
              Entry ID: {selectedModel.id}
            </span>
          </footer>
        </section>
      )}

      {isTestDialogOpen && selectedModel && (
        <section
          className="card"
          style={{
            marginTop: '1rem',
            display: 'grid',
            gap: '0.75rem',
          }}
        >
          <header style={{ display: 'grid', gap: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>Test {selectedModel.name}</h2>
            <span className="card-caption">
              Test assets will be stored in {testOutputDirectory}
            </span>
          </header>
          <form
            onSubmit={handleTestSubmit}
            style={{
              display: 'grid',
              gap: '0.75rem',
            }}
          >
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Positive Prompt</span>
              <textarea
                value={testPositivePrompt}
                onChange={(event) => setTestPositivePrompt(event.target.value)}
                rows={3}
                placeholder="Describe what the model should produce..."
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
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Negative Prompt</span>
              <textarea
                value={testNegativePrompt}
                onChange={(event) => setTestNegativePrompt(event.target.value)}
                rows={3}
                placeholder="List attributes to avoid..."
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
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: '0.75rem',
              }}
            >
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Seed</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={testSeed}
                  onChange={(event) => setTestSeed(event.target.value)}
                  placeholder="Optional seed"
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
                <span style={{ fontWeight: 600 }}>Steps</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={testSteps}
                  onChange={(event) => setTestSteps(event.target.value)}
                  placeholder="e.g. 30"
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
                <span style={{ fontWeight: 600 }}>CFG</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={testCfg}
                  onChange={(event) => setTestCfg(event.target.value)}
                  placeholder="e.g. 7.5"
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
                <span style={{ fontWeight: 600 }}>Denoise</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={testDenoise}
                  onChange={(event) => setTestDenoise(event.target.value)}
                  placeholder="e.g. 0.7"
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
            </div>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontWeight: 600 }}>Reference Images</span>
              <input type="file" accept="image/*" multiple onChange={handleTestImageChange} />
              <span className="card-caption">Select one or more generated outputs to archive.</span>
            </label>
            {testImages.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: '1.25rem',
                  display: 'grid',
                  gap: '0.25rem',
                  fontSize: '0.9rem',
                }}
              >
                {testImages.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="card-caption">
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
            {testError && (
              <span className="card-caption" style={{ color: 'var(--accent)' }}>
                {testError}
              </span>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <PrimaryButton
                type="submit"
                loading={isRunningTest}
                loadingText="Saving..."
                disabled={isRunningTest}
              >
                Save Test Run
              </PrimaryButton>
              <button
                type="button"
                onClick={closeTestDialog}
                style={secondaryButtonStyle}
                disabled={isRunningTest}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

    </>
  );
}

