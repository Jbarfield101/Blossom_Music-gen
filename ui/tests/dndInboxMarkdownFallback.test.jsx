import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DndInbox from '../src/pages/DndInbox.jsx';
import { VaultEventProvider } from '../src/lib/vaultEvents.jsx';
import * as inboxApi from '../src/api/inbox';
import * as markdownLib from '../src/lib/markdown.jsx';
import * as coreApi from '@tauri-apps/api/core';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
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

test('invalid markdown falls back to preformatted view with warning', async (t) => {
  const teardownDom = setupDom();

  mock.method(coreApi, 'isTauri', () => false);
  mock.method(inboxApi, 'listInbox', async () => [
    {
      path: 'notes/test.md',
      name: 'test.md',
      title: 'Test Note',
      preview: 'Preview text',
      modified_ms: Date.now(),
      markers: [],
    },
  ]);
  mock.method(inboxApi, 'readInbox', async () => '# Invalid **markdown');
  mock.method(markdownLib, 'renderMarkdown', () => {
    throw new Error('broken markdown');
  });

  t.after(() => {
    cleanup();
    mock.restoreAll();
    teardownDom();
  });

  render(
    <VaultEventProvider>
      <MemoryRouter>
        <DndInbox />
      </MemoryRouter>
    </VaultEventProvider>
  );

  await waitFor(() => {
    assert.ok(screen.getByRole('heading', { name: /Inbox/i }));
  });

  const warning = await screen.findByText(/Failed to render markdown: broken markdown\. Showing raw content instead\./i);
  assert.ok(warning);

  const pre = screen.getByText(/Invalid \*\*markdown/, { selector: 'pre' });
  assert.equal(pre.tagName, 'PRE');
});
