import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';

import { WorldInventoryProvider } from '../src/lib/worldInventoryState.js';
import { WorldInventoryView } from '../src/pages/DndDmWorldInventory.jsx';

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentNode = null;
    this.ownerDocument = null;
    this.childNodes = [];
    this._listeners = Object.create(null);
  }

  appendChild(node) {
    if (!node) return null;
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    this.childNodes.push(node);
    node.parentNode = this;
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    if (doc) {
      node.ownerDocument = doc;
      if (typeof node.propagateOwnerDocument === 'function') {
        node.propagateOwnerDocument(doc);
      }
    }
    return node;
  }

  insertBefore(node, reference) {
    if (reference === null || reference === undefined) {
      return this.appendChild(node);
    }
    const index = this.childNodes.indexOf(reference);
    if (index === -1) {
      throw new Error('Reference node is not a child of this node.');
    }
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    if (doc) {
      node.ownerDocument = doc;
      if (typeof node.propagateOwnerDocument === 'function') {
        node.propagateOwnerDocument(doc);
      }
    }
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index === -1) {
      throw new Error('Node is not a child of this parent.');
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  replaceChild(newNode, oldNode) {
    this.insertBefore(newNode, oldNode);
    this.removeChild(oldNode);
    return oldNode;
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  addEventListener(type, handler) {
    if (!this._listeners[type]) {
      this._listeners[type] = new Set();
    }
    this._listeners[type].add(handler);
  }

  removeEventListener(type, handler) {
    this._listeners[type]?.delete(handler);
  }

  dispatchEvent(event) {
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('Event object with type is required');
    }
    if (event.target === undefined) {
      Object.defineProperty(event, 'target', { value: this, configurable: true });
    }
    Object.defineProperty(event, 'currentTarget', { value: this, configurable: true });
    if (event.bubbles === undefined) {
      event.bubbles = true;
    }
    if (event.cancelBubble === undefined) {
      event.cancelBubble = false;
    }
    if (typeof event.preventDefault !== 'function') {
      event.defaultPrevented = false;
      event.preventDefault = function () {
        this.defaultPrevented = true;
      };
    }
    if (typeof event.stopPropagation !== 'function') {
      event.stopPropagation = function () {
        this.cancelBubble = true;
      };
    }
    const listeners = this._listeners[event.type];
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        listener.call(this, event);
        if (event.cancelBubble) {
          break;
        }
      }
    }
    if (event.bubbles && !event.cancelBubble && this.parentNode) {
      return this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.childNodes) {
      if (child.contains && child.contains(node)) {
        return true;
      }
    }
    return false;
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super(3);
    this.nodeValue = String(text ?? '');
    this.textContent = this.nodeValue;
    this.nodeName = '#text';
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value ?? '');
  }
}

class FakeComment extends FakeNode {
  constructor(text) {
    super(8);
    this.nodeValue = String(text ?? '');
    this.nodeName = '#comment';
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value ?? '');
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.tagName = String(tagName || 'div').toUpperCase();
    this.nodeName = this.tagName;
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.type = '';
    this.id = '';
    this.name = '';
    this.disabled = false;
    this.options = [];
  }

  appendChild(node) {
    const appended = super.appendChild(node);
    if (this.tagName === 'SELECT' && appended && appended.tagName === 'OPTION') {
      this.options.push(appended);
      if (appended.selected || this.value === '') {
        this.value = appended.value || appended.getAttribute('value') || this.value;
      }
    }
    return appended;
  }

  propagateOwnerDocument(doc) {
    for (const child of this.childNodes) {
      child.ownerDocument = doc;
      if (typeof child.propagateOwnerDocument === 'function') {
        child.propagateOwnerDocument(doc);
      }
    }
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes[name] = normalized;
    if (name === 'value') {
      this.value = normalized;
    } else if (name === 'checked') {
      this.checked = normalized !== 'false';
    } else if (name === 'id') {
      this.id = normalized;
    } else if (name === 'name') {
      this.name = normalized;
    } else if (name === 'type') {
      this.type = normalized;
    }
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  set textContent(value) {
    this.childNodes = [];
    if (value !== undefined && value !== null && value !== '') {
      super.appendChild(new FakeText(value));
    }
  }

  get innerHTML() {
    return this.textContent;
  }

  set innerHTML(value) {
    this.textContent = value;
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1);
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument._activeElement = this;
    }
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument._activeElement === this) {
      this.ownerDocument._activeElement = this.ownerDocument.body;
    }
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9);
    this.nodeName = '#document';
    this.documentElement = new FakeElement('html');
    this.body = new FakeElement('body');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    super.appendChild(this.documentElement);
    this._listeners = Object.create(null);
    this._activeElement = this.body;
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createElementNS(namespace, tagName) {
    return this.createElement(tagName);
  }

  createTextNode(text) {
    const node = new FakeText(text);
    node.ownerDocument = this;
    return node;
  }

  createComment(text) {
    const comment = new FakeComment(text);
    comment.ownerDocument = this;
    return comment;
  }

  addEventListener(type, handler) {
    if (!this._listeners[type]) {
      this._listeners[type] = new Set();
    }
    this._listeners[type].add(handler);
  }

  removeEventListener(type, handler) {
    this._listeners[type]?.delete(handler);
  }

  dispatchEvent(event) {
    if (!event || typeof event.type !== 'string') {
      return false;
    }
    if (event.target === undefined) {
      Object.defineProperty(event, 'target', { value: this, configurable: true });
    }
    Object.defineProperty(event, 'currentTarget', { value: this, configurable: true });
    const listeners = this._listeners[event.type];
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        listener.call(this, event);
      }
    }
    return true;
  }

  get activeElement() {
    return this._activeElement || this.body;
  }

  getElementById(id) {
    return findElement(this, (node) => node.id === id);
  }
}

