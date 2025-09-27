import { useCallback, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { createPlayer } from '../api/players';
import { createEmptyPlayerSheet, serializeCharacterSheet } from '../lib/playerSheet.js';
import './Dnd.css';

function toLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

export default function DndDmPlayerAuto() {
  const [name, setName] = useState('');
  const [race, setRace] = useState('Human');
  const [level, setLevel] = useState(1);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const handleCreate = useCallback(async (e) => {
    e.preventDefault();
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter a character name.'); return; }
    try {
      setCreating(true);
      setError('');
      setStatus('');
      const sheet = createEmptyPlayerSheet();
      sheet.identity.name = trimmed;
      sheet.identity.race = race || '';
      sheet.identity.level = toLevel(level);
      const markdown = serializeCharacterSheet(sheet);
      const system = 'You are a helpful D&D 5e assistant. Fill character sheets realistically and keep outputs balanced and concise.';
      const prompt = [
        `Fill the character template and sheet fields for:`,
        `Name: ${trimmed}`,
        `Race: ${race}`,
        `Level: ${toLevel(level)}`,
        '',
        'Rules:',
        '- Choose an appropriate class/subclass and background.',
        '- Set ability scores using a reasonable array for the race and class (include racial bonuses).',
        '- Set skills, saving throws, languages, and proficiencies sensibly.',
        '- Add class features, equipment, and spell slots/known (if applicable) for the level.',
        '- Keep features original, setting-agnostic, and SRD-safe; no OGL text.',
        '- Output should fully populate the template placeholders and sheet fields.',
      ].join('\n');
      await createPlayer({
        name: trimmed,
        markdown,
        sheet,
        usePrefill: true,
        prefillPrompt: `${system}\n\n${prompt}`,
      });
      setStatus('Character created with Blossom. Check your Players folder.');
    } catch (err) {
      console.error('Auto-create failed', err);
      setError(err?.message || 'Failed to create character.');
    } finally {
      setCreating(false);
    }
  }, [creating, level, name, race]);

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Create with Blossom</h1>
      <section className="dnd-surface" style={{ maxWidth: 720 }}>
        <p className="muted">Enter a name, select a race and level. Blossom will generate the rest.</p>
        {error && <div className="dnd-sheet-alert">{error}</div>}
        {status && <div className="dnd-sheet-success">{status}</div>}
        <form onSubmit={handleCreate} className="dnd-form-grid" style={{ display: 'grid', gap: '0.75rem' }}>
          <label>
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Elowen Duskwhisper" />
          </label>
          <label>
            <span>Race</span>
            <select value={race} onChange={(e) => setRace(e.target.value)}>
              <option value="Human">Human</option>
              <option value="Elf">Elf</option>
              <option value="Half-Elf">Half-Elf</option>
              <option value="Dwarf">Dwarf</option>
              <option value="Halfling">Halfling</option>
              <option value="Gnome">Gnome</option>
              <option value="Half-Orc">Half-Orc</option>
              <option value="Tiefling">Tiefling</option>
              <option value="Dragonborn">Dragonborn</option>
              <option value="Goliath">Goliath</option>
            </select>
          </label>
          <label>
            <span>Level</span>
            <input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={creating}>
              {creating ? (<><span className="spinner" aria-label="loading" /> Creating…</>) : 'Create with Blossom'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

