import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Fusion.css';

export default function Fusion() {
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [mode, setMode] = useState('lofi');
  const [fusionResult, setFusionResult] = useState('');
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [loadingFuse, setLoadingFuse] = useState(false);
  const [error, setError] = useState('');
  const [includeNegative, setIncludeNegative] = useState(false);
  const [negativeResult, setNegativeResult] = useState('');
  const [history, setHistory] = useState([]); // [{a,b,prompt,negative,candidates?,ts}]
  const [promptCandidates, setPromptCandidates] = useState([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);

  const HISTORY_KEY = 'blossom.fusion.history';

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
    setNegativeResult('');
    setPromptCandidates([]);
    setSelectedCandidateIndex(0);
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

      const entry = {
        a,
        b,
        prompt: main,
        negative,
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

  return (
    <div className="fusion">
      <BackButton />
      <h1>Fusion</h1>
      <div className="fusion-mode-toggle" role="group" aria-label="Fusion style">
        {[
          { value: 'lofi', label: 'Lo-fi chill' },
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
          <input type="checkbox" checked={includeNegative} onChange={(e) => setIncludeNegative(e.target.checked)} disabled={loadingFuse} />
          Include negative prompt
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
          </div>
        )}
      </div>
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
                    }}
                  >
                    Load
                  </button>
                  <button type="button" className="p-sm" onClick={() => copyText(h.prompt)} disabled={!h.prompt}>Copy prompt</button>
                  {h.negative && <button type="button" className="p-sm" onClick={() => copyText(h.negative)}>Copy negative</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



