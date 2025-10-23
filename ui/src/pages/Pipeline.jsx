import { useState, useCallback } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';

const STAGE_DEFINITIONS = [
  { key: 'fusion', label: 'Fusion' },
  { key: 'lofi_scene_maker', label: 'Lofi_Scene Maker' },
  { key: 'sound_lab', label: 'Sound Lab/Stable' },
  { key: 'make_video', label: 'Make Video' },
  { key: 'assembly', label: 'Put together' },
  { key: 'upload', label: 'Upload' },
];

const createOfflineStages = () => STAGE_DEFINITIONS.map((stage) => ({ ...stage, status: 'offline' }));

function cleanConcept(text) {
  let result = String(text ?? '').split('\n')[0];
  result = result.trim();
  result = result.replace(/^\d+\.\s*/, '').replace(/^[\-\s]+/, '');
  result = result.replace(/^"|"$/g, '');
  result = result.replace(/[.,;:!?]+$/g, '');
  return result.trim();
}

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

const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

const randomTemperature = (min = 0.65, max = 0.95) => {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(2));
};

const STATUS_COLORS = {
  offline: { background: 'rgba(148, 163, 184, 0.16)', color: 'rgb(100, 116, 139)', border: 'rgba(148, 163, 184, 0.45)' },
  running: { background: 'rgba(59, 130, 246, 0.16)', color: 'rgb(37, 99, 235)', border: 'rgba(59, 130, 246, 0.4)' },
  online: { background: 'rgba(34, 197, 94, 0.16)', color: 'rgb(22, 163, 74)', border: 'rgba(34, 197, 94, 0.4)' },
};

const MESSAGE_COLORS = {
  success: { background: 'rgba(34, 197, 94, 0.12)', color: 'rgb(22, 163, 74)', border: 'rgba(34, 197, 94, 0.35)' },
  warning: { background: 'rgba(250, 204, 21, 0.12)', color: 'rgb(161, 98, 7)', border: 'rgba(250, 204, 21, 0.45)' },
  error: { background: 'rgba(248, 113, 113, 0.12)', color: 'rgb(185, 28, 28)', border: 'rgba(248, 113, 113, 0.45)' },
};

