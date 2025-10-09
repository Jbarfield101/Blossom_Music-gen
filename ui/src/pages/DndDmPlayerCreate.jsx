import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import AbilityScoreInputs from '../components/AbilityScoreInputs.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { createPlayer } from '../api/players';
import {
  ABILITY_SCORES,
  SKILL_LIST,
  SPELL_SLOT_LEVELS,
  serializeCharacterSheet,
  buildDerivedStats,
  createEmptyPlayerSheet,
  playerSheetReducer,
  formatModifier,
} from '../lib/playerSheet.js';
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

  const classFeatureCount = sheet?.classFeatures?.length ?? 0;
  useEffect(() => {
    if (classFeatureCount === 0) {
      dispatch({ type: 'addClassFeature' });
    }
  }, [classFeatureCount]);

  // Initialize point-buy baseline to 8 if still at defaults (commonly 10)
  useEffect(() => {
    const abilities = sheet?.abilityScores || {};
    const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const allDefault10 = keys.every((k) => Number(abilities[k]) === 10);
    if (allDefault10) {
      keys.forEach((k) => dispatch({ type: 'setField', path: ['abilityScores', k], value: 8 }));
    }
  }, [sheet?.abilityScores]);

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
          dispatch({ type: 'setField', path: ['personality', 'backstory'], value });
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

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      finish();
    },
    [finish]
  );

  const attacks = Array.isArray(sheet?.combat?.attacks) ? sheet.combat.attacks : [];
  const multiclass = Array.isArray(sheet?.multiclass?.classes) ? sheet.multiclass.classes : [];

  return (
    <div className="dnd-sheet-page">
      <BackButton to="/dnd/dungeon-master/players" label="Back to players" />
      <div className="dnd-sheet-header">
        <div>
          <h1>Character Sheet Builder</h1>
          <p>Create a full D&D 5e sheet with the familiar three-column layout and save it to your roster.</p>
        </div>
        <div className="dnd-sheet-toolbar">
          <PrimaryButton type="button" onClick={finish} disabled={saving}>
            {saving ? 'Saving…' : 'Create Character'}
          </PrimaryButton>
        </div>
      </div>
      {error ? <div className="dnd-sheet-alert">{error}</div> : null}
      {status ? <div className="dnd-sheet-success">{status}</div> : null}
      {randomGlobalError ? <div className="dnd-sheet-alert" role="status">{randomGlobalError}</div> : null}

      <form className="dnd-sheet-form" onSubmit={handleSubmit}>
        <section className="dnd-sheet-section">
          <div className="dnd-sheet-section__header">
            <div className="dnd-sheet-section__headings">
              <h2>Identity</h2>
              <p className="dnd-sheet-section__description">Core adventurer information for the header of the sheet.</p>
            </div>
          </div>
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
            </label>
            <label>
              <span>Class</span>
              <input
                type="text"
                value={sheet.identity.class}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'class'], value: e.target.value })}
                placeholder="Wizard"
              />
            </label>
            <label>
              <span>Subclass</span>
              <input
                type="text"
                value={sheet.identity.subclass}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'subclass'], value: e.target.value })}
                placeholder="School of Evocation"
              />
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
              <input
                type="text"
                value={sheet.identity.background}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'background'], value: e.target.value })}
                placeholder="Sage"
              />
            </label>
            <label>
              <span>Player Name</span>
              <input
                type="text"
                value={sheet.identity.playerName}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'playerName'], value: e.target.value })}
              />
            </label>
            <label>
              <span>Race</span>
              <input
                type="text"
                value={sheet.identity.race}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'race'], value: e.target.value })}
              />
            </label>
            <label>
              <span>Alignment</span>
              <input
                type="text"
                value={sheet.identity.alignment}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'alignment'], value: e.target.value })}
              />
            </label>
            <label>
              <span>Experience Points</span>
              <input
                type="number"
                min="0"
                value={sheet.identity.experience}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'experience'], value: toNum(e.target.value, 0) })}
              />
            </label>
            <label className="dnd-identity-checkbox">
              <input
                type="checkbox"
                checked={sheet.identity.inspiration}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'inspiration'], value: e.target.checked })}
              />
              <span>Inspiration</span>
            </label>
            <label>
              <span>Proficiency Bonus Override</span>
              <input
                type="number"
                value={sheet.identity.proficiencyBonusOverride}
                onChange={(e) => dispatch({ type: 'setField', path: ['identity', 'proficiencyBonusOverride'], value: toNum(e.target.value, -10, 10) })}
                placeholder={formatModifier(derived.proficiencyBonus)}
              />
            </label>
          </div>
          <div className="dnd-sheet-quickstats">
            <div>
              <span>Total Level</span>
              <strong>{derived.totalLevel}</strong>
            </div>
            <div>
              <span>Proficiency Bonus</span>
              <strong>{formatModifier(derived.proficiencyBonus)}</strong>
            </div>
            <div>
              <span>Passive Perception</span>
              <strong>{derived.passivePerception}</strong>
            </div>
            <div>
              <span>Passive Investigation</span>
              <strong>{derived.passiveInvestigation}</strong>
            </div>
            <div>
              <span>Passive Insight</span>
              <strong>{derived.passiveInsight}</strong>
            </div>
            <div>
              <span>Initiative</span>
              <strong>{formatModifier(derived.initiative)}</strong>
            </div>
          </div>
        </section>

        <div className="dnd-sheet-columns">
          <div className="dnd-sheet-column dnd-sheet-column--left">
            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Ability Scores</h2>
                  <p className="dnd-sheet-section__description">Track final ability values, including racial bonuses.</p>
                </div>
              </div>
              <AbilityScoreInputs
                scores={sheet.abilityScores}
                modifiers={derived.abilityModifiers}
                onChange={(ability, value) =>
                  dispatch({ type: 'setField', path: ['abilityScores', ability], value: toNum(value, 1, 30) })
                }
                pointBuy={false}
              />
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Saving Throws</h2>
                  <p className="dnd-sheet-section__description">Mark proficiency and misc bonuses for each save.</p>
                </div>
              </div>
              <div className="dnd-saving-throws">
                {ABILITY_SCORES.map(({ key, label }) => {
                  const data = sheet.savingThrows?.[key] || { proficient: false, misc: 0 };
                  return (
                    <div key={key} className="dnd-saving-throw-row">
                      <div className="dnd-saving-throw-main">
                        <input
                          type="checkbox"
                          checked={Boolean(data.proficient)}
                          onChange={() => dispatch({ type: 'toggleSavingThrow', ability: key })}
                        />
                        <span>{label}</span>
                      </div>
                      <div className="dnd-saving-throw-values">
                        <span className="dnd-saving-throw-total">{formatModifier(derived.savingThrows[key])}</span>
                        <span>Mod {formatModifier(derived.abilityModifiers[key])}</span>
                      </div>
                      <label className="dnd-saving-throw-misc">
                        <span>Misc</span>
                        <input
                          type="number"
                          value={data.misc === 0 ? '' : data.misc}
                          onChange={(e) =>
                            dispatch({ type: 'setSavingThrowMisc', ability: key, value: toNum(e.target.value, -99, 99) })
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Skills</h2>
                  <p className="dnd-sheet-section__description">Toggle proficiency, expertise, and situational modifiers.</p>
                </div>
              </div>
              <table className="dnd-skill-table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Total</th>
                    <th>Prof.</th>
                    <th>Expertise</th>
                    <th>Misc</th>
                  </tr>
                </thead>
                <tbody>
                  {SKILL_LIST.map((skill) => {
                    const data = sheet.skills?.[skill.key] || { proficient: false, expertise: false, misc: 0 };
                    const total = derived.skills?.[skill.key]?.total ?? 0;
                    return (
                      <tr key={skill.key}>
                        <td className="dnd-skill-label">
                          <span>{skill.label}</span>
                          <small>({skill.ability.toUpperCase()})</small>
                        </td>
                        <td className="dnd-skill-total">{formatModifier(total)}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(data.proficient)}
                            onChange={() => dispatch({ type: 'toggleSkill', skill: skill.key })}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={Boolean(data.expertise)}
                            onChange={() => dispatch({ type: 'toggleSkillExpertise', skill: skill.key })}
                          />
                        </td>
                        <td>
                          <input
                            className="dnd-skill-misc"
                            type="number"
                            value={data.misc === 0 ? '' : data.misc}
                            onChange={(e) =>
                              dispatch({ type: 'setSkillMisc', skill: skill.key, value: toNum(e.target.value, -99, 99) })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <label>
                <span>Senses</span>
                <textarea
                  rows={2}
                  value={sheet.senses}
                  onChange={(e) => dispatch({ type: 'setField', path: ['senses'], value: e.target.value })}
                  placeholder="Darkvision 60 ft., Passive Perception 14"
                />
              </label>
              <label>
                <span>Passive Insight Notes</span>
                <textarea
                  rows={2}
                  value={sheet.passiveInsightNotes}
                  onChange={(e) => dispatch({ type: 'setField', path: ['passiveInsightNotes'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Passive Investigation Notes</span>
                <textarea
                  rows={2}
                  value={sheet.passiveInvestigationNotes}
                  onChange={(e) => dispatch({ type: 'setField', path: ['passiveInvestigationNotes'], value: e.target.value })}
                />
              </label>
            </section>
          </div>

          <div className="dnd-sheet-column dnd-sheet-column--center">
            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Combat Stats</h2>
                  <p className="dnd-sheet-section__description">Armor, hit points, speed, and death saves.</p>
                </div>
              </div>
              <div className="dnd-combat-grid">
                <label>
                  <span>Armor Class</span>
                  <input
                    type="number"
                    value={sheet.combat.armorClass}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'armorClass'], value: toNum(e.target.value, 0) })}
                  />
                </label>
                <label>
                  <span>Speed (ft)</span>
                  <input
                    type="number"
                    value={sheet.combat.speed}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'speed'], value: toNum(e.target.value, 0) })}
                  />
                </label>
                <label>
                  <span>Max HP</span>
                  <input
                    type="number"
                    value={sheet.combat.maxHp}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'maxHp'], value: toNum(e.target.value, 0) })}
                  />
                </label>
                <label>
                  <span>Current HP</span>
                  <input
                    type="number"
                    value={sheet.combat.currentHp}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'currentHp'], value: toNum(e.target.value, 0) })}
                  />
                </label>
                <label>
                  <span>Temporary HP</span>
                  <input
                    type="number"
                    value={sheet.combat.tempHp}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'tempHp'], value: toNum(e.target.value, 0) })}
                  />
                </label>
                <label>
                  <span>Hit Dice</span>
                  <input
                    type="text"
                    value={sheet.combat.hitDice}
                    onChange={(e) => dispatch({ type: 'setField', path: ['combat', 'hitDice'], value: e.target.value })}
                    placeholder="2d6 + 1d8"
                  />
                </label>
                <label>
                  <span>Initiative Bonus</span>
                  <input
                    type="number"
                    value={sheet.combat.initiativeBonus}
                    onChange={(e) =>
                      dispatch({ type: 'setField', path: ['combat', 'initiativeBonus'], value: toNum(e.target.value, -20, 20) })
                    }
                  />
                </label>
              </div>
              <div className="dnd-death-saves">
                <div className="dnd-death-saves-column">
                  <span>Death Saves – Successes</span>
                  <input
                    type="number"
                    min="0"
                    max="3"
                    value={sheet.combat.deathSaves.successes}
                    onChange={(e) =>
                      dispatch({
                        type: 'setField',
                        path: ['combat', 'deathSaves', 'successes'],
                        value: toNum(e.target.value, 0, 3),
                      })
                    }
                  />
                </div>
                <div className="dnd-death-saves-column">
                  <span>Death Saves – Failures</span>
                  <input
                    type="number"
                    min="0"
                    max="3"
                    value={sheet.combat.deathSaves.failures}
                    onChange={(e) =>
                      dispatch({
                        type: 'setField',
                        path: ['combat', 'deathSaves', 'failures'],
                        value: toNum(e.target.value, 0, 3),
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Attacks & Spellcasting</h2>
                  <p className="dnd-sheet-section__description">Document weapon and spell attacks with bonuses and notes.</p>
                </div>
                <div className="dnd-sheet-section__actions">
                  <button type="button" className="dnd-attack-add" onClick={() => dispatch({ type: 'addAttack' })}>
                    Add attack
                  </button>
                </div>
              </div>
              <div className="dnd-attacks-editor">
                {attacks.map((attack, index) => (
                  <div key={index} className="dnd-attack-row">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={attack.name}
                        onChange={(e) =>
                          dispatch({ type: 'setField', path: ['combat', 'attacks', index, 'name'], value: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Attack Bonus</span>
                      <input
                        type="text"
                        value={attack.bonus}
                        onChange={(e) =>
                          dispatch({ type: 'setField', path: ['combat', 'attacks', index, 'bonus'], value: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Damage/Type</span>
                      <input
                        type="text"
                        value={attack.damage}
                        onChange={(e) =>
                          dispatch({ type: 'setField', path: ['combat', 'attacks', index, 'damage'], value: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Notes</span>
                      <input
                        type="text"
                        value={attack.notes}
                        onChange={(e) =>
                          dispatch({ type: 'setField', path: ['combat', 'attacks', index, 'notes'], value: e.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="dnd-attack-remove"
                      onClick={() => dispatch({ type: 'removeAttack', index })}
                      aria-label={`Remove attack ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Features & Traits</h2>
                  <p className="dnd-sheet-section__description">Track racial traits, class features, and resource notes.</p>
                </div>
              </div>
              <label>
                <span>Proficiencies</span>
                <textarea
                  rows={2}
                  value={sheet.proficiencies}
                  onChange={(e) => dispatch({ type: 'setField', path: ['proficiencies'], value: e.target.value })}
                  placeholder="Armor, weapons, tools"
                />
              </label>
              <label>
                <span>Languages</span>
                <textarea
                  rows={2}
                  value={sheet.languages}
                  onChange={(e) => dispatch({ type: 'setField', path: ['languages'], value: e.target.value })}
                  placeholder="Common, Elvish, Draconic"
                />
              </label>
              <label>
                <span>Features & Traits</span>
                <textarea
                  rows={4}
                  value={sheet.features}
                  onChange={(e) => dispatch({ type: 'setField', path: ['features'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Class Resources</span>
                <textarea
                  rows={3}
                  value={sheet.resources.features}
                  onChange={(e) => dispatch({ type: 'setField', path: ['resources', 'features'], value: e.target.value })}
                  placeholder="Superiority Dice (d8) ×4, Action Surge 1/short rest"
                />
              </label>
              <label>
                <span>Resource Notes</span>
                <textarea
                  rows={3}
                  value={sheet.resources.notes}
                  onChange={(e) => dispatch({ type: 'setField', path: ['resources', 'notes'], value: e.target.value })}
                />
              </label>
              <div className="dnd-class-features">
                <h3>Class Features</h3>
                <p className="muted">Detail level-based feature unlocks across all classes.</p>
                {sheet.classFeatures?.map((feature, index) => (
                  <div key={index} className="dnd-class-feature-row">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        value={feature.name}
                        onChange={(e) =>
                          dispatch({ type: 'updateClassFeature', index, field: 'name', value: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Level</span>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={feature.level}
                        onChange={(e) =>
                          dispatch({ type: 'updateClassFeature', index, field: 'level', value: toNum(e.target.value, 1, 20) })
                        }
                      />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea
                        rows={2}
                        value={feature.description}
                        onChange={(e) =>
                          dispatch({ type: 'updateClassFeature', index, field: 'description', value: e.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'removeClassFeature', index })}
                      className="dnd-class-feature-remove"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => dispatch({ type: 'addClassFeature' })} className="dnd-class-feature-add">
                  Add class feature
                </button>
              </div>
            </section>
          </div>

          <div className="dnd-sheet-column dnd-sheet-column--right">
            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Spellcasting</h2>
                  <p className="dnd-sheet-section__description">Spellcasting ability, save DCs, slots, and spell lists.</p>
                </div>
              </div>
              <div className="dnd-spellcasting-grid">
                <label>
                  <span>Spellcasting Ability</span>
                  <select
                    value={sheet.spellcasting.ability}
                    onChange={(e) => dispatch({ type: 'setField', path: ['spellcasting', 'ability'], value: e.target.value })}
                  >
                    {ABILITY_SCORES.map((ability) => (
                      <option key={ability.key} value={ability.key}>
                        {ability.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Spell Save DC</span>
                  <input
                    type="number"
                    value={sheet.spellcasting.saveDc}
                    onChange={(e) => dispatch({ type: 'setField', path: ['spellcasting', 'saveDc'], value: toNum(e.target.value, 0) })}
                    placeholder={derived.spellcasting.suggestedSaveDc}
                  />
                </label>
                <label>
                  <span>Spell Attack Bonus</span>
                  <input
                    type="number"
                    value={sheet.spellcasting.attackBonus}
                    onChange={(e) =>
                      dispatch({ type: 'setField', path: ['spellcasting', 'attackBonus'], value: toNum(e.target.value, -20, 20) })
                    }
                    placeholder={formatModifier(derived.spellcasting.suggestedAttackBonus)}
                  />
                </label>
              </div>
              <div className="dnd-spell-slots">
                {SPELL_SLOT_LEVELS.map((level, index) => (
                  <label key={level} className="dnd-spell-slot-row">
                    <span>{level === 'cantrips' ? 'Cantrips Known' : `Level ${index} Slots`}</span>
                    <input
                      type="text"
                      value={sheet.spellcasting.slots[level]}
                      onChange={(e) =>
                        dispatch({ type: 'setField', path: ['spellcasting', 'slots', level], value: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                <span>Prepared Spells</span>
                <textarea
                  rows={3}
                  value={sheet.spellcasting.prepared}
                  onChange={(e) => dispatch({ type: 'setField', path: ['spellcasting', 'prepared'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Known Spells</span>
                <textarea
                  rows={3}
                  value={sheet.spellcasting.known}
                  onChange={(e) => dispatch({ type: 'setField', path: ['spellcasting', 'known'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Spell Notes</span>
                <textarea
                  rows={3}
                  value={sheet.spellcasting.notes}
                  onChange={(e) => dispatch({ type: 'setField', path: ['spellcasting', 'notes'], value: e.target.value })}
                />
              </label>
              <div className="dnd-spell-lists">
                <h3>Spell Lists</h3>
                <p className="muted">Track prepared or known spells by level.</p>
                {SPELL_SLOT_LEVELS.map((level, index) => (
                  <label key={level}>
                    <span>{level === 'cantrips' ? 'Cantrips' : `Level ${index}`}</span>
                    <textarea
                      rows={index <= 2 ? 3 : 2}
                      value={sheet.spellcasting.spellLists[level]}
                      onChange={(e) =>
                        dispatch({ type: 'setSpellList', level, value: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Equipment</h2>
                  <p className="dnd-sheet-section__description">Currency, inventory, and treasure carried.</p>
                </div>
              </div>
              <div className="dnd-currency-grid">
                {['cp', 'sp', 'ep', 'gp', 'pp'].map((coin) => (
                  <label key={coin} className="dnd-currency-field">
                    <span>{coin.toUpperCase()}</span>
                    <input
                      type="number"
                      min="0"
                      value={sheet.equipment[coin]}
                      onChange={(e) => dispatch({ type: 'setField', path: ['equipment', coin], value: toNum(e.target.value, 0) })}
                    />
                  </label>
                ))}
              </div>
              <label>
                <span>Inventory</span>
                <textarea
                  rows={3}
                  value={sheet.equipment.inventory}
                  onChange={(e) => dispatch({ type: 'setField', path: ['equipment', 'inventory'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Treasure</span>
                <textarea
                  rows={3}
                  value={sheet.equipment.treasure}
                  onChange={(e) => dispatch({ type: 'setField', path: ['equipment', 'treasure'], value: e.target.value })}
                />
              </label>
              <label>
                <span>Other Equipment</span>
                <textarea
                  rows={3}
                  value={sheet.equipment.other}
                  onChange={(e) => dispatch({ type: 'setField', path: ['equipment', 'other'], value: e.target.value })}
                />
              </label>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Personality & Story</h2>
                  <p className="dnd-sheet-section__description">Detail personality traits, bonds, flaws, and your backstory.</p>
                </div>
              </div>
              <div className="dnd-random-section">
                <label>
                  <span>Traits</span>
                  <div className="dnd-random-row">
                    <textarea
                      rows={2}
                      value={sheet.personality.traits}
                      onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'traits'], value: e.target.value })}
                      placeholder="Curious, soft-spoken, fiercely loyal."
                    />
                    <button
                      type="button"
                      onClick={() => requestRandom('traits')}
                      disabled={rolling.traits || !!randomFatal}
                      aria-disabled={rolling.traits || !!randomFatal}
                    >
                      {rolling.traits ? 'Rolling…' : randomFatal ? 'Unavailable' : 'Random'}
                    </button>
                  </div>
                  <small
                    className="muted"
                    style={{ color: randomHelper.traits.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
                  >
                    {randomHelper.traits.message ||
                      (randomMode === 'local' ? offlineStoryHint('traits') : 'Use Random to suggest new personality traits.')}
                  </small>
                </label>
                <label>
                  <span>Ideals</span>
                  <div className="dnd-random-row">
                    <textarea
                      rows={2}
                      value={sheet.personality.ideals}
                      onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'ideals'], value: e.target.value })}
                      placeholder="Knowledge is the path to power and domination."
                    />
                    <button
                      type="button"
                      onClick={() => requestRandom('ideals')}
                      disabled={rolling.ideals || !!randomFatal}
                      aria-disabled={rolling.ideals || !!randomFatal}
                    >
                      {rolling.ideals ? 'Rolling…' : randomFatal ? 'Unavailable' : 'Random'}
                    </button>
                  </div>
                  <small
                    className="muted"
                    style={{ color: randomHelper.ideals.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
                  >
                    {randomHelper.ideals.message ||
                      (randomMode === 'local' ? offlineStoryHint('ideals') : 'Use Random to suggest new ideals.')}
                  </small>
                </label>
                <label>
                  <span>Bonds</span>
                  <textarea
                    rows={2}
                    value={sheet.personality.bonds}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'bonds'], value: e.target.value })}
                  />
                </label>
                <label>
                  <span>Flaws</span>
                  <textarea
                    rows={2}
                    value={sheet.personality.flaws}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'flaws'], value: e.target.value })}
                  />
                </label>
                <label>
                  <span>Appearance</span>
                  <textarea
                    rows={3}
                    value={sheet.personality.appearance}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'appearance'], value: e.target.value })}
                  />
                </label>
                <label>
                  <span>Allies & Organizations</span>
                  <textarea
                    rows={3}
                    value={sheet.personality.allies}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'allies'], value: e.target.value })}
                  />
                </label>
                <label>
                  <span>Organizations Notes</span>
                  <textarea
                    rows={3}
                    value={sheet.personality.organizations}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'organizations'], value: e.target.value })}
                  />
                </label>
                <label>
                  <span>Backstory</span>
                  <div className="dnd-random-row">
                    <textarea
                      rows={4}
                      value={sheet.personality.backstory}
                      onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'backstory'], value: e.target.value })}
                      placeholder="A paragraph or two is plenty to start."
                    />
                    <button
                      type="button"
                      onClick={() => requestRandom('backstory')}
                      disabled={rolling.backstory || !!randomFatal}
                      aria-disabled={rolling.backstory || !!randomFatal}
                    >
                      {rolling.backstory ? 'Rolling…' : randomFatal ? 'Unavailable' : 'Random'}
                    </button>
                  </div>
                  <small
                    className="muted"
                    style={{ color: randomHelper.backstory.tone === 'error' ? 'var(--color-danger, #b00020)' : undefined }}
                  >
                    {randomHelper.backstory.message ||
                      (randomMode === 'local' ? offlineStoryHint('backstory') : 'Use Random to suggest a backstory hook.')}
                  </small>
                </label>
                <label>
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={sheet.personality.notes}
                    onChange={(e) => dispatch({ type: 'setField', path: ['personality', 'notes'], value: e.target.value })}
                  />
                </label>
              </div>
            </section>

            <section className="dnd-sheet-section">
              <div className="dnd-sheet-section__header">
                <div className="dnd-sheet-section__headings">
                  <h2>Multiclass Details</h2>
                  <p className="dnd-sheet-section__description">Track additional class levels beyond your primary class.</p>
                </div>
                <div className="dnd-sheet-section__actions">
                  <button type="button" onClick={() => dispatch({ type: 'addMulticlass' })}>
                    Add class
                  </button>
                </div>
              </div>
              {multiclass.length === 0 ? (
                <p className="muted">No additional classes yet. Add entries as you multiclass.</p>
              ) : (
                <div className="dnd-multiclass-grid">
                  {multiclass.map((entry, index) => (
                    <div key={index} className="dnd-multiclass-row">
                      <label>
                        <span>Class</span>
                        <input
                          type="text"
                          value={entry.className}
                          onChange={(e) =>
                            dispatch({ type: 'updateMulticlass', index, field: 'className', value: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Subclass</span>
                        <input
                          type="text"
                          value={entry.subclass}
                          onChange={(e) =>
                            dispatch({ type: 'updateMulticlass', index, field: 'subclass', value: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>Level</span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={entry.level}
                          onChange={(e) =>
                            dispatch({ type: 'updateMulticlass', index, field: 'level', value: toNum(e.target.value, 1, 20) })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'removeMulticlass', index })}
                        className="dnd-multiclass-remove"
                        aria-label={`Remove multiclass entry ${index + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="dnd-sheet-toolbar">
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create Character'}
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
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
    backstory: (story.backstory || '').trim(),
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
