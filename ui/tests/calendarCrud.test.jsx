import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import Calendar from '../src/pages/Calendar.jsx';
import * as coreApi from '@tauri-apps/api/core';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/calendar' });
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

test('calendar modal supports create, update, and delete flows', async (t) => {
  const teardownDom = setupDom();
  const events = [];

  mock.method(coreApi, 'isTauri', async () => true);
  mock.method(globalThis.window, 'confirm', () => true);
  mock.method(coreApi, 'invoke', async (command, payload) => {
    switch (command) {
      case 'list_events':
        return events.map((event) => ({ ...event }));
      case 'create_event': {
        const nextId = events.length + 1;
        const record = {
          id: nextId,
          title: payload?.event?.title ?? 'Untitled',
          description: payload?.event?.description ?? null,
          start_time: payload?.event?.start_time,
          end_time: payload?.event?.end_time,
          recurrence: payload?.event?.recurrence ?? 'none',
          reminder_offset: payload?.event?.reminder_offset ?? 0,
          status: payload?.event?.status ?? 'custom',
        };
        events.push(record);
        return { ...record };
      }
      case 'update_event': {
        const index = events.findIndex((item) => item.id === payload?.eventId);
        if (index !== -1) {
          const updated = {
            ...events[index],
            ...payload?.changes,
          };
          events[index] = updated;
          return { ...updated };
        }
        return null;
      }
      case 'delete_event': {
        const index = events.findIndex((item) => item.id === payload?.eventId);
        if (index !== -1) {
          events.splice(index, 1);
        }
        return true;
      }
      case 'check_reminders':
        return [];
      default:
        return null;
    }
  });

  t.after(() => {
    cleanup();
    mock.restoreAll();
    teardownDom();
  });

  render(<Calendar />);

  const addButton = await screen.findByRole('button', { name: /add event/i });
  fireEvent.click(addButton);

  const titleInput = await screen.findByLabelText(/title/i);
  fireEvent.change(titleInput, { target: { value: 'Mixdown Session' } });

  const descriptionInput = screen.getByLabelText(/description/i);
  fireEvent.change(descriptionInput, { target: { value: 'Finalize stems before review.' } });

  const reminderInput = screen.getByLabelText(/reminder/i);
  fireEvent.change(reminderInput, { target: { value: '15' } });

  const saveButton = screen.getByRole('button', { name: /create event/i });
  fireEvent.click(saveButton);

  await waitFor(() => {
    assert.ok(screen.getByText(/Mixdown Session/i));
  });

  const editButton = screen.getByRole('button', { name: /Edit Mixdown Session/i });
  fireEvent.click(editButton);

  const editTitleInput = await screen.findByLabelText(/title/i);
  fireEvent.change(editTitleInput, { target: { value: 'Mastering Session' } });

  const updateButton = screen.getByRole('button', { name: /update event/i });
  fireEvent.click(updateButton);

  await waitFor(() => {
    assert.ok(screen.getByText(/Mastering Session/i));
  });

  const deleteButton = screen.getByRole('button', { name: /Delete Mastering Session/i });
  fireEvent.click(deleteButton);

  await waitFor(() => {
    assert.equal(screen.queryByText(/Mastering Session/i), null);
  });
});