export default function Pipeline() {
  const [detailOpen, setDetailOpen] = useState(true);
  const [pipelineStatus, setPipelineStatus] = useState('offline');
  const [stages, setStages] = useState(() => createOfflineStages());
  const [activating, setActivating] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null); // { type: 'success'|'warning'|'error', content: string }

  const resetStages = useCallback(() => {
    setStages(createOfflineStages());
  }, []);

  const updateStageStatuses = useCallback((onlineKeys) => {
    const active = new Set(onlineKeys);
    setStages(STAGE_DEFINITIONS.map((stage) => ({
      ...stage,
      status: active.has(stage.key) ? 'online' : 'offline',
    })));
  }, []);

  const activatePipeline = useCallback(async () => {
    if (activating) {
      return;
    }
    setActivating(true);
    setStatusMessage(null);
    setPipelineStatus('running');
    resetStages();

    const conceptSystem =
      'Return ONE short, creative concept for image generation. 1-4 words. No punctuation. No quotes. No numbering. Examples: "neon koi", "clockwork forest", "crystal dunes".';
    const conceptPrompt = 'Generate a random concept.';
    const fusionSystem =
      'You are Blossom, a helpful creative assistant. Compose a single vivid text-to-image prompt that fuses two given concepts. Constraints: one paragraph (~50-90 words); describe subject, style, mood, lighting, composition, materials, color palette; avoid artist names and trademarks; do not mention the words "fusion" or "concept"; no lists; no quotes.';
    const fusionPromptTemplate = (a, b) => `Concept A: ${a}\nConcept B: ${b}\nWrite one coherent prompt.`;
    const negativeSystem =
      'You are Blossom, a helpful creative assistant. Produce a compact negative prompt for text-to-image diffusion matching the given fusion concepts. Output a single line of comma-separated terms describing artifacts and traits to avoid (e.g., "blurry, extra limbs, low contrast, text, watermark, jpeg artifacts"). Do not include quotes or explanations.';
    const negativePromptTemplate = (a, b) => `Concept A: ${a}\nConcept B: ${b}\nNegative prompt only, single line.`;

    try {
      const tauriAvailable = await isTauri();
      if (!tauriAvailable) {
        setPipelineStatus('offline');
        resetStages();
        setStatusMessage({
          type: 'warning',
          content: 'Pipeline activation is only available in the Blossom desktop app.',
        });
        return;
      }

      const conceptAResult = await invoke('generate_llm', {
        prompt: conceptPrompt,
        system: conceptSystem,
        temperature: randomTemperature(0.75, 1.05),
        seed: randomSeed(),
      });
      const conceptA = cleanConcept(conceptAResult);
      if (!conceptA) {
        throw new Error('Failed to generate concept A.');
      }

      const conceptBResult = await invoke('generate_llm', {
        prompt: conceptPrompt,
        system: conceptSystem,
        temperature: randomTemperature(0.75, 1.05),
        seed: randomSeed(),
      });
      const conceptB = cleanConcept(conceptBResult);
      if (!conceptB) {
        throw new Error('Failed to generate concept B.');
      }

      const fusionPrompt = fusionPromptTemplate(conceptA, conceptB);
      const fusionResult = await invoke('generate_llm', {
        prompt: fusionPrompt,
        system: fusionSystem,
        temperature: randomTemperature(0.65, 0.95),
        seed: randomSeed(),
      });
      const fusedPrompt = String(fusionResult ?? '').trim();
      if (!fusedPrompt) {
        throw new Error('Fusion prompt was empty.');
      }

      const negativePromptRaw = await invoke('generate_llm', {
        prompt: negativePromptTemplate(conceptA, conceptB),
        system: negativeSystem,
        temperature: randomTemperature(0.3, 0.55),
        seed: randomSeed(),
      });
      const negativePrompt = String(negativePromptRaw ?? '').replace(/[\r\n]+/g, ' ').trim();

      let promptSettings = {};
      try {
        const fetched = await invoke('get_lofi_scene_prompts');
        promptSettings = typeof fetched === 'object' && fetched ? fetched : {};
      } catch {
        promptSettings = {};
      }

      const parseInteger = (value, fallback) => {
        const parsed = Number.parseInt(String(value ?? '').trim(), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const parseNumber = (value, fallback) => {
        const parsed = Number.parseFloat(String(value ?? '').trim());
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const steps = parseNumber(extractPromptField(promptSettings, 'steps'), 20);
      const cfg = parseNumber(extractPromptField(promptSettings, 'cfg'), 2.5);
      const seed = parseInteger(extractPromptField(promptSettings, 'seed'), randomSeed());
      const seedBehaviorRaw = extractPromptField(promptSettings, 'seedBehavior');
      const seedBehavior = seedBehaviorRaw ? seedBehaviorRaw.trim().toLowerCase() : 'fixed';
      const fileNamePrefixRaw = extractPromptField(promptSettings, 'fileNamePrefix');
      const fileNamePrefix = fileNamePrefixRaw && fileNamePrefixRaw.trim() ? fileNamePrefixRaw.trim() : 'LofiScene';

      const payload = {
        prompt: fusedPrompt,
        negativePrompt,
        steps,
        batchSize: 4,
        seed,
        seedBehavior,
        cfg,
        fileNamePrefix,
      };

      await invoke('update_lofi_scene_prompts', { payload });
      await invoke('queue_lofi_scene_job');

      updateStageStatuses(['fusion', 'lofi_scene_maker']);
      setPipelineStatus('online');
      setStatusMessage({
        type: 'success',
        content: 'Pipeline suite activated. Fusion and scene generation are now queued.',
      });
    } catch (err) {
      resetStages();
      setPipelineStatus('offline');
      const message = err instanceof Error ? err.message : String(err);
      if (message) {
        setStatusMessage({ type: 'error', content: message });
      } else {
        setStatusMessage({ type: 'error', content: 'Failed to activate the pipeline.' });
      }
    } finally {
      setActivating(false);
    }
  }, [activating, resetStages, updateStageStatuses]);

  const statusBadgeStyle = STATUS_COLORS[pipelineStatus] || STATUS_COLORS.offline;

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'grid', gap: 'var(--space-xl)' }}>
      <BackButton />
      <header style={{ display: 'grid', gap: 'var(--space-md)', textAlign: 'center', maxWidth: '720px', margin: '0 auto' }}>
        <h1>Pipelines</h1>
        <p>
          Coordinate the automated pipelines end-to-end. Activate the suite to fuse random concepts, capture scene prompts,
          and queue renders without leaving the desktop shell.
        </p>
      </header>
      <section style={{ display: 'grid', gap: 'var(--space-lg)', maxWidth: '720px', margin: '0 auto' }}>
        <Card
          title="Pipelines"
          onClick={() => setDetailOpen((open) => !open)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            Status
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.125rem 0.5rem',
                borderRadius: '999px',
                fontSize: '0.825rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                backgroundColor: statusBadgeStyle.background,
                color: statusBadgeStyle.color,
                border: `1px solid ${statusBadgeStyle.border}`,
              }}
            >
              {pipelineStatus}
            </span>
          </span>
        </Card>
        {detailOpen && (
          <div
            style={{
              display: 'grid',
              gap: 'var(--space-lg)',
              padding: 'var(--space-xl)',
              borderRadius: '16px',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              backgroundColor: 'rgba(15, 23, 42, 0.35)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
              <h2 style={{ margin: 0 }}>Pipeline suite</h2>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '999px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  backgroundColor: statusBadgeStyle.background,
                  color: statusBadgeStyle.color,
                  border: `1px solid ${statusBadgeStyle.border}`,
                }}
              >
                {pipelineStatus}
              </span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-sm)' }}>
              {stages.map((stage) => {
                const stageBadgeStyle = STATUS_COLORS[stage.status] || STATUS_COLORS.offline;
                return (
                  <li
                    key={stage.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(15, 23, 42, 0.4)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{stage.label}</span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        backgroundColor: stageBadgeStyle.background,
                        color: stageBadgeStyle.color,
                        border: `1px solid ${stageBadgeStyle.border}`,
                      }}
                    >
                      {stage.status}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
              <button
                type="button"
                className="p-lg"
                onClick={activatePipeline}
                disabled={activating}
                style={{
                  justifySelf: 'start',
                  minWidth: '12rem',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  borderRadius: '999px',
                  border: 'none',
                  padding: '0.75rem 1.75rem',
                  cursor: activating ? 'not-allowed' : 'pointer',
                  opacity: activating ? 0.65 : 1,
                  transition: 'opacity 0.2s ease-in-out',
                }}
              >
                {activating ? 'Activating…' : 'Activate'}
              </button>
              {statusMessage && (
                <p
                  role={statusMessage.type === 'error' ? 'alert' : undefined}
                  style={{
                    margin: 0,
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.9rem',
                    lineHeight: 1.45,
                    backgroundColor: MESSAGE_COLORS[statusMessage.type]?.background,
                    color: MESSAGE_COLORS[statusMessage.type]?.color,
                    border: `1px solid ${MESSAGE_COLORS[statusMessage.type]?.border || 'transparent'}`,
                  }}
                >
                  {statusMessage.content}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