function ensureDom() {
  if (globalThis.document) return;
  const document = new FakeDocument();
  const window = {
    document,
    navigator: { userAgent: 'node' },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.navigator = window.navigator;
  document.defaultView = window;
  globalThis.HTMLElement = FakeElement;
  globalThis.Node = FakeNode;
  window.HTMLElement = FakeElement;
  window.Node = FakeNode;
  window.HTMLInputElement = FakeElement;
  window.HTMLSelectElement = FakeElement;
  window.HTMLTextAreaElement = FakeElement;
  window.HTMLButtonElement = FakeElement;
  window.HTMLLabelElement = FakeElement;
  window.HTMLIFrameElement = FakeElement;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.MutationObserver = class {
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

ensureDom();

function findElement(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  if (!node.childNodes) return null;
  for (const child of node.childNodes) {
    const result = findElement(child, predicate);
    if (result) return result;
  }
  return null;
}

function findAllElements(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  if (node.childNodes) {
    for (const child of node.childNodes) {
      findAllElements(child, predicate, out);
    }
  }
  return out;
}

function findButtonByText(root, text) {
  return findElement(
    root,
    (node) => node.nodeType === 1 && node.tagName === 'BUTTON' && node.textContent.includes(text)
  );
}

function findAllButtonsByText(root, text) {
  return findAllElements(
    root,
    (node) => node.nodeType === 1 && node.tagName === 'BUTTON' && node.textContent.includes(text)
  );
}

function findLabelByText(root, text) {
  return findElement(
    root,
    (node) => node.nodeType === 1 && node.tagName === 'LABEL' && node.textContent.includes(text)
  );
}

function findSelectByLabel(root, text) {
  const label = findLabelByText(root, text);
  if (!label) return null;
  return label.childNodes.find((child) => child.nodeType === 1 && child.tagName === 'SELECT') || null;
}

function findInputByLabel(root, text) {
  const label = findLabelByText(root, text);
  if (!label) return null;
  return label.childNodes.find((child) => child.nodeType === 1 && child.tagName === 'INPUT') || null;
}

function findTextareaByLabel(root, text) {
  const label = findLabelByText(root, text);
  if (!label) return null;
  return label.childNodes.find((child) => child.nodeType === 1 && child.tagName === 'TEXTAREA') || null;
}

function findFormByField(root, text) {
  return findElement(
    root,
    (node) =>
      node.nodeType === 1 &&
      node.tagName === 'FORM' &&
      !!findLabelByText(node, text)
  );
}

function findTextareaByPlaceholder(root, text) {
  return findElement(
    root,
    (node) =>
      node.nodeType === 1 &&
      node.tagName === 'TEXTAREA' &&
      node.getAttribute('placeholder') === text
  );
}

function fireEvent(target, type, overrides = {}) {
  if (!target) {
    throw new Error(`Unable to fire ${type} event on undefined target`);
  }
  const event = {
    type,
    bubbles: overrides.bubbles !== undefined ? overrides.bubbles : true,
    cancelable: overrides.cancelable !== undefined ? overrides.cancelable : true,
    cancelBubble: false,
    defaultPrevented: false,
    target,
    ...overrides,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  };
  target.dispatchEvent(event);
  return event;
}

function renderWithApi(api) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
    render: async () => {
      await act(async () => {
        root.render(
          React.createElement(
            WorldInventoryProvider,
            { api },
            React.createElement(WorldInventoryView)
          )
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
  };
}

function createFakeApi() {
  let ledgerCounter = 0;
  const owners = [
    { id: 'owner-1', name: 'Thalia' },
    { id: 'owner-2', name: 'Kara' },
  ];
  const containers = [{ id: 'container-1', name: 'Vault Locker' }];
  const locations = [{ id: 'location-1', name: 'Skyhold' }];
  let currentItem = {
    id: 'item-1',
    name: 'Moon Dagger',
    type: 'Weapon',
    rarity: 'Rare',
    tags: ['Fey'],
    quests: ['Autumn Court'],
    ownerId: '',
    containerId: '',
    locationId: 'location-1',
    attunement: { required: false, restrictions: [], notes: '', attunedTo: [] },
    charges: { current: 2, maximum: 3, recharge: 'dawn' },
    durability: { current: 3, maximum: 3, state: 'polished', notes: '' },
    provenance: { origin: 'Recovered from the Autumn Court', ledger: [] },
    description: 'A crescent blade that hums under moonlight.',
    notes: '',
  };
  const calls = {
    moveItem: [],
    createLedgerEntry: [],
    updateLedgerEntry: [],
    deleteLedgerEntry: [],
    updateItem: [],
  };
  return {
    api: {
      fetchSnapshot: async () => ({
        items: [currentItem],
        owners,
        containers,
        locations,
      }),
      moveItem: async (itemId, targets) => {
        calls.moveItem.push([itemId, targets]);
        currentItem = { ...currentItem, ...targets };
        return { item: currentItem };
      },
      createLedgerEntry: async (itemId, entry) => {
        calls.createLedgerEntry.push([itemId, entry]);
        ledgerCounter += 1;
        const ledgerEntry = { id: `ledger-${ledgerCounter}`, ...entry };
        currentItem = {
          ...currentItem,
          provenance: {
            ...currentItem.provenance,
            ledger: [...currentItem.provenance.ledger, ledgerEntry],
          },
        };
        return { item: currentItem };
      },
      updateLedgerEntry: async (itemId, entryId, entry) => {
        calls.updateLedgerEntry.push([itemId, entryId, entry]);
        currentItem = {
          ...currentItem,
          provenance: {
            ...currentItem.provenance,
            ledger: currentItem.provenance.ledger.map((item) =>
              item.id === entryId ? { ...item, ...entry } : item
            ),
          },
        };
        return { item: currentItem };
      },
      deleteLedgerEntry: async (itemId, entryId) => {
        calls.deleteLedgerEntry.push([itemId, entryId]);
        currentItem = {
          ...currentItem,
          provenance: {
            ...currentItem.provenance,
            ledger: currentItem.provenance.ledger.filter((item) => item.id !== entryId),
          },
        };
        return { item: currentItem };
      },
      updateItem: async (itemId, changes) => {
        calls.updateItem.push([itemId, changes]);
        currentItem = {
          ...currentItem,
          ...(changes.charges ? { charges: { ...currentItem.charges, ...changes.charges } } : {}),
          ...(changes.durability
            ? { durability: { ...currentItem.durability, ...changes.durability } }
            : {}),
          provenance: {
            ...currentItem.provenance,
            ...(changes.provenance || {}),
          },
        };
        return { item: currentItem };
      },
    },
    calls,
    getItem: () => currentItem,
  };
}

function findElementByText(root, text) {
  return findElement(
    root,
    (node) => node.nodeType === 1 && node.textContent.includes(text)
  );
}

test('moving an item updates assignment through the API', async () => {
  const { api, calls } = createFakeApi();
  const { container, render, cleanup } = renderWithApi(api);
  await render();
  const ownerSelect = findSelectByLabel(container, 'Owner');
  assert.ok(ownerSelect, 'owner select should render');
  await act(async () => {
    ownerSelect.value = 'owner-2';
    fireEvent(ownerSelect, 'change');
    await Promise.resolve();
  });
  assert.equal(calls.moveItem.length, 1, 'moveItem API should be invoked once');
  assert.deepEqual(calls.moveItem[0][1], {
    ownerId: 'owner-2',
    containerId: '',
    locationId: 'location-1',
  });
  assert.equal(ownerSelect.value, 'owner-2');
  await cleanup();
});

test('updating charges persists via the API', async () => {
  const { api, calls } = createFakeApi();
  const { container, render, cleanup } = renderWithApi(api);
  await render();
  const chargesForm = findFormByField(container, 'Recharge');
  assert.ok(chargesForm, 'charges form should be present');
  const currentInput = findInputByLabel(chargesForm, 'Current');
  const maximumInput = findInputByLabel(chargesForm, 'Maximum');
  const rechargeInput = findInputByLabel(chargesForm, 'Recharge');
  assert.ok(currentInput && maximumInput && rechargeInput, 'charges inputs should render');
  await act(async () => {
    currentInput.value = '1';
    fireEvent(currentInput, 'input');
    maximumInput.value = '4';
    fireEvent(maximumInput, 'input');
    rechargeInput.value = 'dusk';
    fireEvent(rechargeInput, 'input');
    await Promise.resolve();
  });
  const updateButton = findButtonByText(chargesForm, 'Update');
  await act(async () => {
    fireEvent(updateButton, 'click');
    fireEvent(chargesForm, 'submit');
    await Promise.resolve();
  });
  assert.equal(calls.updateItem.length, 1, 'updateItem should be called once for charges');
  assert.deepEqual(calls.updateItem[0][1], { charges: { current: 1, maximum: 4, recharge: 'dusk' } });
  await cleanup();
});

test('updating durability persists via the API', async () => {
  const { api, calls } = createFakeApi();
  const { container, render, cleanup } = renderWithApi(api);
  await render();
  const durabilityForm = findFormByField(container, 'Status');
  assert.ok(durabilityForm, 'durability form should be present');
  const currentInput = findInputByLabel(durabilityForm, 'Current');
  const maximumInput = findInputByLabel(durabilityForm, 'Maximum');
  const statusInput = findInputByLabel(durabilityForm, 'Status');
  const notesTextarea = findTextareaByLabel(durabilityForm, 'Notes');
  assert.ok(currentInput && maximumInput && statusInput && notesTextarea, 'durability inputs should render');
  await act(async () => {
    currentInput.value = '2';
    fireEvent(currentInput, 'input');
    maximumInput.value = '5';
    fireEvent(maximumInput, 'input');
    statusInput.value = 'tarnished';
    fireEvent(statusInput, 'input');
    notesTextarea.value = 'Slight dent on the guard';
    fireEvent(notesTextarea, 'input');
    await Promise.resolve();
  });
  const updateButton = findButtonByText(durabilityForm, 'Update');
  await act(async () => {
    fireEvent(updateButton, 'click');
    fireEvent(durabilityForm, 'submit');
    await Promise.resolve();
  });
  assert.equal(calls.updateItem.length, 1, 'updateItem should be called once for durability');
  assert.deepEqual(calls.updateItem[0][1], {
    durability: {
      current: 2,
      maximum: 5,
      state: 'tarnished',
      notes: 'Slight dent on the guard',
    },
  });
  await cleanup();
});

test('saving an origin note persists via the API', async () => {
  const { api, calls } = createFakeApi();
  const { container, render, cleanup } = renderWithApi(api);
  await render();
  const originTextarea = findTextareaByPlaceholder(
    container,
    'Recorded origin or acquisition notes'
  );
  assert.ok(originTextarea, 'origin textarea should render');
  await act(async () => {
    originTextarea.value = 'Recovered from the Verdant Archives';
    fireEvent(originTextarea, 'change');
    await Promise.resolve();
  });
  const saveButton = findButtonByText(container, 'Save origin');
  assert.ok(saveButton, 'origin save button should render');
  await act(async () => {
    fireEvent(saveButton, 'click');
    await Promise.resolve();
  });
  assert.equal(calls.updateItem.length, 1, 'updateItem should be called once');
  assert.deepEqual(calls.updateItem[0][1], {
    provenance: { origin: 'Recovered from the Verdant Archives' },
  });
  await cleanup();
});

test('adding a provenance entry persists via the API and renders in the ledger', async () => {
  const { api, calls } = createFakeApi();
  const { container, render, cleanup } = renderWithApi(api);
  await render();
  const addButton = findButtonByText(container, 'Add entry');
  assert.ok(addButton, 'Add entry button should render');
  await act(async () => {
    fireEvent(addButton, 'click');
    await Promise.resolve();
  });
  const whenInput = findInputByLabel(container, 'When');
  const actorInput = findInputByLabel(container, 'Actor');
  const actionInput = findInputByLabel(container, 'Action');
  const notesTextarea = findTextareaByLabel(container, 'Notes');
  assert.ok(whenInput && actorInput && actionInput && notesTextarea, 'ledger form should render');
  await act(async () => {
    whenInput.value = '2024-06-01T10:00';
    fireEvent(whenInput, 'change');
    actorInput.value = 'Archivist';
    fireEvent(actorInput, 'change');
    actionInput.value = 'Recorded transfer';
    fireEvent(actionInput, 'change');
    notesTextarea.value = 'Moved to the Shadowfell vault';
    fireEvent(notesTextarea, 'change');
  });
  const buttons = findAllButtonsByText(container, 'Add entry');
  const submitButton = buttons[buttons.length - 1];
  const ledgerForm = findFormByField(container, 'When');
  await act(async () => {
    fireEvent(submitButton, 'click');
    if (ledgerForm) {
      fireEvent(ledgerForm, 'submit');
    }
    await Promise.resolve();
  });
  assert.equal(calls.createLedgerEntry.length, 1, 'createLedgerEntry should be called');
  const entry = calls.createLedgerEntry[0][1];
  const deleteButton = findButtonByText(container, 'Delete');
  assert.ok(deleteButton, 'ledger entry delete action should render after creation');
  await cleanup();
});
