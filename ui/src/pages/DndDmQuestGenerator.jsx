import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const DEFAULT_DIFFICULTIES = ['Introductory', 'Balanced', 'Challenging', 'Deadly'];
const DEFAULT_ENVIRONMENTS = ['Urban', 'Wilderness', 'Dungeon', 'Aquatic', 'Planar'];

export default function DndDmQuestGenerator() {
  const [focus, setFocus] = useState('');
  const [difficulty, setDifficulty] = useState('Balanced');
  const [environment, setEnvironment] = useState('Wilderness');
  const [hooks, setHooks] = useState('');
  const [twist, setTwist] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const difficultyOptions = useMemo(() => DEFAULT_DIFFICULTIES, []);
  const environmentOptions = useMemo(() => DEFAULT_ENVIRONMENTS, []);

  const systemMessage = `You are Blossom, a concise Dungeons & Dragons quest designer. Reply with:
1) A titled synopsis (2-3 tight paragraphs max).
2) A short bullet list of player-facing quest hooks.
3) Explicit objectives / success conditions.
Keep tone evocative yet efficient. Assume D&D 5e baseline.`;

  const buildPrompt = useCallback(() => {
    const lines = [
      'Design a fresh Dungeons & Dragons quest for a busy Dungeon Master.',
      focus ? `Focus on: ${focus.trim()}.` : '',
      difficulty ? `Target difficulty: ${difficulty}.` : '',
      environment ? `Primary environment or setting: ${environment}.` : '',
      hooks ? `Incorporate these desired hooks or themes: ${hooks.trim()}.` : '',
      twist ? `Include the following twist or complication: ${twist.trim()}.` : '',
      'Return only the quest content, no additional commentary.',
    ].filter(Boolean);
    return lines.join('\n');
  }, [difficulty, environment, focus, hooks, twist]);

  const generate = useCallback(
    async (e) => {
      e.preventDefault();
      setError('');
      setSynopsis('');
      const prompt = buildPrompt();
      if (!prompt.trim()) return;
      try {
        setLoading(true);
        const result = await invoke('generate_llm', {
          prompt,
          system: systemMessage,
        });
        if (typeof result === 'string') {
          setSynopsis(result.trim());
        } else {
          setSynopsis('');
          setError('Received an unexpected response from the model.');
        }
      } catch (err) {
        setError(err?.message || 'Failed to generate quest synopsis.');
      } finally {
        setLoading(false);
      }
    },
    [buildPrompt, systemMessage]
  );

  const copySynopsis = async () => {
    try {
      await navigator.clipboard.writeText(synopsis);
    } catch (err) {
      console.error('Failed to copy synopsis', err);
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Quest Generator</h1>
      <p>Create a quick synopsis with hooks and objectives tailored for your table.</p>

      <section className="dnd-surface" style={{ display: 'grid', gap: 'var(--space-md)', maxWidth: 720 }}>
        <form onSubmit={generate} className="dnd-form" style={{ display: 'grid', gap: 'var(--space-md)' }}>
          <label className="dnd-label">
            <span>Faction, NPC, or Threat Focus</span>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. The Sapphire Veil thieves guild or Captain Liora"
            />
            <small className="muted">Give Blossom the anchor for the quest's conflict.</small>
          </label>

          <label className="dnd-label">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {difficultyOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>

          <label className="dnd-label">
            <span>Environment</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
              {environmentOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <small className="muted">Pick the primary locale or vibe for the adventure.</small>
          </label>

          <label className="dnd-label">
            <span>Desired Hooks or Player Interests</span>
            <textarea
              value={hooks}
              onChange={(e) => setHooks(e.target.value)}
              rows={3}
              placeholder="e.g. tie to a ranger's missing sister; leverage rival adventuring party"
            />
          </label>

          <label className="dnd-label">
            <span>Twists or Extra Notes</span>
            <textarea
              value={twist}
              onChange={(e) => setTwist(e.target.value)}
              rows={2}
              placeholder="Optional complications, deadlines, or rewards"
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <button type="submit" disabled={loading}>
              {loading ? 'Generating…' : 'Generate Quest Synopsis'}
            </button>
            {error ? <span style={{ color: 'var(--danger)' }}>{error}</span> : null}
          </div>
        </form>
      </section>

      <section className="dnd-surface" style={{ display: 'grid', gap: 'var(--space-sm)', maxWidth: 720 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Synopsis</h2>
          {synopsis ? (
            <button type="button" onClick={copySynopsis} className="secondary">
              Copy
            </button>
          ) : null}
        </header>
        {loading && !synopsis ? <p className="muted">Blossom is weaving the quest…</p> : null}
        {error && !synopsis ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
        <textarea
          readOnly
          value={synopsis}
          placeholder="Your quest synopsis will appear here."
          rows={synopsis ? Math.min(18, synopsis.split('\n').length + 4) : 8}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </section>
    </>
  );
}
