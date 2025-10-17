import test from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';

import { loadEntity, saveEntity } from '../src/lib/vaultAdapter.js';

const baseFs = {
  readTextFile: async () => {
    throw new Error('readTextFile not implemented');
  },
  writeTextFile: async () => {
    throw new Error('writeTextFile not implemented');
  },
};

function makeFs(overrides) {
  return { ...baseFs, ...overrides };
}

test('loadEntity parses markdown NPC files', async () => {
  const sample = `---\n` +
    `id: npc_acolyte-vorra_7c2e\n` +
    `type: npc\n` +
    `name: Acolyte Vorra\n` +
    `region: Arena Island\n` +
    `tags: [cult, spy]\n` +
    `---\n` +
    `Body text.`;
  const fs = makeFs({
    readTextFile: async () => sample,
    writeTextFile: async () => {},
  });
  const result = await loadEntity('vault/npc.md', { fs });
  assert.equal(result.ok, true, 'expected load success');
  assert.equal(result.entity.id, 'npc_acolyte-vorra_7c2e');
  assert.equal(result.entity.name, 'Acolyte Vorra');
  assert.equal(result.format, 'markdown');
  assert.match(result.body, /^Body text/);
});

test('loadEntity returns structured failure for missing id', async () => {
  const sample = `---\nname: No Id\ntype: npc\n---\n`; 
  const fs = makeFs({
    readTextFile: async () => sample,
    writeTextFile: async () => {},
  });
  const result = await loadEntity('vault/no-id.md', { fs });
  assert.equal(result.ok, false, 'expected load to fail');
  assert.match(result.error.message, /determine entity type|validation/i);
});

test('saveEntity writes markdown front matter with sorted keys', async () => {
  let written = '';
  const fs = makeFs({
    readTextFile: async () => '',
    writeTextFile: async (_path, content) => {
      written = content;
    },
  });
  const entity = {
    id: 'npc_acolyte-vorra_7c2e',
    type: 'npc',
    name: 'Acolyte Vorra',
    tags: ['cult', 'spy'],
    region: 'Arena Island',
  };
  const result = await saveEntity(
    {
      entity,
      body: 'Some body copy.',
      path: 'vault/npc.md',
    },
    { fs },
  );
  assert.equal(result.ok, true, 'expected save success');
  const parsed = matter(written);
  assert.deepEqual(parsed.data, {
    id: 'npc_acolyte-vorra_7c2e',
    type: 'npc',
    name: 'Acolyte Vorra',
    region: 'Arena Island',
    tags: ['cult', 'spy'],
  });
  assert.equal(parsed.content.trim(), 'Some body copy.');
});
