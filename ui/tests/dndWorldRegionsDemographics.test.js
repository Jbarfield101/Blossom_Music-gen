import test from 'node:test';
import assert from 'node:assert/strict';

import { coerceDemographicsForFrontMatter } from '../src/pages/DndWorldRegions.jsx';

test('coerceDemographicsForFrontMatter drops zero-share demographics before rounding', () => {
  const input = [
    { group: 'Elves', share: '55.4321' },
    { group: 'Other', share: '0' },
    { group: 'Humans', share: 44.5678 },
    { group: 'Empty', share: '' },
    { group: 'Dwarves', share: -3 },
  ];

  const result = coerceDemographicsForFrontMatter(input);

  assert.deepEqual(result, [
    { group: 'Elves', share: 55.43 },
    { group: 'Humans', share: 44.57 },
  ]);
});
