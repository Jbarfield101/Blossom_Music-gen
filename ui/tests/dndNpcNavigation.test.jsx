import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import DndDmNpcs from '../src/pages/DndDmNpcs.jsx';
import { VaultEventProvider } from '../src/lib/vaultEvents.jsx';
import { configureVaultFileSystem } from '../src/lib/vaultAdapter.js';
import { configureVaultIndex, resetVaultIndexCache } from '../src/lib/vaultIndex.js';
import { configureRelationshipIdLookup, resetRelationshipIdLookup } from '../src/lib/dndIds.js';

import * as piperVoices from '../src/lib/piperVoices';
import * as npcsApi from '../src/api/npcs.js';
import * as configApi from '../src/api/config.js';
import * as dirApi from '../src/api/dir.js';
import * as inboxApi from '../src/api/inbox.js';
import * as filesApi from '../src/api/files';
import * as coreApi from '@tauri-apps/api/core';

const INDEX_JSON = {
  version: 1,
  generated_at: '2024-01-01T00:00:00Z',
  entities: {
    npc_ember_fl4m3: {
      id: 'npc_ember_fl4m3',
      type: 'npc',
      name: 'Ember Thorn',
      path: '20_dm/npc/ember-old.md',
      mtime: 1700000000,
      metadata: {
        location: 'Forge District',
        purpose: 'Guardian',
      },
    },
  },
};

const RENAMED_INDEX_ENTRY = {
  ...INDEX_JSON.entities.npc_ember_fl4m3,
  path: '20_dm/npc/ember-renamed.md',
  location: 'Heart Forge',
  metadata: {
    location: 'Heart Forge',
    purpose: 'Guardian',
  },
};

const NPC_MARKDOWN = `---\nid: npc_ember_fl4m3\ntype: npc\nname: Ember Thorn\nlocation: Heart Forge\npurpose: Guardian\n---\nRenamed forge guardian body.\n`;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalCreateObjectURL = dom.window.URL.createObjectURL;
  dom.window.URL.createObjectURL = () => 'blob:mock-url';
  return () => {
    dom.window.URL.createObjectURL = originalCreateObjectURL;
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.navigator;
    delete globalThis.HTMLElement;
    delete globalThis.MutationObserver;
    delete globalThis.getComputedStyle;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  };
}

test('loads NPC details by ID after rename', async (t) => {
  const teardownDom = setupDom();
  resetVaultIndexCache();
  configureRelationshipIdLookup((value) => value);
  configureVaultIndex({
    readIndexFile: async () => ({
      root: 'C:/vault',
      raw: JSON.stringify(INDEX_JSON),
    }),
    invokeCommand: async (command, payload) => {
      if (command === 'vault_index_get_by_id' && payload?.entityId === 'npc_ember_fl4m3') {
        return { ...RENAMED_INDEX_ENTRY };
      }
      return null;
    },
  });
  configureVaultFileSystem({
    readTextFile: async (path) => {
      if (path.replace(/\\/g, '/').endsWith('ember-renamed.md')) {
        return NPC_MARKDOWN;
      }
      return '';
    },
  });

  mock.method(piperVoices, 'listPiperVoices', async () => []);
  mock.method(npcsApi, 'listNpcs', async () => []);
  mock.method(configApi, 'getDreadhavenRoot', async () => 'C:/vault');
  mock.method(dirApi, 'listDir', async () => []);
  mock.method(inboxApi, 'readInbox', async () => NPC_MARKDOWN);
  mock.method(filesApi, 'readFileBytes', async () => new Uint8Array());
  mock.method(coreApi, 'invoke', async (command) => {
    if (command === 'list_piper_profiles') return [];
    if (command === 'get_dreadhaven_root') return 'C:/vault';
    return null;
  });

  t.after(() => {
    cleanup();
    mock.restoreAll();
    configureVaultFileSystem();
    configureVaultIndex();
    resetVaultIndexCache();
    resetRelationshipIdLookup();
    teardownDom();
  });

  render(
    <VaultEventProvider>
      <MemoryRouter initialEntries={['/dnd/npc/npc_ember_fl4m3']}>
        <Routes>
          <Route path="/dnd/npc" element={<DndDmNpcs />} />
          <Route path="/dnd/npc/:id" element={<DndDmNpcs />} />
        </Routes>
      </MemoryRouter>
    </VaultEventProvider>
  );

  await waitFor(() => {
    assert.ok(screen.getByRole('heading', { name: /Ember Thorn/i }));
  });

  const body = await screen.findByText(/Renamed forge guardian body./i);
  assert.ok(body);
});
