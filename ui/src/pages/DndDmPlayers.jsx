import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import CharacterSheetSection from '../components/CharacterSheetSection.jsx';
import AbilityScoreInputs from '../components/AbilityScoreInputs.jsx';
import SavingThrowList from '../components/SavingThrowList.jsx';
import SkillList from '../components/SkillList.jsx';
import SpellSlotsEditor from '../components/SpellSlotsEditor.jsx';
import AttacksEditor from '../components/AttacksEditor.jsx';
import CurrencyInputs from '../components/CurrencyInputs.jsx';
import DeathSavesTracker from '../components/DeathSavesTracker.jsx';
import { createPlayer } from '../api/players';
import { getConfig, setConfig } from '../api/config';
import {
  buildDerivedStats,
  createEmptyPlayerSheet,
  formatModifier,
  parsePlayerSheetImport,
  playerSheetReducer,
  serializeCharacterSheet,
  serializePlayerSheetToJson,
  validatePlayerSheet,
} from '../lib/playerSheet.js';
import './Dnd.css';

function slugify(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/--+/g, '-')
    || 'character';
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toNumeric(value, { clampMin, clampMax } = {}) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (typeof clampMin === 'number' && num < clampMin) return clampMin;
  if (typeof clampMax === 'number' && num > clampMax) return clampMax;
  return num;
}

