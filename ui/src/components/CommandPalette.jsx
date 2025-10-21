import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNpc } from '../api/npcs.js';
import {
  createEncounter,
  createFaction,
  createDomain,
  createQuest,
  createSession,
} from '../api/entities.js';
import { listEntitiesByType, resetVaultIndexCache } from '../lib/vaultIndex.js';
import { makeId } from '../lib/dndIds.js';

const ROUTES = {
  npc: (id) => `/dnd/npc/${encodeURIComponent(id)}`,
  quest: (id) => `/dnd/quest/${encodeURIComponent(id)}`,
  loc: (id) => `/dnd/location/${encodeURIComponent(id)}`,
  faction: (id) => `/dnd/faction/${encodeURIComponent(id)}`,
  encounter: (id) => `/dnd/encounter/${encodeURIComponent(id)}`,
  session: (id) => `/dnd/session/${encodeURIComponent(id)}`,
};

const NPC_TEMPLATE_PATH = 'assets/dnd_templates/NPC_Template.md';

function focusFirstElement(container) {
  if (!container) return;
  const selectors = [
    'input:not([disabled])',
    'button:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ];
  const focusable = container.querySelectorAll(selectors.join(','));
  if (focusable.length > 0 && focusable[0] instanceof HTMLElement) {
    focusable[0].focus();
  } else if (container instanceof HTMLElement) {
    container.focus();
  }
}

function trapTabKey(event, container) {
  if (event.key !== 'Tab' || !container) return;
  const selectors = [
    'input:not([disabled])',
    'button:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ];
  const nodes = Array.from(container.querySelectorAll(selectors.join(','))).filter(
    (node) => node instanceof HTMLElement && node.offsetParent !== null,
  );
  if (!nodes.length) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const previousFocusRef = useRef(null);
  const openPayloadRef = useRef(null);
  const templatesRef = useRef([]);

  const createNpcFromPalette = useCallback(
    async (name) => {
      const displayName = String(name ?? '').trim() || 'New NPC';
      const { entries = [] } = await listEntitiesByType('npc', { force: true }).catch(() => ({ entries: [] }));
      const idPool = new Set(entries.map((entry) => entry.id || entry.index?.id).filter(Boolean));
      const npcId = makeId('npc', displayName, idPool);
      const path = await createNpc(
        npcId,
        displayName,
        '',
        '',
        NPC_TEMPLATE_PATH,
        false,
        null,
        null,
      );
      resetVaultIndexCache();
      return { id: npcId, path, type: 'npc', name: displayName };
    },
    [],
  );

  const templates = useMemo(
    () => [
      {
        id: 'npc',
        label: 'Create NPC',
        description: 'Generate a full NPC dossier with YAML frontmatter.',
        type: 'npc',
        keywords: ['character', 'person'],
        action: createNpcFromPalette,
      },
      {
        id: 'quest',
        label: 'Create Quest',
        description: 'Story hook builder is coming soon.',
        type: 'quest',
        keywords: ['story', 'mission'],
        action: createQuest,
        disabled: true,
        status: 'WIP',
      },
      {
        id: 'domain',
        label: 'Create Domain',
        description: 'Outline a realm or seat of power with the domain dossier.',
        type: 'domain',
        keywords: ['domain', 'realm', 'stronghold', 'province'],
        action: createDomain,
      },
      {
        id: 'faction',
        label: 'Create Faction',
        description: 'Draft a faction sheet using the faction playbook template.',
        type: 'faction',
        keywords: ['organization', 'group'],
        action: createFaction,
      },
      {
        id: 'encounter',
        label: 'Create Encounter',
        description: 'Prep an encounter outline with setup and beats.',
        type: 'encounter',
        keywords: ['combat', 'event'],
        action: createEncounter,
      },
      {
        id: 'session',
        label: 'Create Session Log',
        description: 'Spin up a new session prep or recap note.',
        type: 'session',
        keywords: ['log', 'recap'],
        action: createSession,
      },
    ],
    [
      createDomain,
      createEncounter,
      createFaction,
      createNpcFromPalette,
      createQuest,
      createSession,
    ],
  );

  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  useEffect(() => {
    const handler = (event) => {
      if (event.defaultPrevented) return;
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      const payload = openPayloadRef.current || {};
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const templateList = templatesRef.current || templates;
      const initialQuery = typeof payload.query === 'string' ? payload.query : '';
      setQuery(initialQuery);
      if (payload.templateId) {
        const idx = templateList.findIndex((template) => template.id === payload.templateId);
        setHighlightIndex(idx >= 0 ? idx : 0);
      } else {
        setHighlightIndex(0);
      }
      setError('');
      setBusy(false);
      const frame = requestAnimationFrame(() => {
        focusFirstElement(panelRef.current);
        if (inputRef.current) {
          inputRef.current.focus();
          if (initialQuery) {
            const cursor = initialQuery.length;
            inputRef.current.setSelectionRange(cursor, cursor);
          }
        }
      });
      openPayloadRef.current = null;
      return () => cancelAnimationFrame(frame);
    }
    const previous = previousFocusRef.current;
    if (previous && typeof previous.focus === 'function') {
      previous.focus();
    }
    return undefined;
  }, [open, templates]);

  useEffect(() => {
    let frame = null;
    const handleExternalOpen = (event) => {
      const detail = event?.detail || {};
      const normalized = {
        query: typeof detail.query === 'string' ? detail.query : '',
        templateId: typeof detail.templateId === 'string' ? detail.templateId : '',
      };
      const templateList = templatesRef.current || templates;
      if (open) {
        setQuery(normalized.query);
        if (normalized.templateId) {
          const idx = templateList.findIndex((template) => template.id === normalized.templateId);
          setHighlightIndex(idx >= 0 ? idx : 0);
        } else {
          setHighlightIndex(0);
        }
        setError('');
        setBusy(false);
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            if (normalized.query) {
              const cursor = normalized.query.length;
              inputRef.current.setSelectionRange(cursor, cursor);
            }
          }
        });
      } else {
        openPayloadRef.current = normalized;
        setOpen(true);
      }
    };
    window.addEventListener('command-palette:open', handleExternalOpen);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('command-palette:open', handleExternalOpen);
    };
  }, [open, templates]);

  const closePalette = useCallback(() => {
    setOpen(false);
  }, []);

  const filteredTemplates = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return templates;
    }
    return templates.filter((item) => {
      if (item.label.toLowerCase().includes(term)) return true;
      if (item.description.toLowerCase().includes(term)) return true;
      if (item.type && item.type.includes(term)) return true;
      if (item.status && item.status.toLowerCase().includes(term)) return true;
      return item.keywords?.some((keyword) => keyword.toLowerCase().includes(term));
    });
  }, [templates, query]);

  useEffect(() => {
    if (highlightIndex >= filteredTemplates.length) {
      setHighlightIndex(filteredTemplates.length ? filteredTemplates.length - 1 : 0);
    }
  }, [filteredTemplates, highlightIndex]);

  const executeTemplate = useCallback(
    async (template) => {
      if (!template || template.disabled || typeof template.action !== 'function') return;
      setBusy(true);
      setError('');
      try {
        const name = query.trim();
        const result = await template.action(name);
        const routeBuilder = ROUTES[result?.type];
        closePalette();
        if (routeBuilder && result?.id) {
          navigate(routeBuilder(result.id));
        }
      } catch (err) {
        const message = err?.message || 'Failed to create entity';
        setError(message);
        setBusy(false);
      }
    },
    [closePalette, navigate, query],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightIndex((prev) => {
          if (!filteredTemplates.length) return 0;
          return (prev + 1) % filteredTemplates.length;
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightIndex((prev) => {
          if (!filteredTemplates.length) return 0;
          return (prev - 1 + filteredTemplates.length) % filteredTemplates.length;
        });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const template = filteredTemplates[highlightIndex] || filteredTemplates[0];
        if (template && !template.disabled) {
          executeTemplate(template);
        }
      }
    },
    [closePalette, executeTemplate, filteredTemplates, highlightIndex],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette" role="presentation">
      <div className="command-palette__backdrop" onClick={busy ? undefined : closePalette} />
      <div
        ref={panelRef}
        className="command-palette__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-label"
        tabIndex={-1}
        onKeyDown={(event) => trapTabKey(event, panelRef.current)}
      >
        <div className="command-palette__header">
          <label id="command-palette-label" className="command-palette__label">
            Quick Actions
          </label>
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            placeholder="Type an entity name, then choose a template"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
        </div>
        {error && <div className="command-palette__error">{error}</div>}
        <ul className="command-palette__list" role="listbox" aria-busy={busy}>
          {filteredTemplates.length === 0 && (
            <li className="command-palette__empty">No templates match “{query}”.</li>
          )}
          {filteredTemplates.map((template, index) => (
            <li
              key={template.id}
              role="option"
              aria-selected={index === highlightIndex}
              className={
                index === highlightIndex
                  ? 'command-palette__item command-palette__item--active'
                  : 'command-palette__item'
              }
            >
              <button
                type="button"
                className={`command-palette__button${template.disabled ? ' is-disabled' : ''}`}
                disabled={busy || template.disabled}
                aria-disabled={template.disabled}
                onClick={() => executeTemplate(template)}
              >
                <div className="command-palette__item-top">
                  <span className="command-palette__item-title">{template.label}</span>
                  <div className="command-palette__item-flair">
                    {template.status && (
                      <span className="command-palette__item-status">{template.status}</span>
                    )}
                    <span className="command-palette__item-type">{template.type}</span>
                  </div>
                </div>
                <span className="command-palette__item-meta">{template.description}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="command-palette__hint">
          Press <kbd>Esc</kbd> to close · <kbd>↑</kbd>/<kbd>↓</kbd> to navigate · <kbd>Enter</kbd> to create
        </div>
      </div>
    </div>
  );
}

