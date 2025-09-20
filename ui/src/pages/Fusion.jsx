import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Fusion.css';

export default function Fusion() {
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [fusionResult, setFusionResult] = useState('');
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [loadingFuse, setLoadingFuse] = useState(false);
  const [error, setError] = useState('');
  const [includeNegative, setIncludeNegative] = useState(false);
  const [negativeResult, setNegativeResult] = useState('');
  const [history, setHistory] = useState([]); // [{a,b,prompt,negative,ts}]

  const HISTORY_KEY = 'blossom.fusion.history';

  // Load recent fusion history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {}
  }, []);

  const persistHistory = (next) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 20)));
    } catch {}
  };

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
      const system = 'Return ONE short, creative concept for image generation. 1-4 words. No punctuation. No quotes. No numbering. Examples: "neon koi", "clockwork forest", "crystal dunes".';
      const prompt = 'Generate a random concept.';
      let text = await invoke('generate_llm', { prompt, system });
      text = String(text || '').split('\n')[0].trim();
      text = text.replace(/ ^ \\d+\\.\\s*/, '').replace(/ ^[ \\-\\s]+/, '');
      text = text.replace(/^"|"$/g, '');
      text = text.replace(/[.,;:!?]+$/g, '');
      setConcept(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const a = conceptA.trim();
    const b = conceptB.trim();
    setError('');
    setNegativeResult('');
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
      const system = (
        'You are Blossom, a helpful creative assistant. Compose a single vivid text-to-image prompt that fuses two given concepts. ' +
        'Constraints: one paragraph (~50-90 words); describe subject, style, mood, lighting, composition, materials, color palette; ' +
        'avoid artist names and trademarks; do not mention the words "fusion" or "concept"; no lists; no quotes.'
      );
      const prompt = `Concept A: ${a}\nConcept B: ${b}\nWrite one coherent prompt.`;
      const text = await invoke('generate_llm', { prompt, system });
      const main = String(text || '').trim();
      setFusionResult(main);

      let negative = '';
      if (includeNegative) {
        const negSystem = (
          'You are Blossom, a helpful creative assistant. Produce a compact negative prompt for text-to-image diffusion matching the given fusion concepts. ' +
          'Output a single line of comma-separated terms describing artifacts and traits to avoid (e.g., "blurry, extra limbs, low contrast, text, watermark, jpeg artifacts"). ' +
          'Do not include quotes or explanations.'
        );
        const negPrompt = `Concept A: ${a}\nConcept B: ${b}\nNegative prompt only, single line.`;
        const neg = await invoke('generate_llm', { prompt: negPrompt, system: negSystem });
        negative = String(neg || '').replace(/[\r\n]+/g, ' ').trim();
        setNegativeResult(negative);
      }

      const entry = { a, b, prompt: main, negative, ts: Date.now() };
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
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Prompt</div>
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
                  <button type="button" className="p-sm" onClick={() => { setConceptA(h.a); setConceptB(h.b); setFusionResult(h.prompt); setNegativeResult(h.negative || ''); }}>Load</button>
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



