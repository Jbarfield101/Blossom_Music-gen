import { useState, useCallback, useEffect } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Fusion.css';

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
    console.warn('Failed to parse audio prompt payload as JSON', err);
  }
  return null;
}

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
  const [mode, setMode] = useState('lofi');
  const [fusionResult, setFusionResult] = useState('');
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [loadingFuse, setLoadingFuse] = useState(false);
  const [error, setError] = useState('');
  const [includeNegative, setIncludeNegative] = useState(true);
  const [negativeResult, setNegativeResult] = useState('');
  const [generateAudioPrompt, setGenerateAudioPrompt] = useState(false);
  const [audioPromptResult, setAudioPromptResult] = useState('');
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
          const normalized = parsed.map((entry) => ({
            ...entry,
            mode: entry?.mode === 'tiktok' ? 'tiktok' : 'lofi',
            audioPrompt:
              typeof entry?.audioPrompt === 'string' ? entry.audioPrompt.trim() : '',
          }));
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
      try {
        await invoke('queue_lofi_scene_job');
        setStatusInfo({
          type: 'success',
          content: (
            <span>
              Image render queued!{' '}
              <a
                href="#/visual-generator/lofi-scene-maker"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                Open job queue
              </a>
            </span>
          ),
        });
      } catch (queueError) {
        const queueMessage = queueError instanceof Error ? queueError.message : String(queueError);
        setStatusInfo({
          type: 'error',
          content: (
            <span>
              Prompts saved but failed to queue the render: {queueMessage}
            </span>
          ),
        });
      }
      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDialogError(message || 'Failed to update workflow prompts.');
    } finally {
      setDialogLoading(false);
    }
  }, [batchSizeInput, closeDialog, fusionResult, includeNegative, isTauriEnv, negativeResult, sceneMeta, stepsInput]);

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
    const setLoading = slot === 'A' ? setLoadingA : setLoadingB;
    const setConcept = slot === 'A' ? setConceptA : setConceptB;
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
    const a = conceptA.trim();
    const b = conceptB.trim();
    setError('');
    setStatusInfo(null);
    setNegativeResult('');
    setPromptCandidates([]);
    setSelectedCandidateIndex(0);
    setAudioPromptResult('');
    if (!a && !b) {
      setFusionResult('Enter concepts to explore their fusion.');
      return;
    }
    if (!a || !b) {
      setFusionResult('Add a second concept to complete the fusion.');
      return;
    }
    setLoadingFuse(true);
    try {
      const isTikTok = mode === 'tiktok';
      const system = isTikTok
        ? 'You are Blossom, an excitable creative assistant. Devise ONE high-energy, absurd text prompt that sells an AI-generated short-form video idea blending the two concepts. Make it punchy, vertical-video ready, and full of motion, hooks, and spectacle. Keep it to one paragraph (45-80 words). Avoid artist names, trademarks, numbered lists, or quotation marks.'
        : 'You are Blossom, a helpful creative assistant. Compose a single vivid text-to-image prompt that fuses two given concepts. Constraints: one paragraph (~50-90 words); describe subject, style, mood, lighting, composition, materials, color palette; avoid artist names and trademarks; do not mention the words "fusion" or "concept"; no lists; no quotes.';
      const prompt = isTikTok
        ? `Concept A: ${a}\nConcept B: ${b}\nInvent one outrageous AI video idea ready for a viral short.`
        : `Concept A: ${a}\nConcept B: ${b}\nWrite one coherent prompt.`;
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
          if (cleaned) {
            candidateResults.push({ ...config, text: cleaned });
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
        const negSystem = isTikTok
          ? 'You are Blossom, an exacting creative assistant. Produce a compact negative prompt for AI-generated video frames matching the given fusion concepts. Output a single line of comma-separated visual issues to avoid (e.g., "muddy motion, frame tearing, awkward limbs, text overlays, compression artifacts"). Do not include quotes or explanations.'
          : 'You are Blossom, a helpful creative assistant. Produce a compact negative prompt for text-to-image diffusion matching the given fusion concepts. Output a single line of comma-separated terms describing artifacts and traits to avoid (e.g., "blurry, extra limbs, low contrast, text, watermark, jpeg artifacts"). Do not include quotes or explanations.';
        const negPrompt = isTikTok
          ? `Concept A: ${a}\nConcept B: ${b}\nNegative prompt only, single line tuned for clean, cinematic AI video frames.`
          : `Concept A: ${a}\nConcept B: ${b}\nNegative prompt only, single line.`;
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
      if (generateAudioPrompt) {
        const audioSystem = isTikTok
          ? 'You are Blossom, an enthusiastic music director for short-form content. Respond ONLY with JSON containing the keys mainConcept, genreStyle, instruments, moodEmotion, eraInfluence, structureProgression, soundDesignMix, and tempo. Provide concise descriptive phrases for every field. No narration or extra text.'
          : 'You are Blossom, a chill music director for lo-fi. Respond ONLY with JSON containing the keys mainConcept, genreStyle, instruments, moodEmotion, eraInfluence, structureProgression, soundDesignMix, and tempo. Provide concise descriptive phrases for every field. No narration or extra text.';
        const audioPromptInput = isTikTok
          ? `Concept A: ${a}\nConcept B: ${b}\nReturn a JSON object like {"mainConcept":"","genreStyle":"","instruments":"","moodEmotion":"","eraInfluence":"","structureProgression":"","soundDesignMix":"","tempo":""} capturing a high-energy, short-form ready soundtrack that blends these ideas. Ensure "tempo" includes BPM (and optional duration) and keep every field concise. Do not include commentary.`
          : `Concept A: ${a}\nConcept B: ${b}\nReturn a JSON object like {"mainConcept":"","genreStyle":"","instruments":"","moodEmotion":"","eraInfluence":"","structureProgression":"","soundDesignMix":"","tempo":""} capturing a mellow lo-fi beat that blends these ideas. Ensure "tempo" includes BPM (and optional duration) and keep every field concise. Do not include commentary.`;
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
          }
        } catch (audioError) {
          console.error('fusion audio prompt failed', audioError);
        }
      }

      const entry = {
        a,
        b,
        prompt: main,
        negative,
        audioPrompt,
        candidates: uniqueCandidates.map((c) => ({
          text: c.text,
          temperature: c.temperature,
          seed: c.seed,
        })),
        mode,
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

  const trimmedFusionPrompt = fusionResult.trim();
  const trimmedAudioPrompt = audioPromptResult.trim();
  const isGenerateDisabled = loadingFuse || !trimmedFusionPrompt || dialogLoading || isDialogOpen;

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
          <input
            className="fusion-input"
            type="text"
            placeholder="First concept"
            value={conceptA}
            onChange={(event) => setConceptA(event.target.value)}
          />
          <button
            className="fusion-button"
            type="button"
            onClick={() => randomConcept('A')}
            disabled={loadingA || loadingFuse}
            title="Generate a random concept"
          >
            {loadingA ? '…' : 'Random'}
          </button>
          <button className="fusion-button" type="submit">
            {loadingFuse ? 'Fusing…' : 'FUSE'}
          </button>
          <input
            className="fusion-input"
            type="text"
            placeholder="Second concept"
            value={conceptB}
            onChange={(event) => setConceptB(event.target.value)}
          />
          <button
            className="fusion-button"
            type="button"
            onClick={() => randomConcept('B')}
            disabled={loadingB || loadingFuse}
            title="Generate a random concept"
          >
            {loadingB ? '…' : 'Random'}
          </button>
        </div>
      </form>
      <div className="fusion-options" style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
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
              }
            }}
            disabled={loadingFuse}
          />
          Generate audio prompt
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
                Generate Image
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
            {history.map((h, idx) => (
              <div key={h.ts + ':' + idx} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem' }}>
                <div style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  <strong>{h.a}</strong> + <strong>{h.b}</strong>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="p-sm"
                    onClick={() => {
                      const entryMode = h.mode === 'tiktok' ? 'tiktok' : 'lofi';
                      setMode(entryMode);
                      setConceptA(h.a);
                      setConceptB(h.b);
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
                      setGenerateAudioPrompt(Boolean(restoredAudio));
                      setAudioPromptResult(restoredAudio);
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



