const ABILITY_SCORES = Object.freeze([
  { key: 'str', label: 'Strength' },
  { key: 'dex', label: 'Dexterity' },
  { key: 'con', label: 'Constitution' },
  { key: 'int', label: 'Intelligence' },
  { key: 'wis', label: 'Wisdom' },
  { key: 'cha', label: 'Charisma' },
]);

const SKILL_LIST = Object.freeze([
  { key: 'acrobatics', label: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', label: 'Arcana', ability: 'int' },
  { key: 'athletics', label: 'Athletics', ability: 'str' },
  { key: 'deception', label: 'Deception', ability: 'cha' },
  { key: 'history', label: 'History', ability: 'int' },
  { key: 'insight', label: 'Insight', ability: 'wis' },
  { key: 'intimidation', label: 'Intimidation', ability: 'cha' },
  { key: 'investigation', label: 'Investigation', ability: 'int' },
  { key: 'medicine', label: 'Medicine', ability: 'wis' },
  { key: 'nature', label: 'Nature', ability: 'int' },
  { key: 'perception', label: 'Perception', ability: 'wis' },
  { key: 'performance', label: 'Performance', ability: 'cha' },
  { key: 'persuasion', label: 'Persuasion', ability: 'cha' },
  { key: 'religion', label: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', label: 'Stealth', ability: 'dex' },
  { key: 'survival', label: 'Survival', ability: 'wis' },
]);

const SKILL_BASE_STATE = SKILL_LIST.reduce((acc, skill) => {
  acc[skill.key] = { proficient: false, expertise: false, misc: 0 };
  return acc;
}, {});

const ABILITY_BASE_STATE = ABILITY_SCORES.reduce((acc, ability) => {
  acc[ability.key] = 10;
  return acc;
}, {});

const SAVING_THROW_BASE = ABILITY_SCORES.reduce((acc, ability) => {
  acc[ability.key] = { proficient: false, misc: 0 };
  return acc;
}, {});

const SPELL_SLOT_LEVELS = Object.freeze([
  'cantrips',
  'level1',
  'level2',
  'level3',
  'level4',
  'level5',
  'level6',
  'level7',
  'level8',
  'level9',
]);

const INITIAL_PLAYER_SHEET = Object.freeze({
  identity: {
    name: '',
    class: '',
    subclass: '',
    background: '',
    playerName: '',
    race: '',
    alignment: '',
    experience: '',
    level: 1,
    inspiration: false,
    proficiencyBonusOverride: '',
  },
  multiclass: {
    classes: [],
  },
  abilityScores: { ...ABILITY_BASE_STATE },
  savingThrows: { ...SAVING_THROW_BASE },
  skills: { ...SKILL_BASE_STATE },
  proficiencies: '',
  languages: '',
  features: '',
  senses: '',
  passiveInsightNotes: '',
  passiveInvestigationNotes: '',
  classFeatures: [],
  combat: {
    armorClass: '',
    initiativeBonus: '',
    speed: '',
    maxHp: '',
    currentHp: '',
    tempHp: '',
    hitDice: '',
    deathSaves: { successes: 0, failures: 0 },
    attacks: [
      { name: '', bonus: '', damage: '', notes: '' },
      { name: '', bonus: '', damage: '', notes: '' },
      { name: '', bonus: '', damage: '', notes: '' },
    ],
  },
  spellcasting: {
    ability: 'int',
    saveDc: '',
    attackBonus: '',
    slots: SPELL_SLOT_LEVELS.reduce((acc, lvl) => {
      acc[lvl] = '';
      return acc;
    }, {}),
    spellLists: SPELL_SLOT_LEVELS.reduce((acc, lvl) => {
      acc[lvl] = '';
      return acc;
    }, {}),
    prepared: '',
    known: '',
    notes: '',
  },
  equipment: {
    cp: '',
    sp: '',
    ep: '',
    gp: '',
    pp: '',
    inventory: '',
    treasure: '',
    other: '',
  },
  personality: {
    traits: '',
    ideals: '',
    bonds: '',
    flaws: '',
    appearance: '',
    allies: '',
    organizations: '',
    backstory: '',
    notes: '',
  },
  resources: {
    features: '',
    notes: '',
  },
});

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = deepClone(val);
    }
    return out;
  }
  return value;
}

