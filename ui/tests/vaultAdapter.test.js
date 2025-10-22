import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadEntity,
  saveEntity,
  EntityValidationError,
  configureVaultFileSystem,
  ENTITY_ERROR_CODES,
} from '../src/lib/vaultAdapter.js';
import {
  configureRelationshipIdLookup,
  resetRelationshipIdLookup,
} from '../src/lib/dndIds.js';
import { configureVaultIndex, resetVaultIndexCache } from '../src/lib/vaultIndex.js';

const MARKDOWN_FIXTURE = `---\nid: npc_ember_fl4m3\ntype: npc\nname: Ember Thorn\naliases:\n  - Flame\nimportance: 3\nknowledge_scope:\n  true_facts:\n    - Guards the heartflame ember.\nrelationship_ledger:\n  allies:\n    - id: npc_sage_mn0p\n      notes: Mentor\n---\nEmber Thorn stands watch over the forge.\n`;

const JSON_FIXTURE = JSON.stringify(
  {
    id: 'npc_ash_sh4d',
    type: 'npc',
    name: 'Ash Veil',
    aliases: ['Shade'],
  },
  null,
  2
);

const ENTITY_ID_TEST_PATTERN =
  /^(npc|quest|loc|domain|faction|monster|encounter|session)_[a-z0-9-]+_[a-z0-9]{4,6}$/i;

function stubVaultIndex(t, entities = {}) {
  resetVaultIndexCache();
  configureVaultIndex({
    readIndexFile: async () => ({
      root: 'C:/vault',
      raw: JSON.stringify({ entities }),
    }),
    invokeCommand: async () => null,
  });
  t.after(() => {
    configureVaultIndex();
    resetVaultIndexCache();
  });
}

test('loadEntity parses Markdown front matter and body', async (t) => {
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  stubVaultIndex(t, {
    quest_flame_watch: {
      id: 'quest_flame_watch',
      type: 'quest',
      name: 'Guard the Forge',
      path: '20_dm/quests/guard.md',
      metadata: {
        related_npc: 'npc_ember_fl4m3',
      },
    },
    npc_ember_fl4m3: {
      id: 'npc_ember_fl4m3',
      type: 'npc',
      name: 'Ember Thorn',
      path: '20_dm/npc/ember.md',
    },
  });
  configureVaultFileSystem({ readTextFile: async () => MARKDOWN_FIXTURE });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  const result = await loadEntity('/vault/npcs/ember.md');
  assert.equal(result.path, '/vault/npcs/ember.md');
  assert.equal(result.body, 'Ember Thorn stands watch over the forge.\n');
  assert.equal(result.entity.id, 'npc_ember_fl4m3');
  assert.equal(result.entity.name, 'Ember Thorn');
  assert.deepEqual(result.entity.aliases, ['Flame']);
  assert.equal(result.entity.knowledge_scope.true_facts[0], 'Guards the heartflame ember.');
  assert.equal(result.entity.relationship_ledger.allies[0].notes, 'Mentor');
  assert.ok(Array.isArray(result.backlinks));
  assert.equal(result.backlinks.length, 1);
  assert.equal(result.backlinks[0].id, 'quest_flame_watch');
  assert.equal(result.backlinks[0].type, 'quest');
});

test('loadEntity parses JSON entities and preserves the source text', async (t) => {
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  stubVaultIndex(t, {});
  configureVaultFileSystem({ readTextFile: async () => `${JSON_FIXTURE}\n` });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  const result = await loadEntity('C:/vault/npcs/ash.json');
  assert.equal(result.body, `${JSON_FIXTURE}\n`);
  assert.equal(result.entity.name, 'Ash Veil');
  assert.deepEqual(result.entity.aliases, ['Shade']);
  assert.ok(Array.isArray(result.backlinks));
  assert.equal(result.backlinks.length, 0);
});

test('loadEntity recognizes domain dossiers', async (t) => {
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  stubVaultIndex(t, {});
  const domainJson = JSON.stringify(
    {
      id: 'domain_bloodreed_hold_abcd',
      type: 'domain',
      name: 'Bloodreed Hold',
      category: ['province'],
      population: 48000,
    },
    null,
    2
  );
  configureVaultFileSystem({ readTextFile: async () => `${domainJson}\n` });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  const result = await loadEntity('C:/vault/domains/bloodreed.json');
  assert.equal(result.entity.type, 'domain');
  assert.equal(result.entity.id, 'domain_bloodreed_hold_abcd');
  assert.equal(result.entity.name, 'Bloodreed Hold');
  assert.deepEqual(result.entity.category, ['province']);
  assert.equal(result.entity.population, 48000);
  assert.ok(Array.isArray(result.backlinks));
});

test('loadEntity throws a structured error when validation fails', async (t) => {
  const invalidMarkdown = `---\nid: npc-broken\ntype: npc\n---\nMissing the required name.\n`;
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  stubVaultIndex(t, {});
  configureVaultFileSystem({ readTextFile: async () => invalidMarkdown });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  await assert.rejects(
    loadEntity('/vault/npcs/broken.md'),
    (err) => {
      assert.ok(err instanceof EntityValidationError, 'expected EntityValidationError');
      assert.equal(err.entityType, 'npc');
      assert.equal(err.path, '/vault/npcs/broken.md');
      assert.equal(err.code, ENTITY_ERROR_CODES.VALIDATION_FAILED);
      assert.ok(Array.isArray(err.issues) && err.issues.length > 0, 'expected validation issues');
      return true;
    }
  );
});

test('saveEntity writes Markdown with front matter and preserves the body text', async (t) => {
  const writes = [];
  configureVaultFileSystem({
    readTextFile: async () => '',
    writeTextFile: async (...args) => {
      writes.push(args);
    },
  });
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  const entity = {
    id: 'npc_wisp_gl0w',
    type: 'npc',
    name: 'Lantern Wisp',
    aliases: ['Glow'],
  };

  const body = 'Lantern Wisp drifts between the trees.\n';
  await saveEntity({ entity, body, path: '/vault/npcs/wisp.md', format: 'markdown' });

  assert.equal(writes.length, 1);
  const [writePath, written] = writes[0];
  assert.equal(writePath, '/vault/npcs/wisp.md');
  assert.match(written, /^---\n/);
  assert.match(written, /name: Lantern Wisp/);
  assert.match(written, /aliases:\n  - Glow/);
  assert.ok(written.endsWith(`${body}`), 'expected original body preserved after front matter');
});

test('saveEntity writes sorted JSON with stable ordering', async (t) => {
  const writes = [];
  configureVaultFileSystem({
    readTextFile: async () => '',
    writeTextFile: async (...args) => {
      writes.push(args);
    },
  });
  configureRelationshipIdLookup((value) => {
    const text = String(value || '').trim();
    return ENTITY_ID_TEST_PATTERN.test(text) ? text.toLowerCase() : null;
  });
  t.after(() => {
    configureVaultFileSystem();
    resetRelationshipIdLookup();
  });

  const entity = {
    name: 'Sable',
    id: 'npc_sable_qu13',
    type: 'npc',
    aliases: ['The Quiet'],
  };

  await saveEntity({ entity, path: 'C:/vault/npcs/sable.json', format: 'json' });

  assert.equal(writes.length, 1);
  const [, payload] = writes[0];
  assert.equal(
    payload,
    `{
  "aliases": [
    "The Quiet"
  ],
  "id": "npc_sable_qu13",
  "name": "Sable",
  "type": "npc"
}\n`
  );
});
