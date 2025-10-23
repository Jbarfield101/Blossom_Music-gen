import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { useLocation } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import JobQueuePanel from '../components/JobQueuePanel.jsx';
import LabeledToggle from '../components/LabeledToggle.jsx';
import { fileSrc } from '../lib/paths.js';
import { useJobQueue } from '../lib/useJobQueue.js';

const STATUS_POLL_INTERVAL_MS = 5000;
const JOB_POLL_INTERVAL_MS = 1500;
const DEFAULT_FILE_PREFIX = 'audio/ComfyUI';
const DEFAULT_SECONDS = '120';

const POSITIVE_PROMPT_TEMPLATE =
  'A {mainConcept} in {genreStyle} featuring {instruments}, evoking a {moodEmotion} vibe inspired by {eraInfluence}. {structureProgression}. {soundDesignMix}. {tempo}.';

const TEMPLATE_PLACEHOLDERS = Object.freeze({
  mainConcept: '[Main Concept]',
  genreStyle: '[Genre/Style]',
  instruments: '[Instruments]',
  moodEmotion: '[Mood/Emotion]',
  eraInfluence: '[Era/Influence]',
  structureProgression: '[Structure/Progression details]',
  soundDesignMix: '[Sound design or mix notes]',
  tempo: '[Tempo]',
});

const PROMPT_TEMPLATE_FIELDS = [
  {
    key: 'mainConcept',
    label: 'Main Concept',
    description: 'Summarize the central idea, performer, or purpose of the track.',
    placeholder: 'Dreamy bedroom producer lullaby for stargazing',
  },
  {
    key: 'genreStyle',
    label: 'Genre / Style',
    description: 'Name the primary genre or hybrid style that frames the music.',
    placeholder: 'Lo-fi chillwave with downtempo influence',
  },
  {
    key: 'instruments',
    label: 'Featured Instruments',
    description: 'List the key instruments, sound sources, or textures.',
    placeholder: 'Tape-warped electric piano, brushed drums, gentle bass guitar',
  },
  {
    key: 'moodEmotion',
    label: 'Mood / Emotion',
    description: 'Describe the intended emotional tone or vibe.',
    placeholder: 'Warm, nostalgic, slightly bittersweet',
  },
  {
    key: 'eraInfluence',
    label: 'Era / Influence',
    description: 'Call out decades, scenes, or artists that inspire the sound.',
    placeholder: 'Mid-2000s indie electronica influences',
  },
  {
    key: 'structureProgression',
    label: 'Structure / Progression',
    description: 'Outline how the arrangement should evolve or loop.',
    placeholder: 'Loopable 16-bar progression with soft swells in the second half',
  },
  {
    key: 'soundDesignMix',
    label: 'Sound Design & Mix Notes',
    description: 'Note textures, processing, and mix direction.',
    placeholder: 'Vinyl crackle, tape saturation, airy reverb with wide stereo image',
  },
  {
    key: 'tempo',
    label: 'Tempo Details',
    description: 'Share BPM, tempo feel, and optional duration.',
    placeholder: '82 BPM with a relaxed swing, 60-second render',
  },
];

const BUILDER_KEYS = PROMPT_TEMPLATE_FIELDS.map((field) => field.key);

const BASE_NEGATIVE_TERMS = Object.freeze([
  'distortion',
  'clipping',
  'muddy mix',
  'harsh highs',
  'uneven dynamics',
  'digital artifacts',
  'overcompression',
]);

const PROMPT_GENERATION_SYSTEM =
  'You are Blossom, an expert audio prompt writer for Stable Audio diffusion. When given structured musical details, respond ONLY with JSON containing two string fields: "positive" and "negative". The positive prompt must follow the exact sentence template "A {Main Concept} in {Genre/Style} featuring {Instruments}, evoking a {Mood/Emotion} vibe inspired by {Era/Influence}. {Structure/Progression details}. {Sound design or mix notes}. {Tempo}." Replace every placeholder with vivid but concise language, no brackets, no extra sentences. The negative prompt must be a single comma-separated list of production or mix issues to avoid, without the word "no", numbering, or explanations.';

function createDefaultBuilderValues() {
  return BUILDER_KEYS.reduce((acc, key) => {
    acc[key] = '';
    return acc;
  }, {});
}

function normalizeBuilderField(value) {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(', ');
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value == null) {
    return '';
  }
  return String(value).trim();
}

function composePositivePrompt(values, { usePlaceholders = false } = {}) {
  const filled = {};
  BUILDER_KEYS.forEach((key) => {
    const raw = values?.[key];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed) {
      filled[key] = trimmed;
    } else if (usePlaceholders) {
      filled[key] = TEMPLATE_PLACEHOLDERS[key] || `[${key}]`;
    } else {
      filled[key] = '';
    }
  });
  if (!usePlaceholders) {
    const missing = BUILDER_KEYS.some((key) => !filled[key]);
    if (missing) {
      return '';
    }
  }
  let prompt = POSITIVE_PROMPT_TEMPLATE.replace(/\{(\w+)\}/g, (_, key) => filled[key] || '');
  prompt = prompt.replace(/\s+/g, ' ').replace(/\s([,.;])/g, '$1').trim();
  if (prompt && !/[.!?]$/.test(prompt)) {
    prompt = `${prompt}.`;
  }
  return prompt;
}

