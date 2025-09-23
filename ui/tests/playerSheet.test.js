import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDerivedStats,
  createEmptyPlayerSheet,
  parsePlayerSheetImport,
  playerSheetReducer,
  serializeCharacterSheet,
  serializePlayerSheetToJson,
} from '../src/lib/playerSheet.js';

test('playerSheetReducer updates nested fields and ability modifiers', () => {
  let state = createEmptyPlayerSheet();
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['identity', 'name'],
    value: 'Lyra Dawn',
  });
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['abilityScores', 'int'],
    value: 16,
  });
  state = playerSheetReducer(state, {
    type: 'toggleSkill',
    skill: 'arcana',
  });
  const derived = buildDerivedStats(state);
  assert.equal(state.identity.name, 'Lyra Dawn');
  assert.equal(derived.abilityModifiers.int, 3);
  assert.equal(derived.skills.arcana.total, 5, 'Arcana should include proficiency bonus');
});

test('serializeCharacterSheet includes skill totals and Markdown structure', () => {
  let state = createEmptyPlayerSheet();
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['identity', 'name'],
    value: 'Rin the Bold',
  });
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['identity', 'class'],
    value: 'Fighter',
  });
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['identity', 'level'],
    value: 5,
  });
  state = playerSheetReducer(state, {
    type: 'setField',
    path: ['abilityScores', 'str'],
    value: 18,
  });
  state = playerSheetReducer(state, {
    type: 'toggleSavingThrow',
    ability: 'str',
  });
  state = playerSheetReducer(state, {
    type: 'toggleSkill',
    skill: 'athletics',
  });
  const markdown = serializeCharacterSheet(state);
  assert.match(markdown, /Rin the Bold/);
  assert.match(markdown, /Class: Fighter/);
  assert.match(markdown, /Athletics/);
  assert.match(markdown, /\+7/, 'Athletics should show total bonus');
});

test('parsePlayerSheetImport restores defaults and custom values', () => {
  const sheet = createEmptyPlayerSheet();
  sheet.identity.name = 'Seren';
  sheet.abilityScores.dex = 14;
  sheet.skills.stealth.proficient = true;
  const json = serializePlayerSheetToJson(sheet);
  const imported = parsePlayerSheetImport(json);
  assert.equal(imported.identity.name, 'Seren');
  assert.equal(imported.abilityScores.dex, 14);
  assert.equal(imported.skills.stealth.proficient, true);
  assert.ok(Array.isArray(imported.combat.attacks), 'attacks array should exist');
});
