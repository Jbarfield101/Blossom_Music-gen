import React from 'react';
import ReactDOM from 'react-dom/client';

const activeRoots = new Set();

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function matchesText(node, matcher) {
  const text = normalizeText(node.textContent || '');
  if (typeof matcher === 'string') {
    return text === normalizeText(matcher);
  }
  if (matcher instanceof RegExp) {
    return matcher.test(text);
  }
  return false;
}

function collectCandidates(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function roleToElements(role) {
  if (role === 'heading') {
    return [
      ...collectCandidates('[role="heading"]'),
      ...collectCandidates('h1, h2, h3, h4, h5, h6'),
    ];
  }
  return collectCandidates(`[role="${role}"]`);
}

function getByRole(role, options = {}) {
  const { name } = options;
  const candidates = roleToElements(role);
  if (!candidates.length) {
    throw new Error(`Unable to find element with role ${role}`);
  }
  if (name == null) {
    return candidates[0];
  }
  for (const candidate of candidates) {
    if (matchesText(candidate, name)) {
      return candidate;
    }
  }
  throw new Error(`Unable to find element with role ${role} and name ${name}`);
}

function getByText(matcher) {
  const elements = collectCandidates('*');
  for (const element of elements) {
    if (matchesText(element, matcher)) {
      return element;
    }
  }
  throw new Error(`Unable to find element with text ${matcher}`);
}

export function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  root.render(ui);
  const record = { root, container };
  activeRoots.add(record);
  return {
    container,
    rerender(nextUi) {
      root.render(nextUi);
    },
    unmount() {
      root.unmount();
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
      activeRoots.delete(record);
    },
  };
}

export function cleanup() {
  for (const record of Array.from(activeRoots)) {
    record.root.unmount();
    if (record.container.parentNode) {
      record.container.parentNode.removeChild(record.container);
    }
    activeRoots.delete(record);
  }
  document.body.innerHTML = '';
}

export async function waitFor(assertion, { timeout = 2000, interval = 50 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeout) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError || new Error('waitFor timed out');
}

export const screen = {
  getByRole,
  getByText,
  async findByText(matcher, options) {
    return waitFor(() => getByText(matcher), options);
  },
};
