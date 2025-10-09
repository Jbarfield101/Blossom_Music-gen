import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import CharacterSheetSection from '../components/CharacterSheetSection.jsx';
import AbilityScoreInputs from '../components/AbilityScoreInputs.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { createPlayer } from '../api/players';
import { serializeCharacterSheet, buildDerivedStats, createEmptyPlayerSheet, playerSheetReducer } from '../lib/playerSheet.js';
import { offlineStoryHint, sampleOfflineStory } from '../lib/offlineStoryTables.js';
import './Dnd.css';

function toNum(value, min = -Infinity, max = Infinity) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Math.max(min, Math.min(max, n));
}

export default function DndDmPlayerCreate() {
  const navigate = useNavigate();
  const [sheet, dispatch] = useReducer(playerSheetReducer, null, createEmptyPlayerSheet);
  const derived = useMemo(() => buildDerivedStats(sheet), [sheet]);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [rolling, setRolling] = useState({ traits: false, ideals: false, backstory: false });
  const [randomMode, setRandomMode] = useState(() => {
    if (typeof window === 'undefined') return 'tauri';
    return window.__TAURI__ ? 'tauri' : 'local';
  });
  const [randomHelper, setRandomHelper] = useState({
    traits: { message: '', tone: 'info' },
    ideals: { message: '', tone: 'info' },
    backstory: { message: '', tone: 'info' },
  });
  const [randomGlobalError, setRandomGlobalError] = useState('');
  const [randomFatal, setRandomFatal] = useState('');
  const invokeFailureCount = useRef(0);

  const next = () => setStep((s) => Math.min(3, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  // Initialize point-buy baseline to 8 if still at defaults (commonly 10)
  useEffect(() => {
    const abilities = sheet?.abilityScores || {};
    const keys = ['str','dex','con','int','wis','cha'];
    const allDefault10 = keys.every((k) => Number(abilities[k]) === 10);
    if (allDefault10) {
      keys.forEach((k) => dispatch({ type: 'setField', path: ['abilityScores', k], value: 8 }));
    }
  }, [sheet?.abilityScores]);

  const finish = useCallback(async () => {
    try {
      setSaving(true);
      setError('');
      const markdown = serializeCharacterSheet(sheet);
      const payload = {
        name: sheet?.identity?.name || 'Adventurer',
        markdown,
        sheet,
      };
      await createPlayer(payload);
      try {
        localStorage.setItem(
          'dnd.player.current',
          JSON.stringify({
            name: sheet.identity.name || 'Adventurer',
            class: sheet.identity.class || '',
            level: sheet.identity.level || 1,
          })
        );
      } catch {}
      setStatus('Character created.');
      navigate('/dnd/dungeon-master/players');
    } catch (err) {
      setError(err?.message || 'Failed to create character.');
    } finally {
      setSaving(false);
    }
  }, [navigate, sheet]);

  const Step1Identity = (
    <CharacterSheetSection title="Identity" description="Start with a name and a bit of flavor.">
      <div className="dnd-identity-grid">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={sheet.identity.name}
            onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'name'], value: e.target.value })}
            placeholder="e.g. Elowen Duskwhisper"
            required
          />
          <small className="muted">Pick a memorable name. You can change it later.</small>
        </label>
        <label>
          <span>Class</span>
          <select
            value={sheet.identity.class}
            onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'class'], value: e.target.value })}
          >
            <option value="">Select a class…</option>
            <option value="Barbarian">Barbarian</option>
            <option value="Bard">Bard</option>
            <option value="Cleric">Cleric</option>
            <option value="Druid">Druid</option>
            <option value="Fighter">Fighter</option>
            <option value="Monk">Monk</option>
            <option value="Paladin">Paladin</option>
            <option value="Ranger">Ranger</option>
            <option value="Rogue">Rogue</option>
            <option value="Sorcerer">Sorcerer</option>
            <option value="Warlock">Warlock</option>
            <option value="Wizard">Wizard</option>
            <option value="Artificer">Artificer</option>
          </select>
          <small className="muted">Subclass and multiclassing come later from the full sheet.</small>
        </label>
        <label>
          <span>Level</span>
          <input
            type="number"
            min="1"
            max="20"
            value={sheet.identity.level}
            onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'level'], value: toNum(e.target.value, 1, 20) })}
          />
        </label>
        <label>
          <span>Background</span>
          <select
            value={sheet.identity.background}
            onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'background'], value: e.target.value })}
          >
            <option value="">Select a background…</option>
            <option value="Acolyte">Acolyte</option>
            <option value="Charlatan">Charlatan</option>
            <option value="Criminal">Criminal</option>
            <option value="Entertainer">Entertainer</option>
            <option value="Folk Hero">Folk Hero</option>
            <option value="Guild Artisan">Guild Artisan</option>
            <option value="Hermit">Hermit</option>
            <option value="Noble">Noble</option>
            <option value="Outlander">Outlander</option>
            <option value="Sage">Sage</option>
            <option value="Sailor">Sailor</option>
            <option value="Soldier">Soldier</option>
            <option value="Urchin">Urchin</option>
            <option value="Custom">Custom</option>
          </select>
        </label>
        <label>
          <span>Race</span>
          <select
            value={sheet.identity.race}
            onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'race'], value: e.target.value })}
          >
            <option value="">Select a race…</option>
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
            <option value="Custom">Custom</option>
          </select>
        </label>
      </div>
      <div className="dnd-sheet-quickstats" style={{ marginTop: '0.5rem' }}>
        <div>
          <span>Proficiency Bonus</span>
          <strong>{derived.proficiencyBonus >= 0 ? `+${derived.proficiencyBonus}` : derived.proficiencyBonus}</strong>
        </div>
        <div>
          <span>Passive Perception</span>
          <strong>{derived.passivePerception}</strong>
        </div>
      </div>
    </CharacterSheetSection>
  );

  const Step2Abilities = (
    <CharacterSheetSection title="Abilities" description="Assign core abilities; you can fine-tune later.">
      {(() => {
        const rb = raceBonusFor(sheet?.identity?.race || '');
        const note = raceBonusNote(sheet?.identity?.race || '');
        return (
          <>
            <AbilityScoreInputs
              scores={sheet.abilityScores}
              modifiers={derived.abilityModifiers}
              pointBuy
              pointBuyPool={27}
              pointBuyMin={8}
              pointBuyMax={15}
              bonusMap={rb}
              onChange={(ability, v) => dispatch({ type: 'setField', path: ['abilityScores', ability], value: toNum(v, 0, 30) })}
            />
            <div className="muted" style={{ marginTop: '0.25rem' }}>
              {note || 'Racial bonuses shown in the totals; class ASIs occur later (level 4+).'}
            </div>
          </>
        );
      })()}
      <div className="muted" style={{ marginTop: '0.5rem' }}>Tip: A common array is 15, 14, 13, 12, 10, 8.</div>
    </CharacterSheetSection>
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.__TAURI__) {
      setRandomMode('local');
      setRandomGlobalError('AI helpers are unavailable in this environment. Using offline tables for suggestions.');
    }
  }, []);

  const resetHelper = useCallback((kind) => {
    setRandomHelper((prev) => ({ ...prev, [kind]: { message: '', tone: 'info' } }));
  }, []);

  const setHelperMessage = useCallback((kind, message, tone = 'info') => {
    setRandomHelper((prev) => ({ ...prev, [kind]: { message, tone } }));
  }, []);

  const randomLabels = useMemo(
    () => ({
      traits: 'personality traits',
      ideals: 'ideals',
      backstory: 'backstory',
    }),
    []
  );

  const requestRandom = useCallback(
    async (kind) => {
      if (randomFatal) return;
      const helperId = randomLabels[kind] || kind;
      setRolling((r) => ({ ...r, [kind]: true }));
      resetHelper(kind);
      let offlineAttempted = false;
      try {
        let result = '';
        let usedOffline = false;
        if (randomMode === 'tauri') {
          try {
            const prompt = buildPrompt(sheet, kind);
            const sys = buildSystem(kind);
            const text = await invoke('generate_llm', { prompt, system: sys });
            result = String(text || '').trim();
            invokeFailureCount.current = 0;
            if (randomGlobalError && result) {
              setRandomGlobalError('');
            }
          } catch (err) {
            const message = err?.message || 'Story generator is unavailable.';
            setHelperMessage(kind, `${message} Falling back to offline tables.`, 'error');
            setRandomGlobalError('Story generator encountered an error. Using offline tables for suggestions.');
            invokeFailureCount.current += 1;
            if (invokeFailureCount.current >= 2) {
              setRandomMode('local');
            }
            try {
              offlineAttempted = true;
              result = sampleOfflineStory(kind);
              usedOffline = true;
            } catch (offlineErr) {
              throw offlineErr;
            }
          }
        }
        if (!result) {
          try {
            offlineAttempted = true;
            result = sampleOfflineStory(kind);
            usedOffline = true;
          } catch (offlineErr) {
            throw offlineErr;
          }
        }

        const value = String(result || '').trim();
        if (!value) {
          throw new Error('No suggestion was produced.');
        }
        if (usedOffline) {
          setHelperMessage(kind, offlineStoryHint(kind), 'info');
          if (!randomGlobalError) {
            setRandomGlobalError('Offline random tables are providing suggestions while AI helpers are unavailable.');
          }
        } else {
          resetHelper(kind);
        }

        if (kind === 'backstory') {
          dispatch({ type: 'setField', path: ['personality', 'appearance'], value });
        } else {
          dispatch({ type: 'setField', path: ['personality', kind], value });
        }
      } catch (err) {
        const message = err?.message || `Unable to randomize ${helperId}.`;
        setHelperMessage(kind, message, 'error');
        setRandomGlobalError((prev) => prev || message);
        if (offlineAttempted || randomMode === 'local') {
          setRandomFatal('Randomization is currently unavailable. Please enter details manually.');
        }
      } finally {
        setRolling((r) => ({ ...r, [kind]: false }));
      }
    },
    [dispatch, randomFatal, randomGlobalError, randomMode, randomLabels, resetHelper, setHelperMessage, sheet]
  );

  const Step3Story = (
    <CharacterSheetSection title="Story" description="Add personality and a hook to get started.">
      {randomGlobalError && (
        <div className="dnd-sheet-alert" role="status">{randomGlobalError}</div>
      )}
      <label>
        <span>Traits</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <textarea
            rows={2}
            value={sheet.personality.traits}
            onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'traits'], value: e.target.value })}
            placeholder="Curious, soft-spoken, fiercely loyal."
            style={{ flex: '1 1 auto' }}
          />
          <button
            type="button"
            onClick={() => requestRandom('traits')}
            disabled={rolling.traits || !!randomFatal}
            aria-disabled={rolling.traits || !!randomFatal}
            aria-describedby="random-traits-helper"
            aria-label={
              rolling.traits
                ? 'Rolling personality traits. Please wait.'
                : randomFatal
                  ? `Randomization unavailable: ${randomFatal}`
                  : 'Randomize personality traits'
            }
            title={
              rolling.traits
                ? 'Rolling personality traits…'
                : randomFatal || 'Generate personality traits automatically'
            }
          >
            {rolling.traits ? (
              <>
                <span className="spinner" aria-hidden="true" /> Rolling…
              </>
            ) : randomFatal ? 'Unavailable' : 'Random'}
          </button>
        </div>
        <small
          id="random-traits-helper"
          className="muted"
          style={{ color: randomHelper.traits.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
        >
          {randomHelper.traits.message || (randomMode === 'local' ? offlineStoryHint('traits') : 'Use Random to suggest new personality traits.')}
        </small>
      </label>
      <label>
        <span>Ideals</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <textarea
            rows={2}
            value={sheet.personality.ideals}
            onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'ideals'], value: e.target.value })}
            placeholder="Knowledge is the path to power and domination."
            style={{ flex: '1 1 auto' }}
          />
          <button
            type="button"
            onClick={() => requestRandom('ideals')}
            disabled={rolling.ideals || !!randomFatal}
            aria-disabled={rolling.ideals || !!randomFatal}
            aria-describedby="random-ideals-helper"
            aria-label={
              rolling.ideals
                ? 'Rolling ideals. Please wait.'
                : randomFatal
                  ? `Randomization unavailable: ${randomFatal}`
                  : 'Randomize ideals'
            }
            title={
              rolling.ideals
                ? 'Rolling ideals…'
                : randomFatal || 'Generate ideals automatically'
            }
          >
            {rolling.ideals ? (
              <>
                <span className="spinner" aria-hidden="true" /> Rolling…
              </>
            ) : randomFatal ? 'Unavailable' : 'Random'}
          </button>
        </div>
        <small
          id="random-ideals-helper"
          className="muted"
          style={{ color: randomHelper.ideals.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
        >
          {randomHelper.ideals.message || (randomMode === 'local' ? offlineStoryHint('ideals') : 'Use Random to suggest new ideals.')}
        </small>
      </label>
      <label>
        <span>Backstory</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <textarea
            rows={4}
            value={sheet.personality.appearance}
            onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'appearance'], value: e.target.value })}
            placeholder="A paragraph or two is plenty to start."
            style={{ flex: '1 1 auto' }}
          />
          <button
            type="button"
            onClick={() => requestRandom('backstory')}
            disabled={rolling.backstory || !!randomFatal}
            aria-disabled={rolling.backstory || !!randomFatal}
            aria-describedby="random-backstory-helper"
            aria-label={
              rolling.backstory
                ? 'Rolling backstory. Please wait.'
                : randomFatal
                  ? `Randomization unavailable: ${randomFatal}`
                  : 'Randomize backstory'
            }
            title={
              rolling.backstory
                ? 'Rolling backstory…'
                : randomFatal || 'Generate a backstory automatically'
            }
          >
            {rolling.backstory ? (
              <>
                <span className="spinner" aria-hidden="true" /> Rolling…
              </>
            ) : randomFatal ? 'Unavailable' : 'Random'}
          </button>
        </div>
        <small
          id="random-backstory-helper"
          className="muted"
          style={{ color: randomHelper.backstory.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
        >
          {randomHelper.backstory.message || (randomMode === 'local' ? offlineStoryHint('backstory') : 'Use Random to suggest a backstory.')}
        </small>
      </label>
    </CharacterSheetSection>
  );

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Create Player</h1>
      <div className="dnd-surface" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <div className="muted">
          Guided character creation. You can edit everything in the full sheet after.
        </div>
        {error && <div className="dnd-sheet-alert">{error}</div>}
        {status && <div className="dnd-sheet-success">{status}</div>}
        <div className="dnd-sheet-grid">
          <div className="dnd-sheet-column">
            {step === 1 && Step1Identity}
            {step === 2 && Step2Abilities}
            {step === 3 && Step3Story}
          </div>
        </div>
        {/* Bonuses and Summary */}
        <BonusesAndSummary sheet={sheet} derived={derived} />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
          <div>
            {step > 1 && (
              <button type="button" onClick={prev}>Back</button>
            )}
          </div>
          <div>
            {step < 3 && (
              <button type="button" onClick={next}>Next</button>
            )}
            {step === 3 && (
              <PrimaryButton type="button" onClick={finish} loading={saving} loadingText="Generating…">
                Generate Character
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function BonusesAndSummary({ sheet, derived }) {
  const RACE_INFO = {
    Human: { ability: '+1 to all abilities', features: ['Extra Language'] },
    Elf: { ability: '+2 DEX', features: ['Darkvision', 'Keen Senses', 'Fey Ancestry', 'Trance'] },
    'Half-Elf': { ability: '+2 CHA, +1 to two others', features: ['Darkvision', 'Fey Ancestry', 'Skill Versatility'] },
    Dwarf: { ability: '+2 CON', features: ['Darkvision', 'Dwarven Resilience', 'Tool Proficiency'] },
    Halfling: { ability: '+2 DEX', features: ['Lucky', 'Brave', 'Halfling Nimbleness'] },
    Gnome: { ability: '+2 INT', features: ['Darkvision', 'Gnome Cunning'] },
    'Half-Orc': { ability: '+2 STR, +1 CON', features: ['Darkvision', 'Relentless Endurance', 'Savage Attacks'] },
    Tiefling: { ability: '+2 CHA, +1 INT', features: ['Darkvision', 'Hellish Resistance', 'Infernal Legacy'] },
    Dragonborn: { ability: '+2 STR, +1 CHA', features: ['Draconic Ancestry', 'Breath Weapon', 'Damage Resistance'] },
    Goliath: { ability: '+2 STR, +1 CON', features: ["Powerful Build", "Stone's Endurance", 'Mountain Born'] },
    Custom: { ability: 'Customize freely', features: [] },
    '': { ability: '', features: [] },
  };

  const CLASS_INFO = {
    Barbarian: { hitDie: 'd12', saves: ['STR', 'CON'], profs: ['Light/Medium armor', 'Shields', 'Simple/Martial weapons'], features: ['Rage', 'Unarmored Defense'] },
    Bard: { hitDie: 'd8', saves: ['DEX', 'CHA'], profs: ['Light armor', 'Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords', 'Instruments (3)'], features: ['Bardic Inspiration', 'Spellcasting'] },
    Cleric: { hitDie: 'd8', saves: ['WIS', 'CHA'], profs: ['Light/Medium armor', 'Shields', 'Simple weapons'], features: ['Spellcasting', 'Divine Domain'] },
    Druid: { hitDie: 'd8', saves: ['INT', 'WIS'], profs: ['Light/Medium armor (no metal)', 'Shields (no metal)', 'Clubs', 'Daggers', 'Darts', 'Javelins', 'Maces', 'Quarterstaffs', 'Scimitars', 'Sickles', 'Slings', 'Spears'], features: ['Druidic', 'Spellcasting'] },
    Fighter: { hitDie: 'd10', saves: ['STR', 'CON'], profs: ['All armor', 'Shields', 'Simple/Martial weapons'], features: ['Fighting Style', 'Second Wind'] },
    Monk: { hitDie: 'd8', saves: ['STR', 'DEX'], profs: ['Simple weapons', 'Shortswords'], features: ['Martial Arts', 'Unarmored Defense'] },
    Paladin: { hitDie: 'd10', saves: ['WIS', 'CHA'], profs: ['All armor', 'Shields', 'Simple/Martial weapons'], features: ['Divine Sense', 'Lay on Hands'] },
    Ranger: { hitDie: 'd10', saves: ['STR', 'DEX'], profs: ['Light/Medium armor', 'Shields', 'Simple/Martial weapons'], features: ['Favored Enemy (variant)', 'Natural Explorer (variant)'] },
    Rogue: { hitDie: 'd8', saves: ['DEX', 'INT'], profs: ['Light armor', 'Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords', 'Thieves’ tools'], features: ['Expertise', 'Sneak Attack', 'Thieves’ Cant'] },
    Sorcerer: { hitDie: 'd6', saves: ['CON', 'CHA'], profs: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'], features: ['Spellcasting', 'Sorcerous Origin'] },
    Warlock: { hitDie: 'd8', saves: ['WIS', 'CHA'], profs: ['Light armor', 'Simple weapons'], features: ['Otherworldly Patron', 'Pact Magic'] },
    Wizard: { hitDie: 'd6', saves: ['INT', 'WIS'], profs: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'], features: ['Spellbook', 'Arcane Recovery'] },
    Artificer: { hitDie: 'd8', saves: ['CON', 'INT'], profs: ['Light/Medium armor', 'Shields', 'Simple weapons', 'Tinker’s tools + more'], features: ['Magical Tinkering', 'Spellcasting'] },
    '': { hitDie: '', saves: [], profs: [], features: [] },
  };

  const race = String(sheet?.identity?.race || '');
  const klass = String(sheet?.identity?.class || '');
  const raceInfo = RACE_INFO[race] || RACE_INFO[''];
  const classInfo = CLASS_INFO[klass] || CLASS_INFO[''];

  const mods = derived.abilityModifiers || {};
  const abilityLine = `STR ${fmt(mods.str)} · DEX ${fmt(mods.dex)} · CON ${fmt(mods.con)} · INT ${fmt(mods.int)} · WIS ${fmt(mods.wis)} · CHA ${fmt(mods.cha)}`;

  return (
    <section className="dnd-surface" aria-labelledby="bonuses-summary-heading" style={{ display: 'grid', gap: 'var(--space-md)' }}>
      <div className="section-head">
        <h2 id="bonuses-summary-heading">Bonuses & Summary</h2>
        <p className="muted" style={{ marginTop: '0.25rem' }}>You can tweak subclass/multiclass and advanced details later in the full sheet.</p>
      </div>
      <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div className="dnd-surface" style={{ padding: '0.75rem' }}>
          <h3 style={{ marginTop: 0 }}>Racial Bonuses</h3>
          {race ? (
            <>
              <div className="muted">{race}</div>
              {raceInfo.ability && <div><strong>ASI:</strong> {raceInfo.ability}</div>}
              {raceInfo.features?.length ? (
                <ul style={{ margin: '0.5rem 0 0 1rem' }}>
                  {raceInfo.features.map((f) => (<li key={f}>{f}</li>))}
                </ul>
              ) : (
                <div className="muted">No racial features listed.</div>
              )}
            </>
          ) : (
            <div className="muted">Pick a race to see bonuses.</div>
          )}
        </div>
        <div className="dnd-surface" style={{ padding: '0.75rem' }}>
          <h3 style={{ marginTop: 0 }}>Class Bonuses (Level 1)</h3>
          {klass ? (
            <>
              <div className="muted">{klass}</div>
              {classInfo.hitDie && <div><strong>Hit Die:</strong> {classInfo.hitDie}</div>}
              {classInfo.saves?.length ? <div><strong>Saving Throws:</strong> {classInfo.saves.join(', ')}</div> : null}
              {classInfo.profs?.length ? <div><strong>Proficiencies:</strong> {classInfo.profs.join(', ')}</div> : null}
              {classInfo.features?.length ? (
                <ul style={{ margin: '0.5rem 0 0 1rem' }}>
                  {classInfo.features.map((f) => (<li key={f}>{f}</li>))}
                </ul>
              ) : (
                <div className="muted">No class features listed.</div>
              )}
            </>
          ) : (
            <div className="muted">Pick a class to see features.</div>
          )}
        </div>
        <div className="dnd-surface" style={{ padding: '0.75rem' }}>
          <h3 style={{ marginTop: 0 }}>Overall Details</h3>
          <div><strong>Proficiency Bonus:</strong> {derived.proficiencyBonus >= 0 ? `+${derived.proficiencyBonus}` : derived.proficiencyBonus}</div>
          <div><strong>Passives:</strong> Perception {derived.passivePerception} · Investigation {derived.passiveInvestigation} · Insight {derived.passiveInsight}</div>
          <div><strong>Initiative:</strong> {derived.initiative >= 0 ? `+${derived.initiative}` : derived.initiative}</div>
          <div><strong>Ability Mods:</strong> {abilityLine}</div>
        </div>
      </div>
    </section>
  );
}

function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }

function raceBonusFor(race) {
  switch (race) {
    case 'Human':
      return { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 };
    case 'Elf':
      return { dex: 2 };
    case 'Half-Elf':
      return { cha: 2 }; // plus +1 to two others (choose later)
    case 'Dwarf':
      return { con: 2 };
    case 'Halfling':
      return { dex: 2 };
    case 'Gnome':
      return { int: 2 };
    case 'Half-Orc':
      return { str: 2, con: 1 };
    case 'Tiefling':
      return { cha: 2, int: 1 };
    case 'Dragonborn':
      return { str: 2, cha: 1 };
    case 'Goliath':
      return { str: 2, con: 1 };
    default:
      return {};
  }
}

function raceBonusNote(race) {
  if (race === 'Half-Elf') {
    return 'Half-Elf: +2 CHA and +1 to any two other abilities (choose later).';
  }
  if (race === 'Human') {
    return 'Human: +1 to all abilities.';
  }
  if (!race) return '';
  return '';
}

// Prompt helpers for Ollama generation
function buildPrompt(sheet, section) {
  const s = sheet || {};
  const id = s.identity || {};
  const abilities = s.abilityScores || {};
  const story = s.personality || {};
  const core = {
    name: id.name || '',
    class: id.class || '',
    background: id.background || '',
    race: id.race || '',
    level: id.level || 1,
  };
  const abilityLine = `STR ${abilities.str ?? ''}, DEX ${abilities.dex ?? ''}, CON ${abilities.con ?? ''}, INT ${abilities.int ?? ''}, WIS ${abilities.wis ?? ''}, CHA ${abilities.cha ?? ''}`;
  const existing = {
    traits: (story.traits || '').trim(),
    ideals: (story.ideals || '').trim(),
    backstory: (story.appearance || '').trim(),
  };
  const ask = section === 'traits'
    ? 'Suggest 3 concise personality traits that fit.'
    : section === 'ideals'
    ? 'Suggest 2–3 ideals in one line each.'
    : 'Write a 2–4 sentence backstory hook (no spoilers, no names of other PCs).';
  return [
    `You are generating D&D 5e character ${section}.`,
    `Core: ${JSON.stringify(core)}`,
    `Abilities: ${abilityLine}`,
    existing.traits ? `Existing traits: ${existing.traits}` : '',
    existing.ideals ? `Existing ideals: ${existing.ideals}` : '',
    existing.backstory ? `Existing backstory: ${existing.backstory}` : '',
    ask,
  ].filter(Boolean).join('\n');
}

function buildSystem(section) {
  if (section === 'traits') {
    return 'Return only a comma-separated list of 3 short traits. Keep it grounded and playable.';
  }
  if (section === 'ideals') {
    return 'Return only 2–3 short ideals, each separated by semicolons. Avoid contradictions.';
  }
  return 'Return only a single compact paragraph (2–4 sentences). No markdown headings.';
}
