import { useState, useCallback, useEffect } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Fusion.css';
import qwenAgentGuide from '../../../assets/agents/qwen_agent.md?raw';
import aceAgentGuide from '../../../assets/agents/ace_agent.md?raw';
import wanAgentGuide from '../../../assets/agents/wan_agent.md?raw';

function extractPromptField(result, key) {
  if (!result || typeof result !== 'object') {
    return '';
  }
  const direct = result[key];
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }
  const snakeKey = key.replace(/([A-Z])/g, '_').toLowerCase();
  const fallback = result[snakeKey];
  if (typeof fallback === 'string' || typeof fallback === 'number') {
    return String(fallback);
  }
  return '';
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
  // Handle fenced code blocks with surrounding content
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    trimmed = trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parseJsonResponse(raw) {
  const cleaned = sanitizeJsonBlock(typeof raw === 'string' ? raw : String(raw ?? ''));
  if (!cleaned) {
    return null;
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse JSON payload', err);
  }
  return null;
}

const AUDIO_PROMPT_TEMPLATE =
  'A {mainConcept} in {genreStyle} featuring {instruments}, evoking a {moodEmotion} vibe inspired by {eraInfluence}. {structureProgression}. {soundDesignMix}. {tempo}.';

const AUDIO_TEMPLATE_KEYS = [
  'mainConcept',
  'genreStyle',
  'instruments',
  'moodEmotion',
  'eraInfluence',
  'structureProgression',
  'soundDesignMix',
  'tempo',
];

function parseAudioPromptPayload(raw) {
  const parsed = parseJsonResponse(raw);
  if (!parsed) {
    console.warn('Failed to parse audio prompt payload as JSON');
  }
  return parsed;
}

const QWEN_AGENT_GUIDE = typeof qwenAgentGuide === 'string' ? qwenAgentGuide.trim() : '';
const ACE_AGENT_GUIDE = typeof aceAgentGuide === 'string' ? aceAgentGuide.trim() : '';
const WAN_AGENT_GUIDE = typeof wanAgentGuide === 'string' ? wanAgentGuide.trim() : '';
const ACE_WORKFLOW_PATH = 'assets/workflows/audio_ace_step_1_t2a_instrumentals.json';
const ACE_DEFAULT_SECONDS = 120;
const ACE_DEFAULT_GUIDANCE = 0.99;
const ACE_DEFAULT_BATCH_SIZE = 1;

const normalizeAudioPlan = (plan) => {
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  const stylePrompt = typeof plan.stylePrompt === 'string' ? plan.stylePrompt.trim() : '';
  const songForm = typeof plan.songForm === 'string' ? plan.songForm.trim() : '';
  const secondsValue = Number(plan.seconds);
  const guidanceValue = Number(plan.guidance);
  const batchValueRaw = Number.parseInt(plan.batchSize, 10);
  const seconds = Number.isFinite(secondsValue) && secondsValue > 0 ? secondsValue : ACE_DEFAULT_SECONDS;
  const guidance =
    Number.isFinite(guidanceValue) && guidanceValue > 0.05 && guidanceValue <= 2 ? guidanceValue : ACE_DEFAULT_GUIDANCE;
  const batchSize = Number.isFinite(batchValueRaw) && batchValueRaw > 0 ? batchValueRaw : ACE_DEFAULT_BATCH_SIZE;
  if (!stylePrompt || !songForm) {
    return null;
  }
  return {
    stylePrompt,
    songForm,
    seconds,
    guidance,
    batchSize,
  };
};

const buildSongFormFromConcepts = (concepts = [], mode = 'lofi') => {
  const labels = ['[intro]', '[verse a]', '[hook]', '[bridge]', '[verse b]', '[solo]', '[outro]'];
  const sanitized = concepts
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .slice(0, labels.length);
  if (sanitized.length === 0) {
    return `[intro] establish the theme with gentle pads
[hook] weave a memorable motif that matches the fusion
[outro] fade with sparkling tape echoes`;
  }
  return sanitized
    .map((concept, idx) => {
      const label = labels[idx] || `[section ${idx + 1}]`;
      const energy =
        mode === 'tiktok'
          ? 'high-energy visuals'
          : idx % 2 === 0
            ? 'softer lo-fi textures'
            : 'uplifted chorus energy';
      return `${label} translate ${concept} into ${energy}`;
    })
    .join('\n');
};