function buildPositivePreview(values) {
  return composePositivePrompt(values, { usePlaceholders: true });
}

function buildNegativePreview(values) {
  const suggestions = new Set(BASE_NEGATIVE_TERMS);

  const instruments = (values?.instruments || '').toLowerCase();
  if (instruments.includes('vocal') || instruments.includes('voice')) {
    suggestions.add('off-key vocals');
  }
  if (instruments.includes('guitar')) {
    suggestions.add('out-of-tune guitar');
  }
  if (instruments.includes('drum') || instruments.includes('percussion')) {
    suggestions.add('uneven drum hits');
  }

  const mood = (values?.moodEmotion || '').toLowerCase();
  if (mood.includes('calm') || mood.includes('relax') || mood.includes('peace')) {
    suggestions.add('aggressive percussion');
  }
  if (mood.includes('dark') || mood.includes('brooding') || mood.includes('moody')) {
    suggestions.add('bright cheerful leads');
  }

  const structure = (values?.structureProgression || '').toLowerCase();
  if (structure.includes('build') || structure.includes('crescendo')) {
    suggestions.add('abrupt transitions');
  }
  if (structure.includes('loop')) {
    suggestions.add('jarring loop points');
  }

  const tempo = (values?.tempo || '').toLowerCase();
  if (tempo.includes('slow')) {
    suggestions.add('rushed tempo');
  } else if (tempo.includes('fast') || tempo.includes('energetic')) {
    suggestions.add('dragging pace');
  }

  return Array.from(suggestions).join(', ');
}

function sanitizeJsonBlock(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  let trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  trimmed = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    trimmed = trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parsePromptGenerationResponse(raw) {
  if (raw == null) {
    return null;
  }
  const text = typeof raw === 'string' ? raw : String(raw);
  const cleaned = sanitizeJsonBlock(text) || text;
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const positive = normalizeBuilderField(extractPromptField(parsed, 'positive'));
    const negative = normalizeBuilderField(extractPromptField(parsed, 'negative'));
    return { positive, negative };
  } catch (err) {
    console.warn('Failed to parse prompt generation response', err);
    return null;
  }
}

function normalizeNegativePrompt(text) {
  if (typeof text !== 'string') {
    return '';
  }
  const cleaned = text.replace(/\r?\n/g, ' ').trim();
  if (!cleaned) {
    return '';
  }
  const seen = new Set();
  const parts = cleaned
    .split(',')
    .map((part) => part.trim().replace(/^no\s+/i, '').replace(/\s+/g, ' '))
    .filter((part) => part.length > 0);
  const normalized = [];
  parts.forEach((part) => {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(part);
    }
  });
  return normalized.join(', ');
}

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

function randomTemperature(min = 0.55, max = 0.85) {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(2));
}

function parseStableAudioPrompt(text) {
  const defaults = createDefaultBuilderValues();
  if (typeof text !== 'string') {
    return defaults;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return defaults;
  }

  const firstSentenceMatch = trimmed.match(
    /^A\s+(.+?)\s+in\s+(.+?)\s+featuring\s+(.+?),\s+evoking\s+a\s+(.+?)\s+vibe\s+inspired\s+by\s+(.+?)\./i,
  );
  if (!firstSentenceMatch) {
    return defaults;
  }

  const [, mainConcept, genreStyle, instruments, moodEmotion, eraInfluence] = firstSentenceMatch;
  defaults.mainConcept = mainConcept.trim();
  defaults.genreStyle = genreStyle.trim();
  defaults.instruments = instruments.trim();
  defaults.moodEmotion = moodEmotion.trim();
  defaults.eraInfluence = eraInfluence.trim();

  let remainder = trimmed.slice(firstSentenceMatch[0].length).trim();
  remainder = remainder.replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').trim();
  if (remainder.startsWith('.')) {
    remainder = remainder.slice(1).trim();
  }

  const segments = remainder
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  defaults.structureProgression = segments[0] || '';
  defaults.soundDesignMix = segments[1] || '';
  const tempoSegment = segments.length >= 3 ? segments.slice(2).join('. ').trim() : '';
  defaults.tempo = tempoSegment;
  if (defaults.tempo.endsWith('.')) {
    defaults.tempo = defaults.tempo.replace(/\.+$/, '').trim();
  }

  return defaults;
}

const SURFACE_BORDER_COLOR = 'color-mix(in srgb, var(--text) 18%, transparent)';
const SUBTLE_TEXT_COLOR = 'color-mix(in srgb, var(--text) 72%, transparent)';

const TEXTAREA_BASE_STYLE = Object.freeze({
  width: '100%',
  padding: '1.1rem',
  fontSize: '1.05rem',
  lineHeight: 1.6,
  borderRadius: '14px',
  border: `1px solid ${SURFACE_BORDER_COLOR}`,
  background: 'var(--card-bg)',
  color: 'var(--text)',
  resize: 'vertical',
  boxShadow: 'inset 0 2px 6px rgba(15, 23, 42, 0.08)',
});