export default function DndDmPlayers() {
  const [sheet, dispatch] = useReducer(playerSheetReducer, null, createEmptyPlayerSheet);
  const derived = useMemo(() => buildDerivedStats(sheet), [sheet]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSavedPath, setLastSavedPath] = useState('');
  const [templatePath, setTemplatePath] = useState('');
  const [directoryOverride, setDirectoryOverride] = useState('');
  const [templateDefault, setTemplateDefault] = useState('');
  const [directoryDefault, setDirectoryDefault] = useState('');
  const [usePrefill, setUsePrefill] = useState(false);
  const [prefillPrompt, setPrefillPrompt] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [templateValue, directoryValue] = await Promise.all([
          getConfig('dndPlayerTemplate').catch(() => ''),
          getConfig('dndPlayerDirectory').catch(() => ''),
        ]);
        if (cancelled) return;
        if (typeof templateValue === 'string') {
          setTemplatePath(templateValue);
          setTemplateDefault(templateValue);
        }
        if (typeof directoryValue === 'string') {
          setDirectoryOverride(directoryValue);
          setDirectoryDefault(directoryValue);
        }
      } catch (err) {
        console.warn('Failed to load player sheet configuration', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAbilityChange = useCallback((ability, value) => {
    const next = value === '' ? '' : toNumeric(value, { clampMin: 0, clampMax: 30 });
    dispatch({ type: 'setField', path: ['abilityScores', ability], value: next });
  }, []);

  const handleSavingThrowMisc = useCallback((ability, value) => {
    const next = value === '' ? '' : toNumeric(value, { clampMin: -99, clampMax: 99 });
    dispatch({ type: 'setSavingThrowMisc', ability, value: next });
  }, []);

  const handleSkillMisc = useCallback((skill, value) => {
    const next = value === '' ? '' : toNumeric(value, { clampMin: -99, clampMax: 99 });
    dispatch({ type: 'setSkillMisc', skill, value: next });
  }, []);

  const handleAttackChange = useCallback((attacks) => {
    dispatch({ type: 'updateAttacks', attacks });
  }, []);

  const handleAttackAdd = useCallback((template) => {
    const current = Array.isArray(sheet?.combat?.attacks) ? sheet.combat.attacks : [];
    if (current.length >= 8) return;
    const next = [...current, { ...template }];
    dispatch({ type: 'updateAttacks', attacks: next });
  }, [sheet?.combat?.attacks]);

  const handleAttackRemove = useCallback((index) => {
    const current = Array.isArray(sheet?.combat?.attacks) ? sheet.combat.attacks : [];
    const next = current.filter((_, idx) => idx !== index);
    dispatch({ type: 'updateAttacks', attacks: next });
  }, [sheet?.combat?.attacks]);

  const handleDeathSaveChange = useCallback((type, count) => {
    const clamped = Math.max(0, Math.min(3, count));
    const key = type === 'success' ? 'successes' : 'failures';
    dispatch({ type: 'setField', path: ['combat', 'deathSaves', key], value: clamped });
  }, []);

  const handleSpellSlotChange = useCallback((levelKey, value) => {
    dispatch({ type: 'setField', path: ['spellcasting', 'slots', levelKey], value });
  }, []);

  const handleCurrencyChange = useCallback((key, value) => {
    dispatch({ type: 'setField', path: ['equipment', key], value });
  }, []);

  const triggerImport = useCallback(() => {
    setError('');
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parsePlayerSheetImport(text);
      dispatch({ type: 'replace', value: imported });
      setStatus(`Imported ${file.name}`);
      setError('');
    } catch (err) {
      setStatus('');
      setError(err?.message || 'Failed to import file.');
    } finally {
      event.target.value = '';
    }
  }, []);

  const handleExportJson = useCallback(() => {
    try {
      const json = serializePlayerSheetToJson(sheet);
      const filename = `${slugify(sheet?.identity?.name)}.character.json`;
      downloadFile(filename, json, 'application/json');
      setStatus('Exported sheet as JSON.');
      setError('');
    } catch (err) {
      setError('Unable to export sheet as JSON.');
      console.error(err);
    }
  }, [sheet]);

  const handleExportMarkdown = useCallback(() => {
    try {
      const markdown = serializeCharacterSheet(sheet);
      const filename = `${slugify(sheet?.identity?.name)}.md`;
      downloadFile(filename, markdown, 'text/markdown');
      setStatus('Exported sheet as Markdown.');
      setError('');
    } catch (err) {
      setError('Unable to export sheet as Markdown.');
      console.error(err);
    }
  }, [sheet]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'reset' });
    setStatus('Cleared character sheet.');
    setError('');
  }, []);

  const saveTemplateDefault = useCallback(async () => {
    try {
      await setConfig('dndPlayerTemplate', templatePath || '');
      setTemplateDefault(templatePath || '');
      setStatus('Updated default template path.');
      setError('');
    } catch (err) {
      setError('Failed to update template preference.');
      console.error(err);
    }
  }, [templatePath]);

  const saveDirectoryDefault = useCallback(async () => {
    try {
      await setConfig('dndPlayerDirectory', directoryOverride || '');
      setDirectoryDefault(directoryOverride || '');
      setStatus('Updated default player directory.');
      setError('');
    } catch (err) {
      setError('Failed to update directory preference.');
      console.error(err);
    }
  }, [directoryOverride]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (saving) return;
    setStatus('');
    const validation = validatePlayerSheet(sheet);
    if (validation.length) {
      setError(validation.join(' '));
      return;
    }
    try {
      setSaving(true);
      setError('');
      const markdown = serializeCharacterSheet(sheet);
      const payload = {
        name: sheet?.identity?.name || 'Adventurer',
        markdown,
        sheet,
        template: templatePath?.trim() ? templatePath.trim() : undefined,
        directory: directoryOverride?.trim() ? directoryOverride.trim() : undefined,
        usePrefill: usePrefill || Boolean(prefillPrompt.trim()),
        prefillPrompt: prefillPrompt.trim() || undefined,
      };
      const savedPath = await createPlayer(payload);
      setLastSavedPath(savedPath || '');
      setStatus(savedPath ? `Saved character sheet to ${savedPath}` : 'Character sheet saved.');
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Failed to save character sheet.');
    } finally {
      setSaving(false);
    }
  }, [saving, sheet, templatePath, directoryOverride, usePrefill, prefillPrompt]);

  const savingThrowItems = useMemo(() => {
    return Object.fromEntries(
      Object.entries(derived.savingThrows).map(([key, total]) => {
        const source = sheet?.savingThrows?.[key] || {};
        return [key, { total, misc: source.misc ?? '', proficient: Boolean(source.proficient) }];
      })
    );
  }, [derived.savingThrows, sheet?.savingThrows]);

  const skillItems = useMemo(() => {
    const items = {};
    for (const [key, data] of Object.entries(derived.skills)) {
      const source = sheet?.skills?.[key] || {};
      items[key] = {
        ...data,
        misc: source.misc ?? '',
      };
    }
    return items;
  }, [derived.skills, sheet?.skills]);

  const renderQuickStats = (
    <div className="dnd-sheet-quickstats">
      <div>
        <span>Proficiency Bonus</span>
        <strong>{formatModifier(derived.proficiencyBonus)}</strong>
      </div>
      <div>
        <span>Initiative</span>
        <strong>{formatModifier(derived.initiative)}</strong>
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
    </div>
  );

  const inspirationId = 'player-inspiration';

  return (
    <>
      <BackButton />
      <div className="dnd-sheet-page">
        <header className="dnd-sheet-header">
          <div>
            <h1>Dungeons &amp; Dragons · Player Sheets</h1>
            <p>
              Craft and export rich Roll20-style character sheets with automated modifiers,
              skill tracking, spell slots, and vault persistence.
            </p>
          </div>
          <div className="dnd-sheet-toolbar">
            <button type="button" onClick={triggerImport}>
              Import JSON
            </button>
            <button type="button" onClick={handleExportJson}>
              Export JSON
            </button>
            <button type="button" onClick={handleExportMarkdown}>
              Export Markdown
            </button>
            <button type="button" onClick={handleReset}>
              Reset
            </button>
          </div>
        </header>

        {error && (
          <div className="dnd-sheet-alert" role="alert">
            {error}
          </div>
        )}
        {status && (
          <div className="dnd-sheet-success" role="status">
            {status}
          </div>
        )}
        {lastSavedPath && (
          <div className="dnd-sheet-path">Last saved to: {lastSavedPath}</div>
        )}

        <form className="dnd-sheet-form" onSubmit={handleSubmit}>
          <div className="dnd-sheet-grid">
            <div className="dnd-sheet-column">
              <CharacterSheetSection
                title="Identity"
                description="Core character information and quick stats."
              >
                <div className="dnd-identity-grid">
                  <label>
                    <span>Name</span>
                    <input
                      type="text"
                      value={sheet.identity.name}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'name'],
                          value: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Class &amp; Subclass</span>
                    <input
                      type="text"
                      value={sheet.identity.class}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'class'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Level</span>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={sheet.identity.level}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'level'],
                          value: toNumeric(event.target.value, {
                            clampMin: 1,
                            clampMax: 20,
                          }),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Background</span>
                    <input
                      type="text"
                      value={sheet.identity.background}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'background'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Player</span>
                    <input
                      type="text"
                      value={sheet.identity.playerName}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'playerName'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Race</span>
                    <input
                      type="text"
                      value={sheet.identity.race}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'race'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Alignment</span>
                    <input
                      type="text"
                      value={sheet.identity.alignment}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'alignment'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Experience</span>
                    <input
                      type="text"
                      value={sheet.identity.experience}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'experience'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Proficiency Bonus Override</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={sheet.identity.proficiencyBonusOverride}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'proficiencyBonusOverride'],
                          value: event.target.value,
                        })
                      }
                      placeholder="Auto from level"
                    />
                  </label>
                  <label className="dnd-identity-checkbox" htmlFor={inspirationId}>
                    <input
                      id={inspirationId}
                      type="checkbox"
                      checked={Boolean(sheet.identity.inspiration)}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['identity', 'inspiration'],
                          value: event.target.checked,
                        })
                      }
                    />
                    Inspiration
                  </label>
                </div>
                {renderQuickStats}
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Ability Scores"
                description="Track ability scores with automatic modifier calculation."
              >
                <AbilityScoreInputs
                  scores={sheet.abilityScores}
                  modifiers={derived.abilityModifiers}
                  onChange={handleAbilityChange}
                />
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Saving Throws"
                description="Toggle proficiency and add situational modifiers."
              >
                <SavingThrowList
                  savingThrows={savingThrowItems}
                  abilityModifiers={derived.abilityModifiers}
                  proficiencyBonus={derived.proficiencyBonus}
                  onToggle={(ability) =>
                    dispatch({ type: 'toggleSavingThrow', ability })
                  }
                  onMiscChange={handleSavingThrowMisc}
                />
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Skills"
                description="Mark proficiency/expertise and capture miscellaneous bonuses."
              >
                <SkillList
                  skills={skillItems}
                  abilityModifiers={derived.abilityModifiers}
                  onToggleProficiency={(skill) =>
                    dispatch({ type: 'toggleSkill', skill })
                  }
                  onToggleExpertise={(skill) =>
                    dispatch({ type: 'toggleSkillExpertise', skill })
                  }
                  onMiscChange={handleSkillMisc}
                />
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Spell Slots"
                description="Update cantrips, slots, and expended tracking."
              >
                <SpellSlotsEditor
                  slots={sheet.spellcasting.slots}
                  onChange={handleSpellSlotChange}
                />
              </CharacterSheetSection>
            </div>

            <div className="dnd-sheet-column">
              <CharacterSheetSection
                title="Combat"
                description="Armor class, hit points, death saves, and attacks."
              >
                <div className="dnd-combat-grid">
                  <label>
                    <span>Armor Class</span>
                    <input
                      type="text"
                      value={sheet.combat.armorClass}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'armorClass'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Initiative Bonus</span>
                    <input
                      type="number"
                      value={sheet.combat.initiativeBonus}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'initiativeBonus'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Speed</span>
                    <input
                      type="text"
                      value={sheet.combat.speed}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'speed'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Max HP</span>
                    <input
                      type="text"
                      value={sheet.combat.maxHp}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'maxHp'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Current HP</span>
                    <input
                      type="text"
                      value={sheet.combat.currentHp}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'currentHp'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Temp HP</span>
                    <input
                      type="text"
                      value={sheet.combat.tempHp}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'tempHp'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Hit Dice</span>
                    <input
                      type="text"
                      value={sheet.combat.hitDice}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['combat', 'hitDice'],
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <DeathSavesTracker
                  successes={sheet.combat.deathSaves.successes}
                  failures={sheet.combat.deathSaves.failures}
                  onChange={handleDeathSaveChange}
                />
                <AttacksEditor
                  attacks={sheet.combat.attacks}
                  onChange={handleAttackChange}
                  onAdd={handleAttackAdd}
                  onRemove={handleAttackRemove}
                />
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Spellcasting"
                description="Spellcasting ability, DC, attack bonus, and spell lists."
              >
                <div className="dnd-spellcasting-grid">
                  <label>
                    <span>Spellcasting Ability</span>
                    <select
                      value={sheet.spellcasting.ability}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['spellcasting', 'ability'],
                          value: event.target.value,
                        })
                      }
                    >
                      <option value="str">Strength</option>
                      <option value="dex">Dexterity</option>
                      <option value="con">Constitution</option>
                      <option value="int">Intelligence</option>
                      <option value="wis">Wisdom</option>
                      <option value="cha">Charisma</option>
                    </select>
                  </label>
                  <label>
                    <span>Spell Save DC</span>
                    <input
                      type="text"
                      value={sheet.spellcasting.saveDc}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['spellcasting', 'saveDc'],
                          value: event.target.value,
                        })
                      }
                      placeholder={`Suggested ${derived.spellcasting.suggestedSaveDc}`}
                    />
                  </label>
                  <label>
                    <span>Spell Attack Bonus</span>
                    <input
                      type="text"
                      value={sheet.spellcasting.attackBonus}
                      onChange={(event) =>
                        dispatch({
                          type: 'setField',
                          path: ['spellcasting', 'attackBonus'],
                          value: event.target.value,
                        })
                      }
                      placeholder={`Suggested ${formatModifier(
                        derived.spellcasting.suggestedAttackBonus
                      )}`}
                    />
                  </label>
                </div>
                <label>
                  <span>Prepared Spells</span>
                  <textarea
                    value={sheet.spellcasting.prepared}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['spellcasting', 'prepared'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Known Spells</span>
                  <textarea
                    value={sheet.spellcasting.known}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['spellcasting', 'known'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Spell Notes</span>
                  <textarea
                    value={sheet.spellcasting.notes}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['spellcasting', 'notes'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Inventory & Resources"
                description="Currency, equipment, features, and senses."
              >
                <CurrencyInputs values={sheet.equipment} onChange={handleCurrencyChange} />
                <label>
                  <span>Inventory</span>
                  <textarea
                    value={sheet.equipment.inventory}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['equipment', 'inventory'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Treasure &amp; Magic Items</span>
                  <textarea
                    value={sheet.equipment.treasure}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['equipment', 'treasure'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Other Equipment</span>
                  <textarea
                    value={sheet.equipment.other}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['equipment', 'other'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Features &amp; Traits</span>
                  <textarea
                    value={sheet.features}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['features'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Class Resources</span>
                  <textarea
                    value={sheet.resources.features}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['resources', 'features'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Resource Notes</span>
                  <textarea
                    value={sheet.resources.notes}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['resources', 'notes'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Senses</span>
                  <textarea
                    value={sheet.senses}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['senses'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Proficiencies</span>
                  <textarea
                    value={sheet.proficiencies}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['proficiencies'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Languages</span>
                  <textarea
                    value={sheet.languages}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['languages'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Personality & Story"
                description="Capture roleplaying notes, allies, and backstory."
              >
                <label>
                  <span>Personality Traits</span>
                  <textarea
                    value={sheet.personality.traits}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'traits'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Ideals</span>
                  <textarea
                    value={sheet.personality.ideals}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'ideals'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Bonds</span>
                  <textarea
                    value={sheet.personality.bonds}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'bonds'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Flaws</span>
                  <textarea
                    value={sheet.personality.flaws}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'flaws'],
                        value: event.target.value,
                      })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Appearance</span>
                  <textarea
                    value={sheet.personality.appearance}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'appearance'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Allies &amp; Contacts</span>
                  <textarea
                    value={sheet.personality.allies}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'allies'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Organizations</span>
                  <textarea
                    value={sheet.personality.organizations}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'organizations'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
                <label>
                  <span>Backstory</span>
                  <textarea
                    value={sheet.personality.backstory}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'backstory'],
                        value: event.target.value,
                      })
                    }
                    rows={4}
                  />
                </label>
                <label>
                  <span>Notes</span>
                  <textarea
                    value={sheet.personality.notes}
                    onChange={(event) =>
                      dispatch({
                        type: 'setField',
                        path: ['personality', 'notes'],
                        value: event.target.value,
                      })
                    }
                    rows={3}
                  />
                </label>
              </CharacterSheetSection>

              <CharacterSheetSection
                title="Vault Output & AI Prefill"
                description="Control template overrides, vault folder, and optional AI enrichment."
              >
                <div className="dnd-template-grid">
                  <label>
                    <span>Template Path</span>
                    <input
                      type="text"
                      value={templatePath}
                      onChange={(event) => setTemplatePath(event.target.value)}
                      placeholder="Uses default 5e template if blank"
                    />
                  </label>
                  <button type="button" onClick={saveTemplateDefault}>
                    Save as Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplatePath(templateDefault || '')}
                    disabled={!templateDefault}
                  >
                    Use Saved Default
                  </button>
                </div>
                <div className="dnd-template-grid">
                  <label>
                    <span>Vault Subdirectory</span>
                    <input
                      type="text"
                      value={directoryOverride}
                      onChange={(event) => setDirectoryOverride(event.target.value)}
                      placeholder="Defaults to 20_DM/Players"
                    />
                  </label>
                  <button type="button" onClick={saveDirectoryDefault}>
                    Save as Default
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirectoryOverride(directoryDefault || '')}
                    disabled={!directoryDefault}
                  >
                    Use Saved Default
                  </button>
                </div>
                <label className="dnd-prefill-checkbox">
                  <input
                    type="checkbox"
                    checked={usePrefill}
                    onChange={(event) => setUsePrefill(event.target.checked)}
                  />
                  Ask the AI assistant to prefill narrative sections before saving.
                </label>
                <textarea
                  value={prefillPrompt}
                  onChange={(event) => setPrefillPrompt(event.target.value)}
                  rows={3}
                  placeholder="Optional prompt for the AI (e.g., party goals, tone, secrets)."
                  disabled={!usePrefill}
                />
              </CharacterSheetSection>
            </div>
          </div>
          <footer className="dnd-sheet-submit">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save to Vault'}
            </button>
          </footer>
        </form>
        <input
          type="file"
          ref={fileInputRef}
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>
    </>
  );
}