function buildAudioPromptString(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const get = (key) => extractPromptField(payload, key).trim();

  const values = {
    mainConcept: get('mainConcept'),
    genreStyle: get('genreStyle'),
    instruments: get('instruments'),
    moodEmotion: get('moodEmotion'),
    eraInfluence: get('eraInfluence'),
    structureProgression: get('structureProgression') || get('structure'),
    soundDesignMix:
      get('soundDesignMix') ||
      get('soundDesign') ||
      get('mixNotes') ||
      get('texture'),
    tempo: get('tempo'),
  };

  if (!values.mainConcept) {
    const format = get('format');
    const concept = get('concept');
    const style = get('style');
    values.mainConcept = [format, concept || style]
      .map((part) => part && part.trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  if (!values.genreStyle) {
    const genre = get('genre');
    const subGenre = get('subGenre');
    const style = get('style');
    const combo = [genre, subGenre].map((part) => part && part.trim()).filter(Boolean).join(' ');
    values.genreStyle = combo.trim() || style;
  }

  if (!values.instruments) {
    values.instruments = get('instruments');
  }

  if (!values.moodEmotion) {
    values.moodEmotion = get('mood') || get('emotion');
  }

  if (!values.eraInfluence) {
    values.eraInfluence = get('era') || get('influence') || get('style');
  }

  if (!values.structureProgression) {
    values.structureProgression = get('structure') || get('arrangement');
  }

  if (!values.soundDesignMix) {
    const style = get('style');
    const mix = get('mix');
    const tempoDescriptor = get('tempoDescriptor');
    values.soundDesignMix = [get('soundDesign'), mix, style, tempoDescriptor]
      .map((part) => part && part.trim())
      .filter(Boolean)
      .join(', ')
      .trim();
  }

  if (!values.tempo) {
    const tempoDescriptor = get('tempoDescriptor');
    const bpm = get('bpm');
    const duration = get('duration');
    const tempoParts = [];
    if (tempoDescriptor) {
      tempoParts.push(tempoDescriptor);
    }
    if (bpm) {
      const sanitized = bpm.replace(/[^0-9.]/g, '');
      tempoParts.push(`${sanitized || bpm} BPM`);
    }
    if (duration) {
      tempoParts.push(duration);
    }
    values.tempo = tempoParts.join(', ').trim();
  }

  const missing = AUDIO_TEMPLATE_KEYS.some((key) => !values[key]);
  if (missing) {
    return '';
  }

  let prompt = AUDIO_PROMPT_TEMPLATE.replace(/\{(\w+)\}/g, (_, key) => values[key] || '');
  prompt = prompt.replace(/\s+/g, ' ').replace(/\s([,.;])/g, '$1').trim();
  if (prompt && !/[.!?]$/.test(prompt)) {
    prompt = `${prompt}.`;
  }
  return prompt;
}

export default function Fusion() {
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [conceptC, setConceptC] = useState('');
  const [conceptD, setConceptD] = useState('');
  const [mode, setMode] = useState('lofi');
  const [fusionResult, setFusionResult] = useState('');
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [loadingC, setLoadingC] = useState(false);
  const [loadingD, setLoadingD] = useState(false);
  const [loadingFuse, setLoadingFuse] = useState(false);
  const [error, setError] = useState('');
  const [includeNegative, setIncludeNegative] = useState(true);
  const [negativeResult, setNegativeResult] = useState('');
  const [generateAudioPrompt, setGenerateAudioPrompt] = useState(false);
  const [audioPromptResult, setAudioPromptResult] = useState('');
  const [generateWanPrompt, setGenerateWanPrompt] = useState(false);
  const [wanPromptResult, setWanPromptResult] = useState('');
  const [audioWorkflowPlan, setAudioWorkflowPlan] = useState(null);
  const [history, setHistory] = useState([]); // [{a,b,prompt,negative,audioPrompt,candidates?,ts}]
  const [promptCandidates, setPromptCandidates] = useState([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [statusInfo, setStatusInfo] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [stepsInput, setStepsInput] = useState('');
  const [batchSizeInput, setBatchSizeInput] = useState('');
  const [sceneMeta, setSceneMeta] = useState(null);
  const [useQwen, setUseQwen] = useState(false);
  const [useEchozen, setUseEchozen] = useState(false);

  const HISTORY_KEY = 'blossom.fusion.history';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tauri = await isTauri();
        if (!cancelled) {
          setIsTauriEnv(Boolean(tauri));
        }
      } catch {
        if (!cancelled) {
          setIsTauriEnv(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load recent fusion history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map((entry) => {
            const rawConcepts = Array.isArray(entry?.concepts)
              ? entry.concepts
              : [entry?.a, entry?.b, entry?.c, entry?.d];
            const concepts = rawConcepts
              .map((value) => (typeof value === 'string' ? value.trim() : ''))
              .filter(Boolean)
              .slice(0, 4);
            const audioPlan = normalizeAudioPlan(entry?.audioPlan);
            return {
              ...entry,
              mode: entry?.mode === 'tiktok' ? 'tiktok' : 'lofi',
              audioPrompt: typeof entry?.audioPrompt === 'string' ? entry.audioPrompt.trim() : '',
              concepts,
              useQwen: Boolean(entry?.useQwen),
              useEchozen: Boolean(entry?.useEchozen),
              audioPlan,
              wanPrompt: typeof entry?.wanPrompt === 'string' ? entry.wanPrompt.trim() : '',
            };
          });
          setHistory(normalized);
        }
      }
    } catch {}
  }, []);

  const persistHistory = (next) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 20)));
    } catch {}
  };

  const randomSeed = useCallback(() => Math.floor(Math.random() * 1_000_000_000), []);

  const randomTemperature = useCallback((min = 0.65, max = 0.95) => {
    const value = min + Math.random() * (max - min);
    return Number(value.toFixed(2));
  }, []);

  const closeDialog = useCallback(() => {
    setIsDialogOpen(false);
    setDialogError('');
    setDialogLoading(false);
    setSceneMeta(null);
    setStepsInput('');
    setBatchSizeInput('');
  }, []);

  const openGenerateModal = useCallback(async () => {
    const trimmedPrompt = fusionResult.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (!isTauriEnv) {
      setStatusInfo({
        type: 'warning',
        content: 'Image generation is only available in the Blossom desktop app.',
      });
      return;
    }
    setIsDialogOpen(true);
    setDialogLoading(true);
    setDialogError('');
    setSceneMeta(null);
    setStepsInput('20');
    setBatchSizeInput('1');
    try {
      const result = await invoke('get_lofi_scene_prompts');
      const fetchedSteps = extractPromptField(result, 'steps') || '20';
      const fetchedBatch = extractPromptField(result, 'batchSize') || '1';
      const fetchedSeed = extractPromptField(result, 'seed') || '0';
      const fetchedSeedBehavior = extractPromptField(result, 'seedBehavior') || 'fixed';
      const fetchedCfg = extractPromptField(result, 'cfg') || '2.5';
      const fetchedPrefix = extractPromptField(result, 'fileNamePrefix') || 'LofiScene';
      setStepsInput(fetchedSteps);
      setBatchSizeInput(fetchedBatch);
      setSceneMeta({
        seed: fetchedSeed,
        seedBehavior: fetchedSeedBehavior,
        cfg: fetchedCfg,
        fileNamePrefix: fetchedPrefix,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDialogError(message || 'Failed to load current workflow settings.');
      setStepsInput((prev) => prev || '20');
      setBatchSizeInput((prev) => prev || '1');
    } finally {
      setDialogLoading(false);
    }
  }, [fusionResult, isTauriEnv]);

  const confirmGenerate = useCallback(async () => {
    const trimmedPrompt = fusionResult.trim();
    if (!trimmedPrompt) {
      setDialogError('A fusion prompt is required to queue an image render.');
      return;
    }
    if (!isTauriEnv) {
      closeDialog();
      setStatusInfo({
        type: 'warning',
        content: 'Image generation is only available in the Blossom desktop app.',
      });
      return;
    }

    const parsedSteps = Number.parseInt(String(stepsInput || '').trim(), 10);
    if (!Number.isFinite(parsedSteps) || parsedSteps <= 0) {
      setDialogError('Steps must be a positive integer.');
      return;
    }

    const parsedBatch = Number.parseInt(String(batchSizeInput || '').trim(), 10);
    if (!Number.isFinite(parsedBatch) || parsedBatch <= 0) {
      setDialogError('Batch size must be a positive integer.');
      return;
    }

    const parseInteger = (value, fallback) => {
      const result = Number.parseInt(String(value ?? '').trim(), 10);
      return Number.isFinite(result) ? result : fallback;
    };

    const parseNumber = (value, fallback) => {
      const result = Number(value);
      return Number.isFinite(result) ? result : fallback;
    };

    const existing = sceneMeta || {};
    const payload = {
      prompt: trimmedPrompt,
      negativePrompt: includeNegative ? negativeResult.trim() : '',
      steps: parsedSteps,
      batchSize: parsedBatch,
      seed: parseInteger(existing.seed, 0),
      seedBehavior:
        typeof existing.seedBehavior === 'string' && existing.seedBehavior.trim()
          ? existing.seedBehavior.trim()
          : 'fixed',
      cfg: parseNumber(existing.cfg, 2.5),
      fileNamePrefix:
        typeof existing.fileNamePrefix === 'string' && existing.fileNamePrefix.trim()
          ? existing.fileNamePrefix.trim()
          : 'LofiScene',
    };

    setStatusInfo(null);
    setDialogLoading(true);
    setDialogError('');
    try {
      await invoke('update_lofi_scene_prompts', { payload });
      let imageQueued = false;
      let imageStatusNode = null;
      try {
        await invoke('queue_lofi_scene_job');
        imageQueued = true;
        imageStatusNode = (
          <span>
            Image render queued!{' '}
            <a
              href="#/visual-generator/lofi-scene-maker"
              style={{ color: 'inherit', textDecoration: 'underline' }}
            >
              Open job queue
            </a>
          </span>
        );
      } catch (queueError) {
        const queueMessage = queueError instanceof Error ? queueError.message : String(queueError);
        imageStatusNode = (
          <span>
            Prompts saved but failed to queue the image render: {queueMessage}
          </span>
        );
      }

      let audioQueued = false;
      let audioStatusNode = null;
      if (generateAudioPrompt) {
        if (!audioWorkflowPlan || !audioWorkflowPlan.stylePrompt || !audioWorkflowPlan.songForm) {
          audioStatusNode = (
            <span>
              Audio render skipped: generate a new fusion with the audio option enabled to prepare an ACE plan.
            </span>
          );
        } else {
          try {
            await invoke('update_ace_workflow_prompts', {
              update: {
                stylePrompt: audioWorkflowPlan.stylePrompt,
                songForm: audioWorkflowPlan.songForm,
                seconds: audioWorkflowPlan.seconds,
                batchSize: audioWorkflowPlan.batchSize,
                guidance: audioWorkflowPlan.guidance,
              },
            });
            await invoke('queue_ace_audio_job');
            audioQueued = true;
            audioStatusNode = (
              <span>
                ACE audio render queued via {ACE_WORKFLOW_PATH}.
              </span>
            );
          } catch (audioError) {
            const audioMessage = audioError instanceof Error ? audioError.message : String(audioError);
            audioStatusNode = (
              <span>
                Audio job failed: {audioMessage}
              </span>
            );
          }
        }
      }

      const messageNodes = [imageStatusNode, audioStatusNode].filter(Boolean);
      const combinedContent =
        messageNodes.length <= 1 ? (
          messageNodes[0] || null
        ) : (
          <span>
            {messageNodes.map((node, idx) => (
              <span
                key={`status-chunk-${idx}`}
                style={{ display: 'block', marginBottom: idx < messageNodes.length - 1 ? '0.35rem' : 0 }}
              >
                {node}
              </span>
            ))}
          </span>
        );
      const statusType = (() => {
        if (!imageQueued) return 'error';
        if (generateAudioPrompt && !audioQueued) return 'warning';
        return 'success';
      })();
      if (combinedContent) {
        setStatusInfo({
          type: statusType,
          content: combinedContent,
        });
      }

      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDialogError(message || 'Failed to update workflow prompts.');
    } finally {
      setDialogLoading(false);
    }
  }, [
    audioWorkflowPlan,
    batchSizeInput,
    closeDialog,
    fusionResult,
    generateAudioPrompt,
    generateWanPrompt,
    includeNegative,
    isTauriEnv,
    negativeResult,
    sceneMeta,
    stepsInput,
  ]);

  const copyText = async (text) => {
    const str = String(text || '');
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(str);
      } else {
        const ta = document.createElement('textarea');
        ta.value = str;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {}
  };

  const randomConcept = useCallback(async (slot) => {
    const slotMap = {
      A: { setLoading: setLoadingA, setConcept: setConceptA },
      B: { setLoading: setLoadingB, setConcept: setConceptB },
      C: { setLoading: setLoadingC, setConcept: setConceptC },
      D: { setLoading: setLoadingD, setConcept: setConceptD },
    };
    const target = slotMap[slot];
    if (!target) {
      return;
    }
    const { setLoading, setConcept } = target;
    setLoading(true);
    setError('');
    try {
      const isTikTok = mode === 'tiktok';
      const system = isTikTok
        ? 'Return ONE outrageous hook for an AI-generated short-form video concept. Keep it under 6 words. No punctuation, no numbering. Examples: "hypercolor slime tornado", "glitter cyclone rave", "laser llama flashmob".'
        : 'Return ONE short, creative concept for image generation. 1-4 words. No punctuation. No quotes. No numbering. Examples: "neon koi", "clockwork forest", "crystal dunes".';
      const prompt = isTikTok
        ? 'Invent a scroll-stopping TikTok-worthy AI video concept.'
        : 'Generate a random concept.';
      const temperature = randomTemperature(0.75, 1.05);
      const seed = randomSeed();
      let text = await invoke('generate_llm', { prompt, system, temperature, seed });
      text = String(text || '').split('\n')[0].trim();
      text = text.replace(/^\d+\.\s*/, '').replace(/^[\-\s]+/, '');
      text = text.replace(/^"|"$/g, '');
      text = text.replace(/[.,;:!?]+$/g, '');
      setConcept(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, randomSeed, randomTemperature]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedConcepts = [conceptA, conceptB, conceptC, conceptD].map((value) => value.trim());
    const conceptEntries = trimmedConcepts.map((value, idx) => ({
      id: String.fromCharCode(65 + idx),
      value,
    }));
    const activeConcepts = conceptEntries.filter((entry) => entry.value);
    setError('');
    setStatusInfo(null);
    setNegativeResult('');
    setPromptCandidates([]);
    setSelectedCandidateIndex(0);
    setAudioPromptResult('');
    setAudioWorkflowPlan(null);
    setWanPromptResult('');
    if (activeConcepts.length === 0) {
      setFusionResult('Enter concepts to explore their fusion.');
      return;
    }
    if (activeConcepts.length === 1) {
      setFusionResult('Add at least two concepts to complete the fusion.');
      return;
    }
    setLoadingFuse(true);
    try {
      const isTikTok = mode === 'tiktok';
      const conceptLines = activeConcepts.map((entry) => `Concept ${entry.id}: ${entry.value}`).join('\n');
      const conceptHistoryPayload = activeConcepts.map((entry) => entry.value).slice(0, 4);
      const [a, b] = conceptHistoryPayload;
      const qwenSystemPrefix = useQwen && QWEN_AGENT_GUIDE ? `${QWEN_AGENT_GUIDE}\n\n` : '';
      const qwenPositiveHint = useQwen
        ? 'Follow the Qwen prompt engineering guidance above: use natural sentences, cover subject, setting, style, lighting, and quote any exact text.'
        : '';
      const echozenPositiveHint = useEchozen
        ? 'Ensure the prompt clearly states that the word "Echozen" appears visibly on signage, clothing, instruments, or props within the scene.'
        : '';
      const system = `${qwenSystemPrefix}${
        isTikTok
          ? 'You are Blossom, an excitable creative assistant. Devise ONE high-energy, absurd text prompt that sells an AI-generated short-form video idea blending the provided concepts. Make it punchy, vertical-video ready, and full of motion, hooks, and spectacle. Keep it to one paragraph (45-80 words). Avoid artist names, trademarks, numbered lists, or quotation marks.'
          : 'You are Blossom, a helpful creative assistant. Compose a single vivid text-to-image prompt that fuses the provided concepts. Constraints: one paragraph (~50-90 words); describe subject, style, mood, lighting, composition, materials, color palette; avoid artist names and trademarks; do not mention the words "fusion" or "concept"; no lists; no quotes.'
      }`;
      const promptSections = [
        conceptLines,
        isTikTok
          ? 'Invent one outrageous AI video idea ready for a viral short.'
          : 'Write one coherent prompt.',
        qwenPositiveHint,
        echozenPositiveHint,
      ].filter(Boolean);
      const prompt = promptSections.join('\n');
      const enforceEchozen = (raw) => {
        const trimmed = String(raw || '').trim();
        if (!trimmed) {
          return '';
        }
        if (!useEchozen) {
          return trimmed;
        }
        if (/echozen/i.test(trimmed)) {
          return trimmed;
        }
        const suffix = trimmed.endsWith('.') ? '' : '.';
        return `${trimmed}${suffix} Include the word "Echozen" prominently on signage, clothing, or props.`;
      };
      const candidateConfigs = Array.from({ length: 3 }, () => ({
        temperature: randomTemperature(0.65, 0.95),
        seed: randomSeed(),
      }));
      const candidateResults = [];
      for (const config of candidateConfigs) {
        try {
          const response = await invoke('generate_llm', {
            prompt,
            system,
            temperature: config.temperature,
            seed: config.seed,
          });
          const cleaned = String(response || '').trim();
          const withEchozen = enforceEchozen(cleaned);
          if (cleaned) {
            candidateResults.push({ ...config, text: withEchozen });
          }
        } catch (candidateError) {
          console.error('fusion candidate failed', candidateError);
        }
      }
      const uniqueCandidates = [];
      const seen = new Set();
      for (const candidate of candidateResults) {
        const normalized = candidate.text;
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        uniqueCandidates.push(candidate);
      }
      if (uniqueCandidates.length === 0) {
        throw new Error('Failed to generate fusion prompt candidates.');
      }
      setPromptCandidates(uniqueCandidates);
      setSelectedCandidateIndex(0);
      const main = uniqueCandidates[0].text;
      setFusionResult(main);

      let negative = '';
      if (includeNegative) {
        const negSystem = `${qwenSystemPrefix}${
          isTikTok
            ? 'You are Blossom, an exacting creative assistant. Produce a compact negative prompt for AI-generated video frames matching the given fusion concepts. Output a single line of comma-separated visual issues to avoid (e.g., "muddy motion, frame tearing, awkward limbs, text overlays, compression artifacts"). Do not include quotes or explanations.'
            : 'You are Blossom, a helpful creative assistant. Produce a compact negative prompt for text-to-image diffusion matching the given fusion concepts. Output a single line of comma-separated terms describing artifacts and traits to avoid (e.g., "blurry, extra limbs, low contrast, text, watermark, jpeg artifacts"). Do not include quotes or explanations.'
        }`;
        const negPromptSections = [
          conceptLines,
          isTikTok
            ? 'Negative prompt only, single line tuned for clean, cinematic AI video frames.'
            : 'Negative prompt only, single line.',
          useQwen
            ? 'Apply the Qwen negative prompt tips above: focus on concrete issues, avoid bloated generic lists.'
            : '',
          useEchozen
            ? 'Do not remove or blur signage containing the word "Echozen"; keep that text intact while avoiding other visual issues.'
            : '',
        ].filter(Boolean);
        const negPrompt = negPromptSections.join('\n');
        const neg = await invoke('generate_llm', {
          prompt: negPrompt,
          system: negSystem,
          temperature: randomTemperature(0.3, 0.55),
          seed: randomSeed(),
        });
        negative = String(neg || '').replace(/[\r\n]+/g, ' ').trim();
        setNegativeResult(negative);
      }

      let audioPrompt = '';
      let audioPlanPayload = null;
      if (generateAudioPrompt) {
        const aceGuidePrefix = ACE_AGENT_GUIDE ? `${ACE_AGENT_GUIDE}\n\n` : '';
        const audioSystem = `${aceGuidePrefix}You are Blossom's ACE-Step music director. Reference the workflow file ${ACE_WORKFLOW_PATH}. Respond ONLY with JSON containing the keys mainConcept, genreStyle, instruments, moodEmotion, eraInfluence, structureProgression, soundDesignMix, tempo, songForm, seconds, guidance, and batchSize. Use natural language phrases (no arrays) for descriptive fields. "songForm" must be a multi-line blueprint using bracketed section tags (e.g., "[intro]", "[hook lift]"). Keep seconds between 20 and 180. Keep guidance between 0.6 and 1.2 for chill mode and up to 1.4 for TikTok mode. Batch size should be 1 or 2. No explanations outside the JSON.`;
        const audioPromptInput = `${conceptLines}
Mode: ${isTikTok ? 'TikTok high-energy instrumental promoting motion-friendly hooks.' : 'Lo-fi chill instrumental focused on vibe and atmosphere.'}
Task: Compose an ACE-Step instrumental plan that fuses every concept above. The JSON must fill every descriptive field, include BPM inside "tempo", and provide a vivid "songForm" blueprint with bracketed sections plus one-sentence instructions per section.`;
        try {
          const audioResponse = await invoke('generate_llm', {
            prompt: audioPromptInput,
            system: audioSystem,
            temperature: randomTemperature(0.55, 0.85),
            seed: randomSeed(),
          });
          const cleanedAudio = String(audioResponse || '').trim();
          if (cleanedAudio) {
            const parsedAudio = parseAudioPromptPayload(cleanedAudio);
            const synthesized = buildAudioPromptString(parsedAudio);
            const finalAudio = (synthesized || cleanedAudio).trim();
            audioPrompt = finalAudio;
            setAudioPromptResult(finalAudio);
            const rawSongForm =
              extractPromptField(parsedAudio, 'songForm') ||
              buildSongFormFromConcepts(conceptHistoryPayload, mode);
            const planCandidate = normalizeAudioPlan({
              stylePrompt: finalAudio,
              songForm: rawSongForm,
              seconds: extractPromptField(parsedAudio, 'seconds'),
              guidance: extractPromptField(parsedAudio, 'guidance'),
              batchSize: extractPromptField(parsedAudio, 'batchSize'),
            });
            const fallbackPlan =
              planCandidate ||
              normalizeAudioPlan({
                stylePrompt: finalAudio,
                songForm: rawSongForm || buildSongFormFromConcepts(conceptHistoryPayload, mode),
                seconds: ACE_DEFAULT_SECONDS,
                guidance: ACE_DEFAULT_GUIDANCE,
                batchSize: ACE_DEFAULT_BATCH_SIZE,
              });
            setAudioWorkflowPlan(fallbackPlan);
            audioPlanPayload = fallbackPlan;
          } else {
            setAudioWorkflowPlan(null);
          }
        } catch (audioError) {
          console.error('fusion audio prompt failed', audioError);
          setAudioWorkflowPlan(null);
        }
      }

      let wanPrompt = '';
      if (generateWanPrompt) {
        const wanGuidePrefix = WAN_AGENT_GUIDE ? `${WAN_AGENT_GUIDE}\n\n` : '';
        const wanSystem = `${wanGuidePrefix}You are Blossom's Wan video director. Craft structured Wan text-to-video prompts using the Subject + Scene + Motion + Camera + Atmosphere + Style frameworks described above. Respond ONLY with JSON containing two string fields: "prompt" (80-120 words, natural language) and "negative" (comma-separated issues to avoid, no numbering).`;
        const wanPromptInput = `${conceptLines}
Mode: ${isTikTok ? 'High-energy vertical Wan clip with fast motion and kinetic camera.' : 'Cinematic lo-fi Wan clip with relaxed pacing and atmospheric lighting.'}
Requirements: Mention shot sizes, camera moves, motion verbs, lighting, atmosphere, style, duration (4-6 seconds), fps (18-24), and any dialogue or ambient cues if relevant. Close with payoff imagery.`;
        try {
          const wanResponse = await invoke('generate_llm', {
            prompt: wanPromptInput,
            system: wanSystem,
            temperature: randomTemperature(0.55, 0.85),
            seed: randomSeed(),
          });
          const parsedWan = parseJsonResponse(wanResponse);
          const wanPositive = extractPromptField(parsedWan, 'prompt') || String(wanResponse || '').trim();
          const wanNegative =
            extractPromptField(parsedWan, 'negative') ||
            extractPromptField(parsedWan, 'negativePrompt') ||
            '';
          const composedWan = [wanPositive.trim(), wanNegative ? `NEGATIVE: ${wanNegative.trim()}` : '']
            .filter(Boolean)
            .join('\n\n');
          wanPrompt = composedWan.trim();
          setWanPromptResult(wanPrompt);
        } catch (wanError) {
          console.error('fusion WAN prompt failed', wanError);
        }
      }

      const entry = {
        concepts: conceptHistoryPayload,
        a: a || '',
        b: b || '',
        c: conceptHistoryPayload[2] || '',
        d: conceptHistoryPayload[3] || '',
        prompt: main,
        negative,
        audioPrompt,
        audioPlan: audioPlanPayload || null,
        wanPrompt,
        candidates: uniqueCandidates.map((c) => ({
          text: c.text,
          temperature: c.temperature,
          seed: c.seed,
        })),
        mode,
        useQwen,
        useEchozen,
        ts: Date.now(),
      };
      const next = [entry, ...history].slice(0, 20);
      setHistory(next);
      persistHistory(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFuse(false);
    }
  };

  const conceptInputConfig = [
    { id: 'A', label: 'First concept', value: conceptA, setValue: setConceptA, loading: loadingA },
    { id: 'B', label: 'Second concept', value: conceptB, setValue: setConceptB, loading: loadingB },
    { id: 'C', label: 'Third concept (optional)', value: conceptC, setValue: setConceptC, loading: loadingC },
    { id: 'D', label: 'Fourth concept (optional)', value: conceptD, setValue: setConceptD, loading: loadingD },
  ];

  const trimmedFusionPrompt = fusionResult.trim();
  const trimmedAudioPrompt = audioPromptResult.trim();
  const trimmedWanPrompt = wanPromptResult.trim();
  const isGenerateDisabled = loadingFuse || !trimmedFusionPrompt || dialogLoading || isDialogOpen;
  const generateButtonLabel = generateAudioPrompt ? 'Generate Image & Audio' : 'Generate Image';

  const statusPalette = {
    success: { border: 'rgba(34, 197, 94, 0.45)', background: 'rgba(34, 197, 94, 0.12)' },
    warning: { border: 'rgba(250, 204, 21, 0.55)', background: 'rgba(250, 204, 21, 0.12)' },
    error: { border: 'rgba(248, 113, 113, 0.55)', background: 'rgba(248, 113, 113, 0.12)' },
    default: { border: 'rgba(148, 163, 184, 0.35)', background: 'rgba(148, 163, 184, 0.12)' },
  };
  const statusStyle = statusInfo ? statusPalette[statusInfo.type] || statusPalette.default : null;

  return (
    <div className="fusion">
      <BackButton />
      <h1>Fusion</h1>
      <div className="fusion-mode-toggle" role="group" aria-label="Fusion style">
        {[
          { value: 'lofi', label: 'Lo-fi' },
          { value: 'tiktok', label: 'TikTok hype' },
        ].map((option) => {
          const isActive = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              className={`fusion-mode-option${isActive ? ' is-active' : ''}`}
              onClick={() => setMode(option.value)}
              aria-pressed={isActive}
              disabled={loadingFuse}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <form className="fusion-form" onSubmit={handleSubmit}>
        <div className="fusion-controls">
          {conceptInputConfig.map((concept) => (
            <div key={concept.id} className="fusion-concept-group">
              <input
                className="fusion-input"
                type="text"
                placeholder={concept.label}
                aria-label={concept.label}
                value={concept.value}
                onChange={(event) => concept.setValue(event.target.value)}
              />
              <button
                className="fusion-button"
                type="button"
                onClick={() => randomConcept(concept.id)}
                disabled={concept.loading || loadingFuse}
                title={`Generate a random idea for ${concept.label.toLowerCase()}`}
              >
                {concept.loading ? '…' : 'Random'}
              </button>
            </div>
          ))}
          <button className="fusion-button fusion-fuse-button" type="submit" disabled={loadingFuse}>
            {loadingFuse ? 'Fusing…' : 'FUSE'}
          </button>
        </div>
      </form>
      <div
        className="fusion-options"
        role="group"
        aria-label="Fusion tools"
        style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
      >
        <span style={{ fontWeight: 600, marginRight: '0.25rem' }}>Tools</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={includeNegative}
            onChange={(e) => setIncludeNegative(e.target.checked)}
            disabled={loadingFuse}
          />
          Include negative prompt
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={generateAudioPrompt}
            onChange={(e) => {
              const checked = e.target.checked;
              setGenerateAudioPrompt(checked);
              if (!checked) {
                setAudioPromptResult('');
                setAudioWorkflowPlan(null);
              }
            }}
            disabled={loadingFuse}
          />
          Generate audio prompt
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={generateWanPrompt}
            onChange={(e) => {
              const checked = e.target.checked;
              setGenerateWanPrompt(checked);
              if (!checked) {
                setWanPromptResult('');
              }
            }}
            disabled={loadingFuse}
          />
          Generate WAN prompt
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={useQwen}
            onChange={(e) => setUseQwen(e.target.checked)}
            disabled={loadingFuse}
          />
          Use Qwen guide
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={useEchozen}
            onChange={(e) => setUseEchozen(e.target.checked)}
            disabled={loadingFuse}
          />
          Use Echozen
        </label>
      </div>
      <div
        className="fusion-output"
        role="status"
        aria-live="polite"
      >
        {error ? (
          <span style={{ color: 'var(--accent)' }}>Error: {error}</span>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                Prompt · {mode === 'tiktok' ? 'TikTok energy' : 'Lo-fi atmosphere'}
              </div>
              {promptCandidates.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    marginBottom: '0.4rem',
                  }}
                >
                  {promptCandidates.map((candidate, idx) => {
                    const isActive = idx === selectedCandidateIndex;
                    const hasTemp = typeof candidate.temperature === 'number';
                    const hasSeed = typeof candidate.seed === 'number';
                    const tempLabel = hasTemp
                      ? Number(candidate.temperature).toFixed(2)
                      : undefined;
                    return (
                      <button
                        key={`candidate-${idx}-${candidate.seed || idx}`}
                        type="button"
                        className="p-sm"
                        style={{
                          borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                          background: isActive ? 'var(--accent)' : 'transparent',
                          color: isActive ? '#101010' : 'inherit',
                        }}
                        aria-pressed={isActive}
                        onClick={() => {
                          setSelectedCandidateIndex(idx);
                          setFusionResult(candidate.text || '');
                        }}
                      >
                        <div>
                          Option {idx + 1}{' '}
                          <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                            {mode === 'tiktok' ? 'Hype blend' : 'Chill blend'}
                          </span>
                        </div>
                        {(hasTemp || hasSeed) && (
                          <div style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                            {hasTemp ? `T=${tempLabel}` : ''}
                            {hasTemp && hasSeed ? ' · ' : ''}
                            {hasSeed ? `Seed ${candidate.seed}` : ''}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea readOnly value={fusionResult} rows={5} style={{ width: '100%', resize: 'vertical' }} />
              <div style={{ marginTop: '0.25rem' }}>
                <button type="button" className="p-sm" onClick={() => copyText(fusionResult)} disabled={!fusionResult}>Copy</button>
              </div>
            </div>
            {includeNegative && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Negative Prompt</div>
                <textarea readOnly value={negativeResult} rows={3} style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ marginTop: '0.25rem' }}>
                  <button type="button" className="p-sm" onClick={() => copyText(negativeResult)} disabled={!negativeResult}>Copy</button>
                </div>
              </div>
            )}
            {trimmedAudioPrompt && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Audio Prompt</div>
                <textarea readOnly value={audioPromptResult} rows={4} style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ marginTop: '0.25rem' }}>
                  <button
                    type="button"
                    className="p-sm"
                    onClick={() => copyText(audioPromptResult)}
                    disabled={!trimmedAudioPrompt}
                  >
                    Copy
                  </button>
                </div>
                {audioWorkflowPlan?.songForm && (
                  <div style={{ marginTop: '0.65rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>ACE Song Form Plan</div>
                    <textarea
                      readOnly
                      value={audioWorkflowPlan.songForm}
                      rows={4}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </div>
                )}
                {audioWorkflowPlan && (
                  <div style={{ marginTop: '0.4rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                    <span>Seconds: {audioWorkflowPlan.seconds}</span>
                    <span>Guidance: {audioWorkflowPlan.guidance}</span>
                    <span>Batch size: {audioWorkflowPlan.batchSize}</span>
                  </div>
                )}
              </div>
            )}
            {trimmedWanPrompt && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>WAN Prompt</div>
                <textarea readOnly value={wanPromptResult} rows={4} style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ marginTop: '0.25rem' }}>
                  <button
                    type="button"
                    className="p-sm"
                    onClick={() => copyText(wanPromptResult)}
                    disabled={!trimmedWanPrompt}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1', marginTop: '0.25rem' }}>
              <button
                type="button"
                className="p-sm"
                onClick={openGenerateModal}
                disabled={isGenerateDisabled}
                style={{
                  width: '100%',
                  padding: '0.85rem 1rem',
                  fontSize: '1rem',
                  fontWeight: 600,
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: isGenerateDisabled ? 'rgba(148, 163, 184, 0.12)' : 'var(--accent)',
                  color: isGenerateDisabled ? 'rgba(148, 163, 184, 0.8)' : '#101010',
                  cursor: isGenerateDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {generateButtonLabel}
              </button>
            </div>
          </div>
        )}
      </div>
      {statusInfo?.content && (
        <div
          role="status"
          style={{
            marginTop: '0.85rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '12px',
            border: `1px solid ${statusStyle?.border || 'rgba(148, 163, 184, 0.35)'}`,
            background: statusStyle?.background || 'rgba(148, 163, 184, 0.12)',
            color: 'inherit',
          }}
        >
          {statusInfo.content}
        </div>
      )}
      {isDialogOpen && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            zIndex: 50,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fusion-generate-title"
            style={{
              width: 'min(520px, 100%)',
              background: 'var(--card-bg, #0f172a)',
              color: 'var(--text, #e2e8f0)',
              borderRadius: '16px',
              boxShadow: '0 22px 65px rgba(15, 23, 42, 0.55)',
              padding: '1.6rem',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <h2 id="fusion-generate-title" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
              Ready to render?
            </h2>
            <p style={{ margin: '0 0 1rem', lineHeight: 1.5 }}>
              Blossom will update the Lofi Scene Maker workflow with this prompt and queue it for ComfyUI rendering.
            </p>
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Prompt</div>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '0.75rem',
                    whiteSpace: 'pre-wrap',
                    background: 'rgba(15, 23, 42, 0.25)',
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                  }}
                >
                  {trimmedFusionPrompt}
                </div>
              </div>
              {includeNegative && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Negative prompt</div>
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      padding: '0.65rem',
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(15, 23, 42, 0.25)',
                      fontSize: '0.9rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {negativeResult.trim() || 'Negative prompt is empty.'}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontWeight: 600 }}>Steps</span>
                  <input
                    type="number"
                    min="1"
                    value={stepsInput}
                    onChange={(event) => setStepsInput(event.target.value)}
                    disabled={dialogLoading}
                    style={{
                      padding: '0.6rem 0.75rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--card-bg, #0f172a)',
                      color: 'var(--text, #e2e8f0)',
                    }}
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontWeight: 600 }}>Batch size</span>
                  <input
                    type="number"
                    min="1"
                    value={batchSizeInput}
                    onChange={(event) => setBatchSizeInput(event.target.value)}
                    disabled={dialogLoading}
                    style={{
                      padding: '0.6rem 0.75rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border)',
                      background: 'var(--card-bg, #0f172a)',
                      color: 'var(--text, #e2e8f0)',
                    }}
                  />
                </label>
              </div>
              {dialogLoading && sceneMeta === null && !dialogError && (
                <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Loading current workflow settings…</div>
              )}
              {dialogError && (
                <div style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>Error: {dialogError}</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="p-sm"
                onClick={closeDialog}
                disabled={dialogLoading && sceneMeta !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="p-sm"
                onClick={confirmGenerate}
                disabled={dialogLoading}
                style={{
                  background: dialogLoading ? 'rgba(148, 163, 184, 0.2)' : 'var(--accent)',
                  color: dialogLoading ? 'rgba(148, 163, 184, 0.85)' : '#101010',
                  border: '1px solid var(--accent)',
                  fontWeight: 600,
                }}
              >
                {dialogLoading ? 'Submitting…' : 'Confirm & render'}
              </button>
            </div>
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div className="fusion-history" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Recent fusions</h2>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {history.map((h, idx) => {
              const historyConcepts = (Array.isArray(h.concepts) && h.concepts.length > 0
                ? h.concepts
                : [h.a, h.b, h.c, h.d]
              )
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean);
              const displayConcepts = historyConcepts.length > 0 ? historyConcepts : ['(missing concepts)'];
              return (
                <div key={h.ts + ':' + idx} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem' }}>
                  <div style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {displayConcepts.map((concept, conceptIdx) => (
                      <span key={`${concept}:${conceptIdx}`}>
                        <strong>{concept}</strong>
                        {conceptIdx < displayConcepts.length - 1 ? ' + ' : ''}
                      </span>
                    ))}
                  </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="p-sm"
                    onClick={() => {
                      const entryMode = h.mode === 'tiktok' ? 'tiktok' : 'lofi';
                      setMode(entryMode);
                      const fallbackConcepts = Array.isArray(h.concepts) && h.concepts.length > 0
                        ? h.concepts
                        : [h.a, h.b, h.c, h.d];
                      const normalizedConcepts = fallbackConcepts
                        .map((value) => (typeof value === 'string' ? value.trim() : ''))
                        .slice(0, 4);
                      setConceptA(normalizedConcepts[0] || '');
                      setConceptB(normalizedConcepts[1] || '');
                      setConceptC(normalizedConcepts[2] || '');
                      setConceptD(normalizedConcepts[3] || '');
                      setUseQwen(Boolean(h.useQwen));
                      setUseEchozen(Boolean(h.useEchozen));
                      const candidates = Array.isArray(h.candidates) && h.candidates.length > 0
                        ? h.candidates.map((c) =>
                            typeof c === 'string'
                              ? { text: c }
                              : {
                                  text: c.text,
                                  temperature: typeof c.temperature === 'number' ? c.temperature : undefined,
                                  seed: typeof c.seed === 'number' ? c.seed : undefined,
                                }
                          )
                        : [{ text: h.prompt }];
                      setPromptCandidates(candidates);
                      setSelectedCandidateIndex(0);
                      setFusionResult((candidates[0] && candidates[0].text) || h.prompt || '');
                      setNegativeResult(h.negative || '');
                      const restoredAudio = typeof h.audioPrompt === 'string' ? h.audioPrompt.trim() : '';
                      const restoredAudioPlan = normalizeAudioPlan(h.audioPlan);
                      const resolvedAudioText = restoredAudioPlan?.stylePrompt || restoredAudio;
                      setGenerateAudioPrompt(Boolean(restoredAudioPlan || resolvedAudioText));
                      setAudioPromptResult(resolvedAudioText);
                      setAudioWorkflowPlan(restoredAudioPlan);
                      const restoredWan = typeof h.wanPrompt === 'string' ? h.wanPrompt.trim() : '';
                      setGenerateWanPrompt(Boolean(restoredWan));
                      setWanPromptResult(restoredWan);
                    }}
                  >
                    Load
                  </button>
                  <button type="button" className="p-sm" onClick={() => copyText(h.prompt)} disabled={!h.prompt}>Copy prompt</button>
                  {h.negative && <button type="button" className="p-sm" onClick={() => copyText(h.negative)}>Copy negative</button>}
                  {h.audioPrompt && (
                    <button type="button" className="p-sm" onClick={() => copyText(h.audioPrompt)}>
                      Copy audio prompt
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}



