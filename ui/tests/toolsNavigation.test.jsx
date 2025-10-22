import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import Tools from '../src/pages/Tools.jsx';
import Pipeline from '../src/pages/Pipeline.jsx';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/tools' });
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

test('pipeline card appears on tools page and navigates to the pipeline experience', async (t) => {
  const teardownDom = setupDom();

  t.after(() => {
    cleanup();
    teardownDom();
  });

  render(
    <MemoryRouter initialEntries={['/tools']}>
      <Routes>
        <Route path="/tools" element={<Tools />} />
        <Route path="/pipeline" element={<Pipeline />} />
      </Routes>
    </MemoryRouter>
  );

  const pipelineCard = await screen.findByRole('link', { name: /pipeline/i });
  assert.ok(pipelineCard, 'Pipeline card should render as a navigation link');
  assert.equal(pipelineCard.getAttribute('href'), '/pipeline');

  fireEvent.click(pipelineCard);

  await waitFor(() => {
    assert.ok(screen.getByRole('heading', { level: 1, name: /pipeline/i }));
  });
});
