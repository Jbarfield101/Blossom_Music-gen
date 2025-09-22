import test from 'node:test';
import assert from 'node:assert/strict';
import ReactDOMServer from 'react-dom/server';

import { renderMarkdown } from '../src/lib/markdown.jsx';
import {
  clearVaultAttachmentCache,
  primeVaultAttachment,
  resolveVaultAttachment,
  setVaultAttachmentResolver,
} from '../src/lib/vaultAttachments.js';

test('renderMarkdown renders vault attachment embeds as images', () => {
  clearVaultAttachmentCache();
  primeVaultAttachment('portrait.png', 'https://example.test/assets/portrait.png');

  const markup = ReactDOMServer.renderToStaticMarkup(
    renderMarkdown('Greetings ![[portrait.png|Hero Portrait]] adventurer!')
  );

  assert.match(
    markup,
    /<img[^>]*class="md-img"[^>]*src="https:\/\/example\.test\/assets\/portrait\.png"/,
    'expected img tag with the resolved attachment URL'
  );
  assert.match(
    markup,
    /<img[^>]*alt="Hero Portrait"/,
    'expected img tag to include the resolved alias as alt text'
  );
});

test('renderMarkdown wraps standalone hashtags in chips', () => {
  clearVaultAttachmentCache();
  const markup = ReactDOMServer.renderToStaticMarkup(
    renderMarkdown('Talk about #hope and (#quest/line)! Keep C# friendly with #music.')
  );
  assert.match(markup, /<span class="chip">#hope<\/span>/);
  assert.match(markup, /<span class="chip">#quest\/line<\/span>/);
  assert.match(markup, /<span class="chip">#music<\/span>/);
  assert.doesNotMatch(markup, /<span class="chip">C#<\/span>/);
});

test('resolveVaultAttachment prefers the custom resolver when provided', async (t) => {
  clearVaultAttachmentCache();
  let resolverCalls = 0;
  setVaultAttachmentResolver(async (resource) => {
    resolverCalls += 1;
    if (resource === 'portrait.png') {
      return 'blob:mock-url';
    }
    return '';
  });

  t.after(() => {
    setVaultAttachmentResolver(null);
    clearVaultAttachmentCache();
  });

  const url = await resolveVaultAttachment('portrait.png');
  assert.equal(url, 'blob:mock-url');
  assert.equal(resolverCalls, 1);
});