function extractPromptField(result, key) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const direct = result[key];
  if (typeof direct === 'string') {
    return direct;
  }
  if (typeof direct === 'number') {
    return String(direct);
  }
  const snakeKey = key.replace(/([A-Z])/g, '_').toLowerCase();
  const fallback = result[snakeKey];
  if (typeof fallback === 'string') {
    return fallback;
  }
  if (typeof fallback === 'number') {
    return String(fallback);
  }
  return '';
}

export default function StableDiffusion() {
  const location = useLocation();
  const initialPrompt = typeof location.state?.prompt === 'string' ? location.state.prompt : '';
  const navPromptRef = useRef(initialPrompt);
  const statusIntervalRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const jobIdRef = useRef(null);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [filePrefix, setFilePrefix] = useState(DEFAULT_FILE_PREFIX);
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState(null);
  const [autoLaunch, setAutoLaunch] = useState(true);

  const [comfyStatus, setComfyStatus] = useState({ running: false, pending: 0, runningCount: 0 });
  const [statusError, setStatusError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);

  const [rendering, setRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState('');
  const [renderError, setRenderError] = useState('');
  const [currentJobId, setCurrentJobId] = useState('');
  const [audioOutputs, setAudioOutputs] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStage, setJobStage] = useState('');
  const [queuePosition, setQueuePosition] = useState(null);
  const [queueEtaSeconds, setQueueEtaSeconds] = useState(null);

  const [isPromptBuilderActive, setIsPromptBuilderActive] = useState(false);
  const [builderValues, setBuilderValues] = useState(() => createDefaultBuilderValues());
  const [builderError, setBuilderError] = useState('');
  const [builderNotice, setBuilderNotice] = useState('');
  const [generatingPrompts, setGeneratingPrompts] = useState(false);

  const applyBuilderValues = useCallback((values) => {
    setBuilderValues(() => {
      const next = createDefaultBuilderValues();
      if (values && typeof values === 'object') {
        PROMPT_TEMPLATE_FIELDS.forEach(({ key }) => {
          next[key] = normalizeBuilderField(values[key]);
        });
      }
      return next;
    });
  }, []);

  const { queue, refresh: refreshQueue } = useJobQueue(2000);

  const formatEta = useCallback((value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '';
    const total = Math.max(0, Math.round(value));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, []);

  const cancelFromQueue = useCallback(
    async (id) => {
      if (!id) return;
      try {
        await invoke('cancel_job', { jobId: id });
      } catch (err) {
        console.warn('Failed to cancel job', err);
      } finally {
        refreshQueue();
      }
    },
    [refreshQueue],
  );

  useEffect(() => {
    if (!comfySettings) return;
    setAutoLaunch(comfySettings.auto_launch ?? true);
  }, [comfySettings]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const tauri = await isTauri();
        if (cancelled) return;
        setIsTauriEnv(tauri);
        if (!tauri) {
          setError('Stable Diffusion workflow editing is only available in the desktop shell.');
          setLoading(false);
          return;
        }

        const promptsResult = await invoke('get_stable_audio_prompts');
        if (cancelled) return;
        const fetchedPrompt = extractPromptField(promptsResult, 'prompt');
        const fetchedNegative = extractPromptField(promptsResult, 'negativePrompt');
        const fetchedPrefix = extractPromptField(promptsResult, 'fileNamePrefix');
        const fetchedSeconds = extractPromptField(promptsResult, 'seconds');
        const cardPrompt = (navPromptRef.current || '').trim();
        const resolvedPrompt = cardPrompt ? cardPrompt : fetchedPrompt;
        setPrompt(resolvedPrompt);
        if (resolvedPrompt) {
          applyBuilderValues(parseStableAudioPrompt(resolvedPrompt));
        } else {
          applyBuilderValues(createDefaultBuilderValues());
        }
        navPromptRef.current = '';
        setNegativePrompt(fetchedNegative);
        setFilePrefix(fetchedPrefix || DEFAULT_FILE_PREFIX);
        setSeconds(fetchedSeconds || DEFAULT_SECONDS);
        setError('');
        setStatusMessage('');
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || 'Failed to load Stable Diffusion workflow prompts.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadInitial();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshStatus = useCallback(async (ensureLaunch = false) => {
    if (!isTauriEnv) return;
    try {
      if (ensureLaunch) {
        setIsLaunching(true);
      }
      const result = await invoke('comfyui_status', { ensureRunning: ensureLaunch });
      if (!result) return;
      setComfyStatus({
        running: Boolean(result.running),
        pending: Number(result.pending || 0),
        runningCount: Number(result.runningCount || 0),
      });
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
      setComfyStatus((prev) => ({ ...prev, running: false }));
    } finally {
      setIsLaunching(false);
    }
  }, [isTauriEnv]);

  const loadComfySettings = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const settings = await invoke('get_comfyui_settings');
      setComfySettings(settings);
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv]);

  const clearJobPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isTauriEnv) return undefined;
    let cancelled = false;

    (async () => {
      await loadComfySettings();
      if (cancelled) return;
      await refreshStatus(false);
      if (cancelled) return;
      statusIntervalRef.current = setInterval(() => {
        refreshStatus(false);
      }, STATUS_POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
      clearJobPolling();
      jobIdRef.current = null;
    };
  }, [clearJobPolling, isTauriEnv, loadComfySettings, refreshStatus]);

  const normalizeTemplates = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    const normalized = list
      .map((template) => ({
        name: String(template?.name ?? ''),
        prompt: template?.prompt ?? '',
        negativePrompt: template?.negative_prompt ?? template?.negativePrompt ?? '',
        fileNamePrefix: template?.file_name_prefix ?? template?.fileNamePrefix ?? DEFAULT_FILE_PREFIX,
        seconds:
          typeof template?.seconds === 'number'
            ? template.seconds
            : Number.parseFloat(String(template?.seconds ?? DEFAULT_SECONDS)) || Number(DEFAULT_SECONDS),
      }))
      .filter((template) => template.name.trim().length > 0);
      normalized.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return normalized;
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!isTauriEnv) return;
    try {
      const result = await invoke('get_stable_audio_templates');
      const normalized = normalizeTemplates(result);
      setTemplates(normalized);
      if (normalized.every((template) => template.name !== selectedTemplate)) {
        setSelectedTemplate('');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError((prev) => prev || message);
    }
  }, [isTauriEnv, normalizeTemplates, selectedTemplate]);

  useEffect(() => {
    if (!isTauriEnv) return;
    loadTemplates();
  }, [isTauriEnv, loadTemplates]);

  const updateComfySettings = useCallback(async (update) => {
    if (!isTauriEnv) return;
    try {
      const next = await invoke('update_comfyui_settings', { update });
      setComfySettings(next);
      setStatusError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusError(message);
    }
  }, [isTauriEnv]);

  const toggleAutoLaunch = useCallback(async () => {
    if (!isTauriEnv) return;
    const next = !autoLaunch;
    setAutoLaunch(next);
    await updateComfySettings({ autoLaunch: next });
  }, [autoLaunch, isTauriEnv, updateComfySettings]);

  const handleTemplateSelect = useCallback(
    (event) => {
      const name = event.target.value;
      setSelectedTemplate(name);
      if (!name) {
        return;
      }
      const template = templates.find((item) => item.name === name);
      if (!template) {
        return;
      }
      const templatePrompt = template.prompt || '';
      setPrompt(templatePrompt);
      if (templatePrompt) {
        applyBuilderValues(parseStableAudioPrompt(templatePrompt));
      } else {
        applyBuilderValues(createDefaultBuilderValues());
      }
      setNegativePrompt(template.negativePrompt || '');
      setFilePrefix(template.fileNamePrefix || DEFAULT_FILE_PREFIX);
      setSeconds(String(template.seconds ?? Number(DEFAULT_SECONDS)));
      setTemplateName(template.name);
    },
    [templates, applyBuilderValues],
  );

  const handleGeneratePrompts = useCallback(async () => {
    setBuilderError('');
    setBuilderNotice('');

    if (!isTauriEnv) {
      setBuilderError('Prompt generation requires the Blossom desktop app.');
      return;
    }

    const trimmedValues = PROMPT_TEMPLATE_FIELDS.reduce((acc, { key }) => {
      acc[key] = normalizeBuilderField(builderValues[key]);
      return acc;
    }, {});

    const missingField = PROMPT_TEMPLATE_FIELDS.find(({ key }) => !trimmedValues[key]);
    if (missingField) {
      setBuilderError('Please complete every section before generating prompts.');
      return;
    }

    const sectionsText = PROMPT_TEMPLATE_FIELDS.map(
      ({ label, key }) => `${label}: ${trimmedValues[key]}`,
    ).join('\n');

    const userPrompt = `Use the following creative brief to craft Stable Audio prompts.\n\n${sectionsText}\n\nReturn JSON with the fields "positive" and "negative" only.`;

    setGeneratingPrompts(true);
    try {
      const response = await invoke('generate_llm', {
        prompt: userPrompt,
        system: PROMPT_GENERATION_SYSTEM,
        temperature: randomTemperature(0.58, 0.82),
        seed: randomSeed(),
      });

      const parsed = parsePromptGenerationResponse(response);
      if (!parsed || !parsed.positive) {
        throw new Error('The AI response did not include a positive prompt.');
      }

      const parsedValues = parseStableAudioPrompt(parsed.positive);
      const recomposed = composePositivePrompt(parsedValues);
      const cleanedPositive = recomposed || normalizeBuilderField(parsed.positive);
      if (!cleanedPositive) {
        throw new Error('The positive prompt could not be composed.');
      }

      const cleanedNegative = normalizeNegativePrompt(parsed.negative || '') ||
        normalizeNegativePrompt(buildNegativePreview(trimmedValues));

      setPrompt(cleanedPositive);
      setNegativePrompt(cleanedNegative);
      if (recomposed) {
        applyBuilderValues(parsedValues);
      } else {
        applyBuilderValues(trimmedValues);
      }
      setBuilderNotice('Prompts generated. Review the preview and save before rendering.');
      setStatusMessage('AI-generated Stable Audio prompts are ready.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBuilderError(message || 'Failed to generate prompts.');
    } finally {
      setGeneratingPrompts(false);
    }
  }, [applyBuilderValues, builderValues, isTauriEnv]);

  const pollJobStatus = useCallback(async (id) => {
    if (!id || jobIdRef.current !== id) return;
    try {
      const data = await invoke('job_status', { jobId: id });
      if (jobIdRef.current !== id) {
        return;
      }

      const status = typeof data?.status === 'string' ? data.status : '';
      const progressInfo = data?.progress || {};
      const percent =
        typeof progressInfo.percent === 'number'
          ? progressInfo.percent
          : status === 'completed'
            ? 100
            : 0;
      setJobProgress(percent);
      setJobStage(progressInfo.stage || status || '');
      setRenderStatus(progressInfo.message || '');
      setQueuePosition(
        typeof progressInfo.queue_position === 'number'
          ? progressInfo.queue_position
          : null,
      );
      setQueueEtaSeconds(
        typeof progressInfo.queue_eta_seconds === 'number'
          ? progressInfo.queue_eta_seconds
          : null,
      );
      refreshQueue();

      if (status === 'queued' || status === 'running') {
        setRendering(true);
        clearJobPolling();
        pollIntervalRef.current = setTimeout(() => {
          pollJobStatus(id);
        }, JOB_POLL_INTERVAL_MS);
        return;
      }

      clearJobPolling();
      setRendering(false);
      setQueuePosition(null);
      setQueueEtaSeconds(null);
      jobIdRef.current = null;
      setJobId(null);
      setCurrentJobId(String(id));

      const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
      const audioArtifacts = artifacts.filter((artifact) => {
        const path = artifact?.path;
        return typeof path === 'string' && path.toLowerCase().endsWith('.flac');
      });

      const outputs = [];
      for (const artifact of audioArtifacts) {
        const path = artifact.path;
        let url = '';
        try {
          url = fileSrc(path);
        } catch (err) {
          console.warn('Failed to resolve audio output path', err, path);
        }
        outputs.push({
          filename:
            (typeof artifact.name === 'string' && artifact.name) ||
            path.split(/[\/]/).pop() ||
            path,
          path,
          url,
        });
      }

      if (outputs.length === 0) {
        try {
          const fallback = await invoke('stable_audio_output_files', { limit: 6 });
          if (Array.isArray(fallback)) {
            fallback.forEach((entry) => {
              if (typeof entry?.path !== 'string') return;
              const path = entry.path;
              const name =
                (typeof entry?.name === 'string' && entry.name) ||
                path.split(/[\/]/).pop() ||
                path;
              let url = '';
              try {
                url = fileSrc(path);
              } catch (err) {
                console.warn('Failed to resolve fallback audio output path', err, path);
              }
              outputs.push({ filename: name, path, url });
            });
          }
        } catch (err) {
          console.warn('Failed to enumerate Stable Diffusion outputs', err);
        }
      }

      setAudioOutputs(outputs);

      const cancelled = status === 'cancelled' || Boolean(data?.cancelled);
      if (status === 'completed') {
        setRenderStatus(progressInfo.message || 'ComfyUI render complete.');
        setRenderError('');
      } else if (cancelled) {
        setRenderStatus('Stable Diffusion job cancelled.');
        setRenderError('');
      } else {
        const stderrLines = Array.isArray(data?.stderr) ? data.stderr : [];
        let lastError = typeof data?.message === 'string' ? data.message.trim() : '';
        for (let i = stderrLines.length - 1; i >= 0 && !lastError; i -= 1) {
          const line = stderrLines[i];
          if (typeof line === 'string' && line.trim()) {
            lastError = line.trim();
          }
        }
        if (!lastError) {
          lastError = 'Stable Diffusion job failed.';
        }
        setRenderStatus('');
        setRenderError(lastError);
      }

      refreshStatus(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message);
      setRendering(false);
      clearJobPolling();
      refreshStatus(false);
    }
  }, [clearJobPolling, refreshQueue, refreshStatus]);

  const startJobPolling = useCallback((id) => {
    if (!id) return;
    clearJobPolling();
    jobIdRef.current = id;
    pollIntervalRef.current = setTimeout(() => {
      pollJobStatus(id);
    }, 50);
  }, [clearJobPolling, pollJobStatus]);

  const handleRender = useCallback(async () => {
    if (!isTauriEnv || rendering) return;
    setRenderStatus('Queuing Stable Diffusion job...');
    setRenderError('');
    setAudioOutputs([]);
    setJobProgress(0);
    setJobStage('queued');
    setCurrentJobId('');
    try {
      const id = await invoke('queue_stable_audio_job');
      if (typeof id !== 'number' && typeof id !== 'string') {
        throw new Error('Unexpected response when queuing Stable Diffusion job.');
      }
      const numericId = typeof id === 'number' ? id : Number.parseInt(id, 10);
      const resolvedId = Number.isNaN(numericId) ? id : numericId;
      setJobId(resolvedId);
      setRendering(true);
      setRenderStatus('Job queued. Tracking progress...');
      refreshQueue();
      await refreshStatus(true);
      startJobPolling(resolvedId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenderError(message || 'Failed to queue Stable Diffusion job.');
      setRenderStatus('');
      setRendering(false);
    }
  }, [isTauriEnv, refreshQueue, refreshStatus, rendering, startJobPolling]);

const handleSubmit = async (event) => {
    event.preventDefault();
    setStatusMessage('');
    setError('');

    if (!isTauriEnv) {
      setError('Saving prompts requires the desktop app.');
      return;
    }

    const cleanedPrompt = prompt.trim();
    const cleanedNegative = negativePrompt.trim();
    const cleanedFilePrefix = filePrefix.trim() || DEFAULT_FILE_PREFIX;
    const cleanedSeconds = seconds.trim();
    const secondsValue = Number.parseFloat(cleanedSeconds);

    if (!cleanedPrompt) {
      setError('Prompt cannot be empty.');
      return;
    }

    if (!Number.isFinite(secondsValue) || secondsValue <= 0) {
      setError('Seconds must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      const result = await invoke('update_stable_audio_prompts', {
        prompt: cleanedPrompt,
        negativePrompt: cleanedNegative,
        fileNamePrefix: cleanedFilePrefix,
        seconds: secondsValue,
      });
      const savedPrompt = extractPromptField(result, 'prompt') || cleanedPrompt;
      const savedNegative = extractPromptField(result, 'negativePrompt') || cleanedNegative;
      const savedPrefix = extractPromptField(result, 'fileNamePrefix') || cleanedFilePrefix;
      const savedSeconds = extractPromptField(result, 'seconds') || String(secondsValue);
      setPrompt(savedPrompt);
      setNegativePrompt(savedNegative);
      setFilePrefix(savedPrefix);
      setSeconds(savedSeconds);

      const trimmedTemplateName = templateName.trim();
      if (trimmedTemplateName) {
        try {
          const templatesResult = await invoke('save_stable_audio_template', {
            template: {
              name: trimmedTemplateName,
              prompt: savedPrompt,
              negativePrompt: savedNegative,
              fileNamePrefix: savedPrefix,
              seconds: Number.parseFloat(savedSeconds) || secondsValue,
            },
          });
          setTemplates(normalizeTemplates(templatesResult));
          setSelectedTemplate(trimmedTemplateName);
          setTemplateName('');
        } catch (templateErr) {
          const message = templateErr instanceof Error ? templateErr.message : String(templateErr);
          setStatusError(message || 'Failed to save template.');
        }
      }

      setStatusMessage('Workflow prompt settings updated.');
      refreshStatus(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to update Stable Diffusion workflow.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;
  const builderComplete = PROMPT_TEMPLATE_FIELDS.every(({ key }) => {
    const value = builderValues[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
  const templatePositivePreview = buildPositivePreview(builderValues);
  const templateNegativePreview = buildNegativePreview(builderValues);
  const positivePreview = prompt.trim() || templatePositivePreview;
  const negativePreview = negativePrompt.trim() || templateNegativePreview;
  const secondsValueRaw = Number.parseFloat(seconds.trim());
  const secondsValid = Number.isFinite(secondsValueRaw) && secondsValueRaw > 0;
  const submitDisabled = disabled || !isTauriEnv || !prompt.trim() || !secondsValid;
  const generateDisabled = disabled || !isTauriEnv || generatingPrompts || !builderComplete;
  const renderDisabled = !isTauriEnv || rendering;
  const firstBuilderFieldId = `stable-builder-${PROMPT_TEMPLATE_FIELDS[0]?.key || 'mainConcept'}`;
  const promptControlId = isPromptBuilderActive ? firstBuilderFieldId : 'stable-diffusion-prompt';

  return (
    <>
      <BackButton />
      <h1>Stable Diffusion</h1>

            <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1.25rem',
        }}
      >
        <span className="card-caption" style={{ fontWeight: 600 }}>
          Status: {comfyStatus.running ? 'Online' : 'Offline'}{' '}
          {comfyStatus.pending > 0 && `Pending tasks: ${comfyStatus.pending}`}{' '}
          {comfyStatus.runningCount > 0 && `Running: ${comfyStatus.runningCount}`}
        </span>
        {statusError && (
          <span className="card-caption" style={{ color: 'var(--accent)' }}>{statusError}</span>
        )}
        <button type="button" className="back-button" onClick={() => refreshStatus(true)} disabled={!isTauriEnv || isLaunching}>
          {isLaunching ? 'Starting...' : 'Activate'}
        </button>
        <button type="button" className="back-button" onClick={toggleAutoLaunch} disabled={!isTauriEnv}>
          Auto-launch: {autoLaunch ? 'On' : 'Off'}
        </button>
        {jobId && (
          <span className="card-caption">
            Active job id: {jobId}
            {queuePosition !== null && ` · Queue position ${queuePosition + 1}`}
            {queueEtaSeconds !== null && ` · ETA ${formatEta(queueEtaSeconds)}`}
            {jobProgress ? ` · ${Math.round(jobProgress)}%` : ''}
          </span>
        )}
        {currentJobId && (
          <span className="card-caption">Last job id: {currentJobId}</span>
        )}
      </div>

      <JobQueuePanel queue={queue} onCancel={cancelFromQueue} activeId={jobId || undefined} />

      <form
        className="card stable-diffusion-form"
        onSubmit={handleSubmit}
        style={{
          display: 'grid',
          gap: '1.25rem',
          alignItems: 'start',
          width: 'min(95vw, 1400px)',
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label htmlFor="stable-diffusion-template" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Templates</span>
            <select
              id="stable-diffusion-template"
              value={selectedTemplate}
              onChange={handleTemplateSelect}
              disabled={!isTauriEnv || templates.length === 0}
              style={{
                minWidth: '220px',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: `1px solid ${SURFACE_BORDER_COLOR}`,
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            >
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.name} value={template.name}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="stable-diffusion-template-name" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Template Name</span>
            <input
              id="stable-diffusion-template-name"
              type="text"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Save current prompts as..."
              disabled={disabled}
              style={{
                maxWidth: '280px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: `1px solid ${SURFACE_BORDER_COLOR}`,
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="stable-diffusion-prefix" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Filename Prefix</span>
            <input
              id="stable-diffusion-prefix"
              type="text"
              value={filePrefix}
              onChange={(event) => setFilePrefix(event.target.value)}
              disabled={disabled}
              style={{
                maxWidth: '320px',
                width: '100%',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: `1px solid ${SURFACE_BORDER_COLOR}`,
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
          <label htmlFor="stable-diffusion-seconds" className="form-label" style={{ display: 'grid', gap: '0.4rem' }}>
            <span>Duration (seconds)</span>
            <input
              id="stable-diffusion-seconds"
              type="number"
              min="1"
              step="0.1"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              disabled={disabled}
              style={{
                width: '140px',
                padding: '0.7rem 0.85rem',
                borderRadius: '12px',
                border: `1px solid ${SURFACE_BORDER_COLOR}`,
                background: 'var(--card-bg)',
                color: 'var(--text)',
              }}
            />
          </label>
        </div>
        {comfyStatus.pending > 0 && (
          <div style={{ fontWeight: 600 }}>Pending ComfyUI tasks: {comfyStatus.pending}</div>
        )}
        <label htmlFor={promptControlId} className="form-label" style={{ marginBottom: 0 }}>
          Prompt
        </label>
        <div
          style={{
            display: 'grid',
            gap: isPromptBuilderActive ? '1.1rem' : '0.6rem',
            background: 'var(--card-bg)',
            padding: '1.25rem 1.5rem',
            borderRadius: '16px',
            border: `1px solid ${SURFACE_BORDER_COLOR}`,
            boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)',
          }}
        >
          <LabeledToggle
            id="stable-builder-toggle"
            label="Prompt Builder"
            description="Use guided sections to plan the Stable Audio prompt."
            checked={isPromptBuilderActive}
            disabled={disabled}
            onChange={(next) => {
              setIsPromptBuilderActive(next);
              if (next) {
                applyBuilderValues(parseStableAudioPrompt(prompt));
                setBuilderError('');
                setBuilderNotice('');
              } else {
                setBuilderError('');
                setBuilderNotice('');
              }
            }}
          />
          {isPromptBuilderActive ? (
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <p className="card-caption" style={{ margin: 0, color: SUBTLE_TEXT_COLOR }}>
                Fill out each section with short, descriptive phrases. The AI will follow the template when
                generating your prompts.
              </p>
              {PROMPT_TEMPLATE_FIELDS.map(({ key, label, description, placeholder }) => {
                const fieldId = `stable-builder-${key}`;
                const value = builderValues[key] || '';
                return (
                  <div key={key} style={{ display: 'grid', gap: '0.45rem' }}>
                    <label htmlFor={fieldId} className="form-label" style={{ marginBottom: 0 }}>
                      <span style={{ fontWeight: 600 }}>{label}</span>
                      {description ? (
                        <span className="card-caption" style={{ color: SUBTLE_TEXT_COLOR }}>
                          {description}
                        </span>
                      ) : null}
                    </label>
                    <textarea
                      id={fieldId}
                      value={value}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setBuilderValues((prev) => ({ ...prev, [key]: nextValue }));
                        setBuilderError('');
                        setBuilderNotice('');
                      }}
                      placeholder={placeholder}
                      rows={3}
                      style={{
                        ...TEXTAREA_BASE_STYLE,
                        minHeight: '5.25rem',
                        fontSize: '0.95rem',
                        lineHeight: 1.5,
                        resize: 'vertical',
                      }}
                      disabled={disabled}
                    />
                  </div>
                );
              })}
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <div
                  className="card"
                  style={{
                    border: `1px solid ${SURFACE_BORDER_COLOR}`,
                    borderRadius: '14px',
                    padding: '1rem 1.1rem',
                    background: 'var(--card-bg)',
                    display: 'grid',
                    gap: '0.5rem',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Positive prompt preview</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{positivePreview}</p>
                </div>
                <div
                  className="card"
                  style={{
                    border: `1px solid ${SURFACE_BORDER_COLOR}`,
                    borderRadius: '14px',
                    padding: '1rem 1.1rem',
                    background: 'var(--card-bg)',
                    display: 'grid',
                    gap: '0.5rem',
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Negative prompt preview</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{negativePreview}</p>
                </div>
              </div>
              {builderError && (
                <div
                  role="alert"
                  style={{
                    border: '1px solid var(--accent)',
                    borderRadius: '12px',
                    padding: '0.85rem 1rem',
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  }}
                >
                  <p className="card-caption" style={{ margin: 0, color: 'var(--accent)' }}>
                    {builderError}
                  </p>
                </div>
              )}
              {builderNotice && (
                <div
                  role="status"
                  style={{
                    border: `1px solid ${SURFACE_BORDER_COLOR}`,
                    borderRadius: '12px',
                    padding: '0.85rem 1rem',
                  }}
                >
                  <p className="card-caption" style={{ margin: 0 }}>{builderNotice}</p>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <PrimaryButton
                  type="button"
                  loading={generatingPrompts}
                  loadingText="Contacting AI..."
                  disabled={generateDisabled}
                  onClick={handleGeneratePrompts}
                >
                  Generate prompts with AI
                </PrimaryButton>
                <span className="card-caption" style={{ color: SUBTLE_TEXT_COLOR }}>
                  Prompts update below. Save changes before rendering in ComfyUI.
                </span>
              </div>
            </div>
          ) : null}
        </div>
        {!isPromptBuilderActive && (
          <textarea
            id="stable-diffusion-prompt"
            placeholder="Enter audio prompt..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={10}
            style={{
              ...TEXTAREA_BASE_STYLE,
              width: 'min(95vw, 1300px)',
              minHeight: '20rem',
              fontSize: '1.05rem',
              lineHeight: 1.6,
            }}
            disabled={disabled}
          />
        )}
        <label htmlFor="stable-diffusion-negative" className="form-label">
          Negative Prompt
        </label>
        <textarea
          id="stable-diffusion-negative"
          placeholder="Optional negative prompt"
          value={negativePrompt}
          onChange={(event) => setNegativePrompt(event.target.value)}
          rows={8}
          style={{
            ...TEXTAREA_BASE_STYLE,
            width: 'min(95vw, 1300px)',
            minHeight: '12rem',
            fontSize: '1.0rem',
            lineHeight: 1.5,
          }}
          disabled={disabled}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <PrimaryButton type="submit" className="mt-sm" loading={saving} loadingText="Saving prompts..." disabled={submitDisabled}>
            Save Prompts
          </PrimaryButton>
          <PrimaryButton
            type="button"
            className="mt-sm"
            loading={rendering}
            loadingText="Rendering..."
            disabled={renderDisabled}
            onClick={handleRender}
          >
            Render via ComfyUI
          </PrimaryButton>
        </div>
      </form>

      {(statusMessage || renderStatus || jobId || jobStage || queuePosition !== null) && (
        <div className="card" role="status">
          {statusMessage && <p className="card-caption">{statusMessage}</p>}
          {renderStatus && <p className="card-caption">{renderStatus}</p>}
          {(jobId || jobStage || jobProgress || queuePosition !== null || queueEtaSeconds !== null) && (
            <p className="card-caption">
              {jobId && `Job ${jobId}`}
              {jobStage && ` · ${jobStage}`}
              {jobProgress ? ` · ${Math.round(jobProgress)}%` : ''}
              {queuePosition !== null && ` · Queue position ${queuePosition + 1}`}
              {queueEtaSeconds !== null && ` · ETA ${formatEta(queueEtaSeconds)}`}
            </p>
          )}
        </div>
      )}

      {(error || renderError) && (
        <div className="card" role="alert" style={{ border: '1px solid var(--accent)', marginTop: '1rem' }}>
          {error && <p className="card-caption" style={{ color: 'var(--accent)' }}>{error}</p>}
          {renderError && <p className="card-caption" style={{ color: 'var(--accent)' }}>{renderError}</p>}
        </div>
      )}

      {audioOutputs.length > 0 && (
        <section className="card" style={{ display: 'grid', gap: '0.75rem' }}>
          <h2>Latest ComfyUI Output</h2>
          {audioOutputs.map((output, index) => (
            <div key={`${output.path ?? 'output'}-${index}`} style={{ display: 'grid', gap: '0.35rem' }}>
              <strong>{output.filename}</strong>
              <audio controls src={output.url || (output.path ? fileSrc(output.path) : undefined)} />
              {output.path && (
                <span className="card-caption" style={{ wordBreak: 'break-all' }}>{output.path}</span>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}


