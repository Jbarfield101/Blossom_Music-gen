import test from 'node:test';
import assert from 'node:assert/strict';

import { toSlug, makeShortId, makeId } from '../src/lib/dndIds.js';

test('toSlug strips punctuation and normalizes whitespace and underscores', () => {
  assert.equal(toSlug('  Lady   Vorra  '), 'lady-vorra');
  assert.equal(toSlug('Acolyte__Vorra!!??'), 'acolyte-vorra');
});

test('toSlug truncates long names without leaving trailing hyphens', () => {
  const slug = toSlug('The Extremely Verbose NPC Name (Prototype)');
  assert.equal(slug, 'the-extremely-verbose-np');
  assert.ok(slug.length <= 24);
});

test('makeShortId respects requested length and base36 alphabet', () => {
  const id = makeShortId(8, () => 0.999999);
  assert.equal(id.length, 8);
  assert.match(id, /^[0-9a-z]{8}$/);
});

test('makeId retries collisions when generated ids already exist', () => {
  const samples = [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0.5, 0.5, 0.5, 0.5,
  ];
  let calls = 0;
  const rng = () => {
    const value = samples[calls] ?? 0.75;
    calls += 1;
    return value;
  };
  const existing = new Set(['npc_acolyte-vorra_0000']);
  const generated = makeId('npc', 'Acolyte Vorra', existing, { rng });
  assert.equal(generated, 'npc_acolyte-vorra_iiii');
  assert.equal(calls, 12);
});
