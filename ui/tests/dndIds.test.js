import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toSlug,
  makeShortId,
  makeId,
  ENTITY_ID_PATTERN,
} from '../src/lib/dndIds.js';

test('toSlug normalizes whitespace, punctuation, and length', () => {
  assert.equal(toSlug('  Lady Vorra  '), 'lady-vorra');
  assert.equal(toSlug('Acolyte__Vorra!!'), 'acolyte-vorra');
  assert.equal(toSlug('The Extremely Verbose NPC Name (Prototype)'), 'the-extremely-verbose-np');
});

test('makeShortId respects requested length and alphabet', () => {
  const short = makeShortId(6, () => 0.5);
  assert.equal(short.length, 6);
  assert.match(short, /^[0-9a-z]{6}$/);
});

test('makeId retries collisions with deterministic rng', () => {
  const rngValues = [
    0, 0, 0, 0, // first attempt -> "0000"
    0, 0, 0, 0, // second attempt -> "0000"
    0.5, 0.5, 0.5, 0.5, // third attempt -> "iiii"
  ];
  const rng = () => {
    const next = rngValues.shift();
    return next ?? 0.75;
  };
  const existing = new Set(['npc_acolyte-vorra_0000']);
  const id = makeId('npc', 'Acolyte Vorra', existing, { rng });
  assert.equal(id, 'npc_acolyte-vorra_iiii');
  assert.match(id, ENTITY_ID_PATTERN);
});

test('makeId throws after exhausting retry budget', () => {
  const rng = () => 0;
  const existing = new Set(['npc_acolyte-vorra_0000']);
  assert.throws(() => makeId('npc', 'Acolyte Vorra', existing, { rng }), /Failed to generate unique id/);
});