export function createEmptyPlayerSheet() {
  return deepClone(INITIAL_PLAYER_SHEET);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function calculateTotalLevel(sheet) {
  const baseLevel = Math.max(1, Math.floor(normalizeNumber(sheet?.identity?.level)) || 1);
  const extra = Array.isArray(sheet?.multiclass?.classes)
    ? sheet.multiclass.classes.reduce((sum, entry) => {
        const lvl = Math.floor(normalizeNumber(entry?.level));
        return sum + (Number.isFinite(lvl) && lvl > 0 ? lvl : 0);
      }, 0)
    : 0;
  return Math.max(1, baseLevel + extra);
}

export function deriveAbilityModifier(score) {
  const val = normalizeNumber(score);
  return Math.floor(val / 2) - 5;
}

export function computeProficiencyBonus(level) {
  const lvl = Math.max(1, Math.floor(normalizeNumber(level)) || 1);
  return Math.floor((lvl - 1) / 4) + 2;
}

export function determineProficiencyBonus(sheet) {
  const override = sheet?.identity?.proficiencyBonusOverride;
  if (override !== undefined && override !== null && `${override}`.trim() !== '') {
    const num = Number(override);
    if (Number.isFinite(num)) {
      return num;
    }
  }
  return computeProficiencyBonus(calculateTotalLevel(sheet));
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function updatePath(state, path, value) {
  if (!Array.isArray(path) || !path.length) {
    return state;
  }
  const [head, ...rest] = path;
  if (Array.isArray(state)) {
    const idx = Number(head);
    return state.map((item, index) => {
      if (index !== idx) return item;
      if (rest.length === 0) return value;
      return updatePath(item, rest, value);
    });
  }
  const base =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  return {
    ...base,
    [head]:
      rest.length === 0
        ? value
        : updatePath(base[head], rest, value),
  };
}

export function playerSheetReducer(state, action) {
  switch (action.type) {
    case 'setField': {
      return updatePath(state, action.path, action.value);
    }
    case 'toggleSavingThrow': {
      const current = state.savingThrows?.[action.ability] || { proficient: false, misc: 0 };
      return {
        ...state,
        savingThrows: {
          ...state.savingThrows,
          [action.ability]: {
            ...current,
            proficient: !current.proficient,
          },
        },
      };
    }
    case 'setSavingThrowMisc': {
      const current = state.savingThrows?.[action.ability] || { proficient: false, misc: 0 };
      return {
        ...state,
        savingThrows: {
          ...state.savingThrows,
          [action.ability]: {
            ...current,
            misc: action.value,
          },
        },
      };
    }
    case 'toggleSkill': {
      const current = state.skills?.[action.skill] || {
        proficient: false,
        expertise: false,
        misc: 0,
      };
      const nextProficient = !current.proficient;
      return {
        ...state,
        skills: {
          ...state.skills,
          [action.skill]: {
            ...current,
            proficient: nextProficient,
            expertise: nextProficient ? current.expertise : false,
          },
        },
      };
    }
    case 'toggleSkillExpertise': {
      const current = state.skills?.[action.skill] || { proficient: false, expertise: false, misc: 0 };
      return {
        ...state,
        skills: {
          ...state.skills,
          [action.skill]: {
            ...current,
            expertise: !current.expertise,
            proficient: current.expertise ? current.proficient : true,
          },
        },
      };
    }
    case 'setSkillMisc': {
      const current = state.skills?.[action.skill] || { proficient: false, expertise: false, misc: 0 };
      return {
        ...state,
        skills: {
          ...state.skills,
          [action.skill]: {
            ...current,
            misc: action.value,
          },
        },
      };
    }
    case 'updateAttacks': {
      const nextAttacks = Array.isArray(action.attacks)
        ? action.attacks.map((attack) => ({ ...attack }))
        : [];
      return {
        ...state,
        combat: {
          ...state.combat,
          attacks: nextAttacks,
        },
      };
    }
    case 'addAttack': {
      const current = Array.isArray(state.combat?.attacks) ? state.combat.attacks : [];
      return {
        ...state,
        combat: {
          ...state.combat,
          attacks: [...current, { name: '', bonus: '', damage: '', notes: '' }],
        },
      };
    }
    case 'removeAttack': {
      const current = Array.isArray(state.combat?.attacks) ? state.combat.attacks : [];
      const next = current.filter((_, index) => index !== action.index);
      return {
        ...state,
        combat: {
          ...state.combat,
          attacks: next,
        },
      };
    }
    case 'addMulticlass': {
      const current = Array.isArray(state.multiclass?.classes) ? state.multiclass.classes : [];
      return {
        ...state,
        multiclass: {
          ...state.multiclass,
          classes: [...current, { className: '', subclass: '', level: '' }],
        },
      };
    }
    case 'updateMulticlass': {
      const current = Array.isArray(state.multiclass?.classes) ? state.multiclass.classes : [];
      const next = current.map((entry, index) => {
        if (index !== action.index) return entry;
        return {
          ...entry,
          [action.field]: action.value,
        };
      });
      return {
        ...state,
        multiclass: {
          ...state.multiclass,
          classes: next,
        },
      };
    }
    case 'removeMulticlass': {
      const current = Array.isArray(state.multiclass?.classes) ? state.multiclass.classes : [];
      const next = current.filter((_, index) => index !== action.index);
      return {
        ...state,
        multiclass: {
          ...state.multiclass,
          classes: next,
        },
      };
    }
    case 'addClassFeature': {
      const current = Array.isArray(state.classFeatures) ? state.classFeatures : [];
      return {
        ...state,
        classFeatures: [...current, { name: '', level: '', description: '' }],
      };
    }
    case 'updateClassFeature': {
      const current = Array.isArray(state.classFeatures) ? state.classFeatures : [];
      const next = current.map((feature, index) => {
        if (index !== action.index) return feature;
        return {
          ...feature,
          [action.field]: action.value,
        };
      });
      return {
        ...state,
        classFeatures: next,
      };
    }
    case 'removeClassFeature': {
      const current = Array.isArray(state.classFeatures) ? state.classFeatures : [];
      const next = current.filter((_, index) => index !== action.index);
      return {
        ...state,
        classFeatures: next,
      };
    }
    case 'setSpellList': {
      return {
        ...state,
        spellcasting: {
          ...state.spellcasting,
          spellLists: {
            ...state.spellcasting?.spellLists,
            [action.level]: action.value,
          },
        },
      };
    }
    case 'replace': {
      return mergeDefaults(action.value);
    }
    case 'reset':
      return createEmptyPlayerSheet();
    default:
      return state;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSkillMeta(key) {
  return SKILL_LIST.find((skill) => skill.key === key) || null;
}

export function buildDerivedStats(sheet) {
  const abilityModifiers = {};
  for (const ability of ABILITY_SCORES) {
    abilityModifiers[ability.key] = deriveAbilityModifier(sheet?.abilityScores?.[ability.key]);
  }
  const totalLevel = calculateTotalLevel(sheet);
  const proficiencyBonus = determineProficiencyBonus(sheet);
  const savingThrows = {};
  for (const ability of ABILITY_SCORES) {
    const data = sheet?.savingThrows?.[ability.key] || {};
    const misc = normalizeNumber(data.misc);
    const proficient = Boolean(data.proficient);
    const total = abilityModifiers[ability.key] + (proficient ? proficiencyBonus : 0) + misc;
    savingThrows[ability.key] = total;
  }
  const skills = {};
  for (const skill of SKILL_LIST) {
    const data = sheet?.skills?.[skill.key] || {};
    const misc = normalizeNumber(data.misc);
    const proficient = Boolean(data.proficient);
    const expertise = Boolean(data.expertise);
    const profMultiplier = expertise ? 2 : proficient ? 1 : 0;
    const total = abilityModifiers[skill.ability] + proficiencyBonus * profMultiplier + misc;
    skills[skill.key] = {
      total,
      ability: skill.ability,
      proficient,
      expertise,
      misc,
      label: skill.label,
    };
  }
  const passivePerception = 10 + (skills.perception?.total ?? abilityModifiers.wis);
  const passiveInvestigation = 10 + (skills.investigation?.total ?? abilityModifiers.int);
  const passiveInsight = 10 + (skills.insight?.total ?? abilityModifiers.wis);
  const initiative = abilityModifiers.dex + normalizeNumber(sheet?.combat?.initiativeBonus);
  const spellAbility = sheet?.spellcasting?.ability || 'int';
  const spellAbilityMod = abilityModifiers[spellAbility] ?? 0;
  const spellSaveSuggestion = 8 + spellAbilityMod + proficiencyBonus;
  const spellAttackSuggestion = spellAbilityMod + proficiencyBonus;

  return {
    abilityModifiers,
    proficiencyBonus,
    savingThrows,
    skills,
    passivePerception,
    passiveInvestigation,
    passiveInsight,
    initiative,
    spellcasting: {
      ability: spellAbility,
      abilityModifier: spellAbilityMod,
      suggestedSaveDc: spellSaveSuggestion,
      suggestedAttackBonus: spellAttackSuggestion,
    },
    totalLevel,
  };
}

export function validatePlayerSheet(sheet) {
  const errors = [];
  const name = (sheet?.identity?.name || '').trim();
  if (!name) {
    errors.push('Character name is required.');
  }
  const level = Math.floor(normalizeNumber(sheet?.identity?.level));
  if (!Number.isFinite(level) || level < 1 || level > 20) {
    errors.push('Level must be between 1 and 20.');
  }
  for (const ability of ABILITY_SCORES) {
    const score = normalizeNumber(sheet?.abilityScores?.[ability.key]);
    if (score < 1 || score > 30) {
      errors.push(`${ability.label} score should be between 1 and 30.`);
    }
  }
  return errors;
}

function escapePipe(text) {
  return String(text ?? '').replace(/\|/g, '\\|');
}

function renderAbilityTable(sheet, derived) {
  const rows = ABILITY_SCORES.map((ability) => {
    const score = sheet?.abilityScores?.[ability.key] ?? '';
    const mod = derived.abilityModifiers[ability.key];
    const save = derived.savingThrows[ability.key];
    const proficient = sheet?.savingThrows?.[ability.key]?.proficient;
    const misc = normalizeNumber(sheet?.savingThrows?.[ability.key]?.misc);
    return `| ${ability.label} | ${score || ''} | ${formatModifier(mod)} | ${formatModifier(save)} | ${proficient ? '✔️' : ''} | ${misc ? formatModifier(misc) : ''} |`;
  });
  return [
    '| Ability | Score | Modifier | Save | Proficient | Misc |',
    '|:--|:--:|:--:|:--:|:--:|:--:|',
    ...rows,
  ].join('\n');
}

function renderSkillTable(sheet, derived) {
  const rows = SKILL_LIST.map((skill) => {
    const data = derived.skills[skill.key];
    const baseMod = derived.abilityModifiers[skill.ability];
    const misc = normalizeNumber(sheet?.skills?.[skill.key]?.misc);
    const proficient = sheet?.skills?.[skill.key]?.proficient;
    const expertise = sheet?.skills?.[skill.key]?.expertise;
    return `| ${skill.label} (${skill.ability.toUpperCase()}) | ${formatModifier(data.total)} | ${proficient ? '✔️' : ''} | ${expertise ? '✔️' : ''} | ${formatModifier(baseMod)} | ${misc ? formatModifier(misc) : ''} |`;
  });
  return [
    '| Skill | Total | Proficient | Expertise | Ability Mod | Misc |',
    '|:--|:--:|:--:|:--:|:--:|:--:|',
    ...rows,
  ].join('\n');
}

function renderAttacks(attacks) {
  const valid = Array.isArray(attacks) ? attacks.filter((attack) => {
    return (
      (attack?.name || '').trim() ||
      (attack?.bonus || '').trim() ||
      (attack?.damage || '').trim() ||
      (attack?.notes || '').trim()
    );
  }) : [];
  if (!valid.length) {
    return '';
  }
  const rows = valid.map((attack) => {
    return `| ${escapePipe(attack.name)} | ${escapePipe(attack.bonus)} | ${escapePipe(attack.damage)} | ${escapePipe(attack.notes)} |`;
  });
  return [
    '| Attack | Bonus | Damage | Notes |',
    '|:--|:--:|:--:|:--|',
    ...rows,
  ].join('\n');
}

function renderClassFeatures(features) {
  if (!Array.isArray(features) || !features.length) return '';
  const rows = features
    .filter((feature) => (feature?.name || feature?.description || feature?.level))
    .map((feature) => {
      const levelText = feature?.level ? ` (Level ${feature.level})` : '';
      const desc = (feature?.description || '').trim();
      const detail = desc ? `\n${desc}` : '';
      return `- **${escapePipe(feature?.name || 'Feature')}**${levelText}${detail}`;
    });
  if (!rows.length) return '';
  return rows.join('\n');
}

function renderSpellLists(spellLists) {
  if (!spellLists || typeof spellLists !== 'object') return '';
  const sections = [];
  for (const lvl of SPELL_SLOT_LEVELS) {
    const content = (spellLists[lvl] || '').trim();
    if (!content) continue;
    const heading = lvl === 'cantrips' ? 'Cantrips' : `Level ${SPELL_SLOT_LEVELS.indexOf(lvl)}`;
    sections.push(`### ${heading} Spells\n\n${content}`);
  }
  return sections.join('\n\n');
}

function renderMulticlass(multiclass, primary) {
  const entries = [];
  if (primary?.class) {
    const primaryLevel = Math.max(1, Math.floor(normalizeNumber(primary.level)) || 1);
    const subclass = (primary?.subclass || '').trim();
    entries.push(`- ${escapePipe(primary.class)}${subclass ? ` (${escapePipe(subclass)})` : ''}: Level ${primaryLevel}`);
  }
  if (Array.isArray(multiclass?.classes)) {
    for (const cls of multiclass.classes) {
      if (!(cls?.className || '').trim()) continue;
      const lvl = Math.floor(normalizeNumber(cls.level));
      const subclass = (cls?.subclass || '').trim();
      const levelText = Number.isFinite(lvl) && lvl > 0 ? `Level ${lvl}` : 'Level ?';
      entries.push(`- ${escapePipe(cls.className)}${subclass ? ` (${escapePipe(subclass)})` : ''}: ${levelText}`);
    }
  }
  if (!entries.length) return '';
  return entries.join('\n');
}

function sectionIfContent(title, content) {
  const trimmed = (content || '').trim();
  if (!trimmed) return '';
  return `## ${title}\n\n${trimmed}\n\n`;
}

export function serializeCharacterSheet(sheet) {
  const derived = buildDerivedStats(sheet);
  const identity = sheet?.identity || {};
  const frontmatterLines = ['---'];
  frontmatterLines.push(`Title: ${identity.name || 'Unnamed Adventurer'}`);
  frontmatterLines.push(`Class: ${identity.class || ''}`);
  frontmatterLines.push(`Subclass: ${identity.subclass || ''}`);
  frontmatterLines.push(`Level: ${Math.max(1, Math.floor(normalizeNumber(identity.level)) || 1)}`);
  frontmatterLines.push(`Background: ${identity.background || ''}`);
  frontmatterLines.push(`Player: ${identity.playerName || ''}`);
  frontmatterLines.push(`Race: ${identity.race || ''}`);
  frontmatterLines.push(`Alignment: ${identity.alignment || ''}`);
  frontmatterLines.push(`Experience: ${identity.experience || ''}`);
  frontmatterLines.push(`Inspiration: ${identity.inspiration ? 'Yes' : 'No'}`);
  frontmatterLines.push(`Total Level: ${derived.totalLevel}`);
  frontmatterLines.push(`Proficiency Bonus: ${formatModifier(derived.proficiencyBonus)}`);
  frontmatterLines.push(`Passive Perception: ${derived.passivePerception}`);
  frontmatterLines.push(`Passive Investigation: ${derived.passiveInvestigation}`);
  frontmatterLines.push(`Passive Insight: ${derived.passiveInsight}`);
  frontmatterLines.push('---');

  const abilityTable = renderAbilityTable(sheet, derived);
  const skillTable = renderSkillTable(sheet, derived);
  const attacksTable = renderAttacks(sheet?.combat?.attacks);
  const multiclassBlock = renderMulticlass(sheet?.multiclass, {
    class: identity.class,
    subclass: identity.subclass,
    level: identity.level,
  });
  const classFeatureBlock = renderClassFeatures(sheet?.classFeatures);
  const spellListBlock = renderSpellLists(sheet?.spellcasting?.spellLists);

  const combatSection = [
    `- Armor Class: ${sheet?.combat?.armorClass || ''}`,
    `- Initiative: ${formatModifier(derived.initiative)}`,
    `- Speed: ${sheet?.combat?.speed || ''}`,
    `- Hit Points: ${sheet?.combat?.currentHp || sheet?.combat?.maxHp || ''} / ${sheet?.combat?.maxHp || ''}`,
    `- Temporary HP: ${sheet?.combat?.tempHp || '0'}`,
    `- Hit Dice: ${sheet?.combat?.hitDice || ''}`,
  ].join('\n');

  const deathSaves = sheet?.combat?.deathSaves || { successes: 0, failures: 0 };
  const deathSaveLine = `- Death Saves: Successes ${clamp(normalizeNumber(deathSaves.successes), 0, 3)}/3, Failures ${clamp(normalizeNumber(deathSaves.failures), 0, 3)}/3`;

  const spellcasting = sheet?.spellcasting || {};
  const spellLines = [
    `- Spellcasting Ability: ${(spellcasting.ability || '').toUpperCase()}`,
    `- Spell Save DC: ${spellcasting.saveDc || derived.spellcasting.suggestedSaveDc}`,
    `- Spell Attack Bonus: ${spellcasting.attackBonus || formatModifier(derived.spellcasting.suggestedAttackBonus)}`,
  ];
  if (spellcasting.slots?.cantrips) {
    spellLines.push(`- Cantrips Known: ${spellcasting.slots.cantrips}`);
  }

  const slotLines = SPELL_SLOT_LEVELS.filter((lvl) => lvl !== 'cantrips').map((lvl, index) => {
    const display = sheet?.spellcasting?.slots?.[lvl];
    if (!display && display !== 0) return `- Level ${index + 1}: 0`;
    return `- Level ${index + 1}: ${display}`;
  });

  const coin = sheet?.equipment || {};
  const coinLines = [
    `- CP: ${coin.cp || 0}`,
    `- SP: ${coin.sp || 0}`,
    `- EP: ${coin.ep || 0}`,
    `- GP: ${coin.gp || 0}`,
    `- PP: ${coin.pp || 0}`,
  ];

  let out = '';
  out += frontmatterLines.join('\n');
  out += '\n\n';
  out += `# ${identity.name || 'Adventurer'}\n\n`;
  out += '## Abilities\n\n';
  out += `${abilityTable}\n\n`;
  out += '## Skills\n\n';
  out += `${skillTable}\n\n`;
  if (multiclassBlock) {
    out += '## Class & Levels\n\n';
    out += `${multiclassBlock}\n\n`;
  }
  out += '## Combat\n\n';
  out += `${combatSection}\n${deathSaveLine}\n\n`;
  if (attacksTable) {
    out += '### Attacks & Spellcasting\n\n';
    out += `${attacksTable}\n\n`;
  }
  out += '## Spellcasting\n\n';
  out += `${spellLines.join('\n')}\n`;
  out += slotLines.join('\n');
  out += '\n\n';
  if (spellListBlock) {
    out += `${spellListBlock}\n\n`;
  }
  out += sectionIfContent('Prepared Spells', spellcasting.prepared);
  out += sectionIfContent('Known Spells', spellcasting.known);
  out += sectionIfContent('Spell Notes', spellcasting.notes);
  out += '## Proficiencies & Languages\n\n';
  out += `- Proficiencies: ${(sheet?.proficiencies || '').trim()}`;
  out += '\n';
  out += `- Languages: ${(sheet?.languages || '').trim()}`;
  out += '\n';
  out += sectionIfContent('Features & Traits', sheet?.features);
  out += sectionIfContent('Senses', sheet?.senses);
  out += '## Equipment\n\n';
  out += `${coinLines.join('\n')}\n\n`;
  out += sectionIfContent('Inventory', sheet?.equipment?.inventory);
  out += sectionIfContent('Treasure', sheet?.equipment?.treasure);
  out += sectionIfContent('Other Equipment', sheet?.equipment?.other);
  out += '## Personality\n\n';
  out += `- Traits: ${(sheet?.personality?.traits || '').trim()}`;
  out += '\n';
  out += `- Ideals: ${(sheet?.personality?.ideals || '').trim()}`;
  out += '\n';
  out += `- Bonds: ${(sheet?.personality?.bonds || '').trim()}`;
  out += '\n';
  out += `- Flaws: ${(sheet?.personality?.flaws || '').trim()}`;
  out += '\n\n';
  out += sectionIfContent('Appearance', sheet?.personality?.appearance);
  out += sectionIfContent('Allies & Organizations', sheet?.personality?.allies);
  out += sectionIfContent('Organizations', sheet?.personality?.organizations);
  out += sectionIfContent('Backstory', sheet?.personality?.backstory);
  out += sectionIfContent('Notes', sheet?.personality?.notes);
  out += sectionIfContent('Resource Notes', sheet?.resources?.notes);
  out += sectionIfContent('Class Features', sheet?.resources?.features);
  out += sectionIfContent('Additional Class Features', classFeatureBlock);
  out += '\n';
  return out.trimEnd();
}

export function serializePlayerSheetToJson(sheet) {
  return JSON.stringify(sheet, null, 2);
}

function mergeDefaults(partial) {
  const base = createEmptyPlayerSheet();
  const merge = (target, source) => {
    if (Array.isArray(target) && Array.isArray(source)) {
      return source.map((item, index) => merge(target[index], item));
    }
    if (target && typeof target === 'object' && source && typeof source === 'object') {
      const result = { ...target };
      for (const [key, value] of Object.entries(source)) {
        result[key] = merge(target[key], value);
      }
      return result;
    }
    return source !== undefined ? source : target;
  };
  return merge(base, partial || {});
}

export function parsePlayerSheetImport(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No data provided');
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('File must be a JSON export from the character sheet.');
  }
  return mergeDefaults(parsed);
}

export {
  ABILITY_SCORES,
  SKILL_LIST,
  SPELL_SLOT_LEVELS,
  INITIAL_PLAYER_SHEET,
};

