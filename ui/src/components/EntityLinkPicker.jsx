import { useEffect, useId, useMemo, useState } from 'react';

import { listEntitiesByType } from '../lib/vaultIndex.js';
import { ENTITY_ID_PATTERN } from '../lib/dndIds.js';

const DEFAULT_TYPES = ['npc', 'quest', 'loc', 'faction', 'monster', 'encounter', 'session'];
const TYPE_LABELS = new Map([
  ['npc', 'NPC'],
  ['quest', 'Quest'],
  ['loc', 'Location'],
  ['location', 'Location'],
  ['faction', 'Faction'],
  ['monster', 'Monster'],
  ['encounter', 'Encounter'],
  ['session', 'Session'],
]);

const typeCache = new Map();

function normalizeTypes(entityTypes) {
  const items = Array.isArray(entityTypes) ? entityTypes : DEFAULT_TYPES;
  const normalized = new Set();
  items.forEach((item) => {
    if (!item) return;
    const key = String(item).trim().toLowerCase();
    if (key) normalized.add(key);
  });
  if (normalized.size === 0) {
    DEFAULT_TYPES.forEach((type) => normalized.add(type));
  }
  return Array.from(normalized);
}

async function loadTypeEntries(type) {
  if (!type) return [];
  const key = String(type).toLowerCase();
  if (typeCache.has(key)) {
    const cached = typeCache.get(key);
    if (Array.isArray(cached)) {
      return cached;
    }
    return cached;
  }
  const promise = listEntitiesByType(key, { force: false })
    .then((result) => {
      const entries = Array.isArray(result?.entries) ? result.entries : [];
      const normalized = entries
        .map((entry) => ({
          id: entry?.id || entry?.index?.id || '',
          name: entry?.title || entry?.name || entry?.index?.name || '',
          type: entry?.type || key,
          relPath: entry?.relPath || entry?.path || '',
        }))
        .filter((entry) => entry.id);
      typeCache.set(key, normalized);
      return normalized;
    })
    .catch((error) => {
      typeCache.delete(key);
      throw error;
    });
  typeCache.set(key, promise);
  return promise;
}

function formatTypeLabel(type) {
  if (!type) return '';
  const key = String(type).toLowerCase();
  return TYPE_LABELS.get(key) || key.charAt(0).toUpperCase() + key.slice(1);
}

function buildDisplay(entry) {
  const label = entry?.name || entry?.id || '';
  const typeLabel = formatTypeLabel(entry?.type);
  const parts = [];
  if (label) parts.push(label);
  if (typeLabel) parts.push(typeLabel);
  const descriptor = parts.length > 0 ? `${parts.join(' · ')}` : entry?.id || '';
  return entry?.id ? `${descriptor} (${entry.id})` : descriptor;
}

function deriveIdFromDisplay(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (ENTITY_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\(([^()]+)\)\s*$/);
  if (match && ENTITY_ID_PATTERN.test(match[1])) {
    return match[1];
  }
  return '';
}

function cloneEntries(entries) {
  return entries.map((entry) => ({ ...entry }));
}

export default function EntityLinkPicker({
  value,
  onChange,
  entityTypes = DEFAULT_TYPES,
  placeholder = 'Search by name or ID…',
  disabled = false,
  autoComplete = 'off',
  helperText = '',
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [committedValue, setCommittedValue] = useState('');
  const listId = useId();

  const normalizedTypes = useMemo(() => normalizeTypes(entityTypes), [entityTypes]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const results = await Promise.all(normalizedTypes.map((type) => loadTypeEntries(type)));
        if (cancelled) return;
        const merged = [];
        results.forEach((entries) => {
          entries.forEach((entry) => {
            if (!entry?.id) return;
            merged.push(entry);
          });
        });
        const deduped = new Map();
        merged.forEach((entry) => {
          const existing = deduped.get(entry.id);
          if (!existing) {
            deduped.set(entry.id, entry);
            return;
          }
          if (!existing.name && entry.name) {
            deduped.set(entry.id, entry);
          }
        });
        const finalOptions = cloneEntries(Array.from(deduped.values())).sort((a, b) => {
          const labelA = (a.name || a.id || '').toLowerCase();
          const labelB = (b.name || b.id || '').toLowerCase();
          if (labelA < labelB) return -1;
          if (labelA > labelB) return 1;
          return 0;
        });
        setOptions(finalOptions);
      } catch (err) {
        if (!cancelled) {
          console.error('EntityLinkPicker failed to load entities', err);
          setOptions([]);
          setError(err?.message || 'Failed to load entities');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [normalizedTypes]);

  const optionMap = useMemo(() => {
    const map = new Map();
    options.forEach((entry) => {
      if (!entry?.id) return;
      map.set(entry.id, entry);
    });
    return map;
  }, [options]);

  const displayForValue = useMemo(() => {
    if (!value) return '';
    const match = optionMap.get(value);
    if (match) {
      return buildDisplay(match);
    }
    if (ENTITY_ID_PATTERN.test(String(value))) {
      return String(value);
    }
    return '';
  }, [value, optionMap]);

  useEffect(() => {
    setInputValue(displayForValue);
    setCommittedValue(displayForValue);
  }, [displayForValue]);

  const finalizeValue = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      setCommittedValue('');
      setInputValue('');
      if (typeof onChange === 'function') {
        onChange(null);
      }
      return true;
    }
    const derivedId = deriveIdFromDisplay(trimmed);
    const normalizedId = derivedId || (ENTITY_ID_PATTERN.test(trimmed) ? trimmed : '');
    if (normalizedId) {
      const match = optionMap.get(normalizedId);
      const display = match ? buildDisplay(match) : normalizedId;
      setCommittedValue(display);
      setInputValue(display);
      if (typeof onChange === 'function') {
        onChange(normalizedId);
      }
      return true;
    }
    const normalizedTrimmed = trimmed.toLowerCase();
    const found = options.find((entry) => {
      const display = buildDisplay(entry).toLowerCase();
      if (display === normalizedTrimmed) return true;
      if ((entry.name || '').toLowerCase() === normalizedTrimmed) return true;
      return false;
    });
    if (found) {
      const display = buildDisplay(found);
      setCommittedValue(display);
      setInputValue(display);
      if (typeof onChange === 'function') {
        onChange(found.id);
      }
      return true;
    }
    return false;
  };

  return (
    <div className="entity-link-picker">
      <div className="entity-link-picker-input-row">
        <input
          className="entity-link-picker-input"
          type="text"
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            const maybeId = deriveIdFromDisplay(nextValue);
            if (maybeId && typeof onChange === 'function') {
              onChange(maybeId);
            }
          }}
          onBlur={() => {
            if (!finalizeValue(inputValue)) {
              setInputValue(committedValue);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (!finalizeValue(event.currentTarget.value)) {
                event.preventDefault();
              }
            }
          }}
          list={listId}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        {inputValue && !disabled && (
          <button
            type="button"
            className="entity-link-picker-clear"
            onClick={() => {
              setInputValue('');
              setCommittedValue('');
              if (typeof onChange === 'function') {
                onChange(null);
              }
            }}
          >
            Clear
          </button>
        )}
      </div>
      <datalist id={listId}>
        {options.map((entry) => {
          const display = buildDisplay(entry);
          return <option key={entry.id} value={display} />;
        })}
      </datalist>
      <div className="entity-link-picker-status">
        {loading && <span className="muted">Loading entities…</span>}
        {!loading && error && <span className="error">{error}</span>}
        {!loading && !error && helperText && <span className="muted">{helperText}</span>}
      </div>
    </div>
  );
}
