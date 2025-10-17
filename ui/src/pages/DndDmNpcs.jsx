import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import ReactMde from 'react-mde';
import Showdown from 'showdown';
import matter from 'gray-matter';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

import BackButton from '../components/BackButton.jsx';
import EntityLinkPicker from '../components/EntityLinkPicker.jsx';
import { getDreadhavenRoot } from '../api/config';
import { listDir } from '../api/dir';
import { readInbox, deleteInbox } from '../api/inbox';
import { readFileBytes } from '../api/files';
import { createNpc, saveNpc, listNpcs } from '../api/npcs';
import { makeId, ENTITY_ID_PATTERN } from '../lib/dndIds';
import { loadEstablishments } from '../api/establishments';
import { listPiperVoices } from '../lib/piperVoices';
import { npcSchema } from '../lib/dndSchemas.js';
import { useVaultVersion } from '../lib/vaultEvents.jsx';
import { listEntitiesByType, getIndexEntityById, resetVaultIndexCache, resolveVaultPath } from '../lib/vaultIndex.js';
import { loadEntity } from '../lib/vaultAdapter.js';

import './Dnd.css';
import 'react-mde/lib/styles/css/react-mde-all.css';

const DEFAULT_NPC = 'D\\\\Documents\\\\DreadHaven\\\\20_DM\\\\NPC'.replace(/\\\\/g, '\\\\');
const DEFAULT_PORTRAITS = 'D\\\\Documents\\\\DreadHaven\\\\30_Assets\\\\Images\\\\NPC_Portraits'.replace(/\\\\/g, '\\\\');
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function titleFromName(name) {
  try { return String(name || '').replace(/\.[^.]+$/, ''); } catch { return String(name || ''); }
}

function relLocation(base, fullPath) {
  const b = String(base || '').replace(/\\/g, '/');
  const f = String(fullPath || '').replace(/\\/g, '/');
  const parent = f.substring(0, f.lastIndexOf('/'));
  if (!b || !parent.startsWith(b)) return '';
  let rel = parent.substring(b.length).replace(/^\/+/, '');
  return rel || '';
}

function sanitizeChip(s) {
  s = String(s || '').trim();
  if (!s) return '';
  s = s.replace(/[\*_`]+/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

function extractChip(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractChip(entry);
      if (candidate) return candidate;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    if (typeof value.value !== 'undefined') {
      return extractChip(value.value);
    }
    return '';
  }
  return sanitizeChip(value);
}

function firstChip(...values) {
  for (const value of values) {
    const candidate = extractChip(value);
    if (candidate) return candidate;
  }
  return '';
}

const LEDGER_FIELDS = [
  { key: 'allies', label: 'Allies', helper: 'Trusted companions, supporters, and partners.' },
  { key: 'rivals', label: 'Rivals', helper: 'Individuals or groups opposed to this NPC.' },
  {
    key: 'debts_owed_to_npc',
    label: 'Debts Owed To NPC',
    helper: 'Who owes this NPC a favor, payment, or obligation.',
  },
  {
    key: 'debts_owed_by_npc',
    label: 'Debts Owed By NPC',
    helper: 'Debts, favors, or obligations this NPC must repay.',
  },
];

const LEDGER_KEYS = LEDGER_FIELDS.map((entry) => entry.key);

const ENTITY_TYPE_LABELS = new Map([
  ['npc', 'NPC'],
  ['quest', 'Quest'],
  ['loc', 'Location'],
  ['location', 'Location'],
  ['faction', 'Faction'],
  ['monster', 'Monster'],
  ['encounter', 'Encounter'],
  ['session', 'Session'],
]);

function cloneLedgerForForm(source = {}) {
  if (!source || typeof source !== 'object') {
    return {};
  }
  const result = {};
  LEDGER_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      return;
    }
    const entries = Array.isArray(source[key]) ? source[key] : [];
    result[key] = entries.map((entry) => ({
      id: typeof entry?.id === 'string' ? entry.id : '',
      notes: typeof entry?.notes === 'string' ? entry.notes : '',
    }));
  });
  return result;
}

function sanitizeLedgerForDraft(source = {}) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const normalized = {};
  LEDGER_KEYS.forEach((key) => {
    const entries = Array.isArray(source[key]) ? source[key] : [];
    const sanitized = [];
    entries.forEach((entry) => {
      const rawId = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!rawId || !ENTITY_ID_PATTERN.test(rawId)) {
        return;
      }
      const normalizedEntry = { id: rawId };
      if (typeof entry?.notes === 'string') {
        const notes = entry.notes.trim();
        if (notes) {
          normalizedEntry.notes = notes;
        }
      }
      sanitized.push(normalizedEntry);
    });
    if (sanitized.length > 0) {
      normalized[key] = sanitized;
    }
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeLedgerFromSource(source = {}) {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const normalized = {};
  LEDGER_KEYS.forEach((key) => {
    const entries = Array.isArray(source[key]) ? source[key] : [];
    const mapped = [];
    entries.forEach((entry) => {
      const rawId = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!rawId) return;
      const normalizedEntry = { id: rawId };
      if (typeof entry?.notes === 'string') {
        const notes = entry.notes.trim();
        if (notes) {
          normalizedEntry.notes = notes;
        }
      }
      mapped.push(normalizedEntry);
    });
    if (mapped.length > 0) {
      normalized[key] = mapped;
    }
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function formatEntityTypeLabel(type) {
  if (!type) return '';
  const key = String(type).toLowerCase();
  return ENTITY_TYPE_LABELS.get(key) || key.charAt(0).toUpperCase() + key.slice(1);
}

function RelationshipLedgerEditor({ value, onChange, disabled }) {
  const ledger = useMemo(() => cloneLedgerForForm(value || {}), [value]);

  const cloneForUpdate = useCallback(() => {
    const next = {};
    LEDGER_KEYS.forEach((key) => {
      if (Array.isArray(ledger[key])) {
        next[key] = ledger[key].map((entry) => ({
          id: typeof entry?.id === 'string' ? entry.id : '',
          notes: typeof entry?.notes === 'string' ? entry.notes : '',
        }));
      }
    });
    return next;
  }, [ledger]);

  const commit = useCallback(
    (nextLedger) => {
      if (typeof onChange !== 'function') return;
      const payload = {};
      LEDGER_KEYS.forEach((key) => {
        if (Array.isArray(nextLedger[key])) {
          payload[key] = nextLedger[key].map((entry) => ({
            id: typeof entry?.id === 'string' ? entry.id : '',
            notes: typeof entry?.notes === 'string' ? entry.notes : '',
          }));
        }
      });
      onChange(payload);
    },
    [onChange],
  );

  const handleAdd = useCallback(
    (key) => {
      if (disabled) return;
      const next = cloneForUpdate();
      const existing = Array.isArray(next[key]) ? next[key] : [];
      next[key] = [...existing, { id: '', notes: '' }];
      commit(next);
    },
    [cloneForUpdate, commit, disabled],
  );

  const handleIdChange = useCallback(
    (key, index, nextId) => {
      const normalizedId = typeof nextId === 'string' ? nextId : '';
      const next = cloneForUpdate();
      const entries = Array.isArray(next[key]) ? next[key] : [];
      if (entries[index]) {
        entries[index] = { ...entries[index], id: normalizedId };
      } else {
        const padded = [...entries];
        while (padded.length <= index) {
          padded.push({ id: '', notes: '' });
        }
        padded[index] = { ...padded[index], id: normalizedId };
        next[key] = padded;
        commit(next);
        return;
      }
      next[key] = entries;
      commit(next);
    },
    [cloneForUpdate, commit],
  );

  const handleNotesChange = useCallback(
    (key, index, notes) => {
      const next = cloneForUpdate();
      const entries = Array.isArray(next[key]) ? next[key] : [];
      if (entries[index]) {
        entries[index] = { ...entries[index], notes };
      } else {
        const padded = [...entries];
        while (padded.length <= index) {
          padded.push({ id: '', notes: '' });
        }
        padded[index] = { ...padded[index], notes };
        next[key] = padded;
        commit(next);
        return;
      }
      next[key] = entries;
      commit(next);
    },
    [cloneForUpdate, commit],
  );

  const handleRemove = useCallback(
    (key, index) => {
      if (disabled) return;
      const next = cloneForUpdate();
      const entries = Array.isArray(next[key]) ? next[key] : [];
      const updated = entries.filter((_, idx) => idx !== index);
      if (updated.length > 0) {
        next[key] = updated;
      } else {
        delete next[key];
      }
      commit(next);
    },
    [cloneForUpdate, commit, disabled],
  );

  return (
    <fieldset className="npc-ledger-section">
      <legend>Relationship Ledger</legend>
      {LEDGER_FIELDS.map((field) => {
        const entries = Array.isArray(ledger[field.key]) ? ledger[field.key] : [];
        return (
          <div key={field.key} className="npc-ledger-group">
            <div className="npc-ledger-header">
              <div>
                <div className="npc-ledger-title">{field.label}</div>
                {field.helper && <div className="npc-ledger-helper muted">{field.helper}</div>}
              </div>
              <button type="button" onClick={() => handleAdd(field.key)} disabled={disabled} className="npc-ledger-add">
                Add link
              </button>
            </div>
            {entries.length === 0 ? (
              <div className="npc-ledger-empty muted">No {field.label.toLowerCase()} linked yet.</div>
            ) : (
              <div className="npc-ledger-rows">
                {entries.map((entry, index) => (
                  <div key={`${field.key}-${index}`} className="npc-ledger-row">
                    <div className="npc-ledger-cell">
                      <EntityLinkPicker
                        value={entry.id}
                        onChange={(id) => handleIdChange(field.key, index, id)}
                        disabled={disabled}
                        helperText="Type a name or paste an entity ID."
                      />
                    </div>
                    <div className="npc-ledger-cell npc-ledger-cell--notes">
                      <textarea
                        value={entry.notes || ''}
                        onChange={(event) => handleNotesChange(field.key, index, event.target.value)}
                        placeholder="Notes"
                        rows={2}
                        disabled={disabled}
                      />
                    </div>
                    <button
                      type="button"
                      className="npc-ledger-remove"
                      onClick={() => handleRemove(field.key, index)}
                      disabled={disabled}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

const NPC_FORM_SCHEMA = npcSchema
  .pick({
    id: true,
    name: true,
    region: true,
    location: true,
    faction: true,
    role: true,
    importance: true,
    tags: true,
    keywords: true,
    canonical_summary: true,
    relationship_ledger: true,
  })
  .partial({
    region: true,
    location: true,
    faction: true,
    role: true,
    importance: true,
    tags: true,
    keywords: true,
    canonical_summary: true,
    relationship_ledger: true,
  });

const NPC_FORM_DEFAULTS = {
  id: '',
  name: '',
  region: '',
  location: '',
  faction: '',
  role: '',
  importance: undefined,
  tags: [],
  keywords: [],
  canonical_summary: '',
  relationship_ledger: {},
};

function coerceStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
      .filter((entry) => entry);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry);
  }
  return [];
}

function normalizeEntityMeta(meta = {}, fallback = {}) {
  const base = { ...(meta || {}) };
  if (!base.id && fallback.id) base.id = fallback.id;
  if (!base.name && fallback.name) base.name = fallback.name;
  if (base.tags !== undefined) base.tags = coerceStringArray(base.tags);
  if (base.keywords !== undefined) base.keywords = coerceStringArray(base.keywords);
  if (base.aliases !== undefined) base.aliases = coerceStringArray(base.aliases);
  if (base.titles !== undefined) base.titles = coerceStringArray(base.titles);
  if (typeof base.canonical_summary === 'string') {
    base.canonical_summary = base.canonical_summary.trim();
  }
  const normalizedLedger = normalizeLedgerFromSource(base.relationship_ledger);
  if (normalizedLedger) {
    base.relationship_ledger = normalizedLedger;
  } else if (base.relationship_ledger !== undefined) {
    delete base.relationship_ledger;
  }
  return base;
}

function extractFormValues(meta = {}) {
  return {
    id: String(meta.id || ''),
    name: String(meta.name || ''),
    region: String(meta.region || ''),
    location: String(meta.location || ''),
    faction: String(meta.faction || ''),
    role: String(meta.role || ''),
    importance: typeof meta.importance === 'number' ? meta.importance : undefined,
    tags: coerceStringArray(meta.tags),
    keywords: coerceStringArray(meta.keywords),
    canonical_summary: typeof meta.canonical_summary === 'string' ? meta.canonical_summary : '',
    relationship_ledger: cloneLedgerForForm(meta.relationship_ledger || {}),
  };
}

function sanitizeFormValues(values = {}) {
  const next = { ...(values || {}) };
  next.id = String(next.id || '').trim();
  if (typeof next.name === 'string') {
    next.name = next.name.trim();
  }
  const stringKeys = ['region', 'location', 'faction', 'role', 'canonical_summary'];
  stringKeys.forEach((key) => {
    const value = next[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        next[key] = key === 'canonical_summary' ? trimmed : trimmed;
      } else {
        delete next[key];
      }
    }
  });
  ['tags', 'keywords'].forEach((key) => {
    const arr = coerceStringArray(next[key]);
    if (arr.length) {
      next[key] = arr;
    } else {
      delete next[key];
    }
  });
  if (typeof next.importance !== 'number' || Number.isNaN(next.importance)) {
    delete next.importance;
  }
  if (next.relationship_ledger !== undefined) {
    const sanitizedLedger = sanitizeLedgerForDraft(next.relationship_ledger || {});
    if (sanitizedLedger) {
      next.relationship_ledger = sanitizedLedger;
    } else {
      delete next.relationship_ledger;
    }
  }
  return next;
}

export default function DndDmNpcs() {
  const navigate = useNavigate();
  const { id: routeIdParam } = useParams();
  const [items, setItems] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [sortOrder, setSortOrder] = useState('az');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingPath, setUsingPath] = useState('');
  const [vaultRoot, setVaultRoot] = useState('');
  const [usingIndex, setUsingIndex] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [activeMeta, setActiveMeta] = useState({});
  const [activeIndexEntry, setActiveIndexEntry] = useState(null);
  const [metaNotice, setMetaNotice] = useState('');
  const [metaDismissed, setMetaDismissed] = useState(false);
  const [locations, setLocations] = useState({});
  const [typeMap, setTypeMap] = useState({});
  const [portraitIndex, setPortraitIndex] = useState({});
  const [portraitUrls, setPortraitUrls] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [randName, setRandName] = useState(false);
  const [nameSuggesting, setNameSuggesting] = useState(false);
  const [selRegion, setSelRegion] = useState('');
  const [selPurpose, setSelPurpose] = useState('');
  const [customPurpose, setCustomPurpose] = useState('');
  const [createError, setCreateError] = useState('');
  const [regionOptions, setRegionOptions] = useState([]);
  const [establishmentName, setEstablishmentName] = useState('');
  const [establishmentRecord, setEstablishmentRecord] = useState('');
  const [establishments, setEstablishments] = useState([]);
  const [establishmentsLoading, setEstablishmentsLoading] = useState(false);
  const [establishmentsError, setEstablishmentsError] = useState('');
  const [establishmentsLoaded, setEstablishmentsLoaded] = useState(false);
  const [copyToast, setCopyToast] = useState('');
  const copyToastTimerRef = useRef(null);
  const showCopyToast = useCallback((message) => {
    setCopyToast(message);
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current);
    }
    copyToastTimerRef.current = setTimeout(() => {
      setCopyToast('');
      copyToastTimerRef.current = null;
    }, 2000);
  }, []);

  const [voiceProvider, setVoiceProvider] = useState('piper');
  const [voiceValue, setVoiceValue] = useState('');
  const [voiceOptions, setVoiceOptions] = useState({ piper: [], elevenlabs: [] });
  const [voiceLoading, setVoiceLoading] = useState({ piper: false, elevenlabs: false });
  // Voice selection for the NPC details popup
  const [npcList, setNpcList] = useState([]);
  const [cardVoiceProvider, setCardVoiceProvider] = useState('piper');
  const [cardVoiceValue, setCardVoiceValue] = useState('');
  const [cardVoiceSaving, setCardVoiceSaving] = useState(false);
  const [cardVoiceStatus, setCardVoiceStatus] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [selectedTab, setSelectedTab] = useState('write');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [documentReady, setDocumentReady] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [backlinks, setBacklinks] = useState([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);

  const entityDraftRef = useRef({});
  const bodyRef = useRef('');
  const activePathRef = useRef('');
  const saveTimerRef = useRef(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const documentReadyRef = useRef(false);
  const isValidRef = useRef(true);
  const lastSerializedRef = useRef('');

  const markdownConverter = useMemo(
    () => new Showdown.Converter({
      tables: true,
      simplifiedAutoLink: true,
      strikethrough: true,
      tasklists: true,
    }),
    [],
  );

  const {
    control,
    register,
    reset,
    watch,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(NPC_FORM_SCHEMA),
    defaultValues: NPC_FORM_DEFAULTS,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    documentReadyRef.current = documentReady;
  }, [documentReady]);

  useEffect(() => {
    isValidRef.current = isValid;
    if (isValid && /^resolve validation errors/i.test(String(saveError || ''))) {
      setSaveError('');
    }
  }, [isValid, saveError]);

  const runSave = useCallback(async () => {
    if (!documentReadyRef.current) return;
    if (!activePathRef.current) return;
    if (!dirtyRef.current && lastSerializedRef.current) return;
    if (!isValidRef.current) {
      if (dirtyRef.current) {
        setSaveError('Resolve validation errors to save changes.');
      }
      return;
    }
    if (savingRef.current) return;

    const draftMeta = entityDraftRef.current || {};
    const serialized = matter.stringify(bodyRef.current || '', draftMeta);
    if (!dirtyRef.current && serialized === lastSerializedRef.current) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      await writeTextFile(activePathRef.current, serialized);
      lastSerializedRef.current = serialized;
      dirtyRef.current = false;
      setLastSavedAt(Date.now());
      setHasPendingChanges(false);
    } catch (err) {
      console.error('Failed to save NPC file', err);
      setSaveError(err?.message || 'Failed to save NPC file.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, []);

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (!documentReadyRef.current || !activePathRef.current) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const delay = immediate ? 0 : 2500;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        runSave();
      }, delay);
    },
    [runSave],
  );

  const flushPendingChanges = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await runSave();
  }, [runSave]);

  const handleBodyChange = useCallback(
    (value) => {
      setBodyValue(value);
      bodyRef.current = value;
      if (!documentReadyRef.current) return;
      dirtyRef.current = true;
      setHasPendingChanges(true);
      scheduleSave(false);
    },
    [scheduleSave],
  );

  useEffect(() => {
    const subscription = watch((value) => {
      if (!documentReadyRef.current) return;
      const normalized = sanitizeFormValues(value || {});
      const keysToSync = [
        'id',
        'name',
        'region',
        'location',
        'faction',
        'role',
        'importance',
        'tags',
        'keywords',
        'canonical_summary',
        'relationship_ledger',
      ];
      const draft = { ...entityDraftRef.current };
      keysToSync.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(normalized, key)) {
          draft[key] = normalized[key];
        } else if (
          [
            'region',
            'location',
            'faction',
            'role',
            'importance',
            'tags',
            'keywords',
            'canonical_summary',
            'relationship_ledger',
          ].includes(key)
        ) {
          delete draft[key];
        }
      });
      entityDraftRef.current = draft;
      setActiveMeta((prev) => {
        const next = { ...(prev || {}) };
        keysToSync.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(normalized, key)) {
            next[key] = normalized[key];
          } else if (
            [
              'region',
              'location',
              'faction',
              'role',
              'importance',
              'tags',
              'keywords',
              'canonical_summary',
              'relationship_ledger',
            ].includes(key)
          ) {
            delete next[key];
          }
        });
        return next;
      });
      dirtyRef.current = true;
      setHasPendingChanges(true);
      scheduleSave(false);
    });
    return () => subscription.unsubscribe();
  }, [watch, scheduleSave]);

  useEffect(() => {
    const handleBlur = () => {
      flushPendingChanges();
    };
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        flushPendingChanges();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', handleBlur);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', handleBlur);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [flushPendingChanges]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      flushPendingChanges();
    },
    [flushPendingChanges],
  );
  const npcVersion = useVaultVersion(['20_dm/npc']);
  const regionVersion = useVaultVersion(['10_world/regions']);
  const portraitAssetsVersion = useVaultVersion(['30_assets/images']);
  useEffect(() => {
    let decoded = '';
    if (typeof routeIdParam === 'string' && routeIdParam) {
      try {
        decoded = decodeURIComponent(routeIdParam);
      } catch {
        decoded = routeIdParam;
      }
    }
    setActiveId((prev) => (prev === decoded ? prev : decoded));
  }, [routeIdParam]);

  useEffect(() => {
    setModalOpen(Boolean(activeId));
  }, [activeId]);
  useEffect(() => () => {
    if (copyToastTimerRef.current) {
      clearTimeout(copyToastTimerRef.current);
    }
  }, []);
const establishmentOptions = useMemo(() => {
    if (!Array.isArray(establishments) || establishments.length === 0) return [];
    return establishments.map((entry) => {
      const rawGroup = String(entry.group || '').split('/').map((part) => part.trim()).filter(Boolean);
      const region = entry.region || rawGroup[0] || '';
      const location = entry.location || rawGroup.slice(1).join(' · ');
      const title = entry.title || entry.name || entry.path || '';
      const parts = [];
      if (region) parts.push(region);
      if (location) parts.push(location);
      if (title) parts.push(title);
      const label = parts.filter(Boolean).join(' · ') || title || entry.path || '';
      return {
        value: entry.path || '',
        label,
        title,
        group: entry.group || '',
      };
    }).filter((entry) => entry.value);
  }, [establishments]);

  const selectedEstablishment = useMemo(
    () => establishmentOptions.find((entry) => entry.value === establishmentRecord) || null,
    [establishmentOptions, establishmentRecord],
  );

  const parseNpcFrontmatter = useCallback((src) => {
    const text = typeof src === 'string' ? src : '';
    const trimmed = text.trim();
    if (!trimmed || /^failed to load file/i.test(trimmed)) {
      return [{}, text, ''];
    }
    const hasOpening = /^---/.test(trimmed);
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!match) {
      const message = hasOpening
        ? 'The NPC metadata block could not be parsed. Chips may be incomplete.'
        : 'No NPC metadata frontmatter was found. Chips may be incomplete.';
      return [{}, text, message];
    }
    const lines = match[1].split(/\r?\n/);
    const meta = {};
    const stray = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const mm = rawLine.match(/^\s*([A-Za-z0-9_][A-Za-z0-9_ \-]*)\s*:\s*(.*)$/);
      if (mm) {
        const key = mm[1].trim().toLowerCase().replace(/\s+/g, '_');
        const rawVal = mm[2].trim();
        const value = rawVal.replace(/^['"]|['"]$/g, '').trim();
        if (value) meta[key] = value;
      } else {
        stray.push(line);
      }
    }
    const body = (match[2] || '').replace(/^\s*[\r\n]+/, '');
    let issue = '';
    if (Object.keys(meta).length === 0) {
      issue = 'The NPC metadata block was empty. Chips may be incomplete.';
    } else if (stray.length) {
      issue = 'Some NPC metadata entries could not be parsed. Chips may be incomplete.';
    }
    return [meta, body, issue];
  }, []);

  const crawl = useCallback(async (root) => {
    const out = [];
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const dir = stack.pop();
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      try {
        const entries = await listDir(dir);
        for (const e of entries) {
          if (e.is_dir) {
            stack.push(e.path);
          } else {
            // Only include Markdown-like files
            const isMd = /\.(md|mdx|markdown)$/i.test(e.name || '');
            if (!isMd) continue;
            out.push({
              path: e.path,
              name: e.name,
              title: titleFromName(e.name),
              modified_ms: e.modified_ms,
            });
          }
        }
      } catch (e) {
        // ignore directories that fail to read
      }
    }
    // basic sort by name
    out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    return out;
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    setLocations({});
    setTypeMap({});
    setPortraitUrls({});
    resetVaultIndexCache();
    try {
      try {
      const { root, entries } = await listEntitiesByType('npc', { force: true });
      const normalizedRoot = typeof root === 'string' ? root : '';
      setVaultRoot(normalizedRoot);
      if (normalizedRoot) {
        setUsingPath(resolveVaultPath(normalizedRoot, '20_dm/npc'));
      }
      const locMap = {};
      const typeMapNext = {};
      const normalizedItems = entries.map((entry) => {
        const safeId = String(entry.id || '').trim();
        const indexMeta = entry.index || {};
        const metadata = indexMeta.metadata || {};
        const fields = indexMeta.fields || {};
        const location = firstChip(indexMeta.location, metadata.location, fields.location, indexMeta.region, metadata.region, fields.region);
        if (safeId && location) {
          locMap[safeId] = location;
        }
        const typeValue = firstChip(
          metadata.purpose,
          metadata.occupation,
          metadata.role,
          metadata.job,
          metadata.profession,
          metadata.type,
          fields.purpose,
          fields.occupation,
          fields.role,
          fields.job,
          fields.profession,
          fields.type,
        );
        if (safeId && typeValue) {
          typeMapNext[safeId] = typeValue;
        }
        return {
          id: safeId,
          name: entry.name || metadata.name || '',
          title: entry.title || entry.name || metadata.name || '',
          path: entry.path,
          relPath: entry.relPath,
          modified_ms: entry.modified_ms,
          index: indexMeta,
        };
      });
        setItems(normalizedItems);
        setLocations(locMap);
        setTypeMap(typeMapNext);
        setUsingIndex(true);
        return;
      } catch (err) {
        console.warn('Failed to load NPC index, falling back to directory scan', err);
      }

      const loadFromScan = async (basePath) => {
      if (!basePath) return false;
      try {
        const list = await crawl(basePath);
        const locMap = {};
        const typeMapNext = {};
        const normalizedItems = [];
        for (const entry of Array.isArray(list) ? list : []) {
          let meta = {};
          let id = '';
          try {
            const text = await readInbox(entry.path);
            const [parsedMeta] = parseNpcFrontmatter(text);
            meta = parsedMeta || {};
            id = String(meta.id || meta.Id || '').trim();
          } catch {
            meta = {};
            id = '';
          }
          if (!id) {
            id = entry.path ? `path:${entry.path}` : `npc:${entry.name || entry.title || Math.random().toString(36).slice(2)}`;
          }
          const location = firstChip(meta.location, meta.region) || relLocation(basePath, entry.path);
          if (id && location) {
            locMap[id] = location;
          }
          const typeValue = firstChip(
            meta.purpose,
            meta.occupation,
            meta.role,
            meta.job,
            meta.profession,
            meta.type,
          );
          if (id && typeValue) {
            typeMapNext[id] = typeValue;
          }
          normalizedItems.push({
            ...entry,
            id,
            relPath: entry.path,
            index: { metadata: meta },
          });
        }
        setUsingIndex(false);
        setVaultRoot('');
        setUsingPath(basePath);
        setItems(normalizedItems);
        setLocations(locMap);
        setTypeMap(typeMapNext);
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    };

      try {
      const vault = await getDreadhavenRoot();
      const base = (typeof vault === 'string' && vault.trim()) ? resolveVaultPath(vault.trim(), '20_dm/npc') : '';
      if (await loadFromScan(base)) {
        return;
      }
      } catch (err) {
      // ignore
    }

    if (await loadFromScan(DEFAULT_NPC)) {
      return;
    }

    setError('Failed to locate NPC directory.');
    setItems([]);
    } finally {
      setLoading(false);
    }
  }, [crawl, parseNpcFrontmatter]);

  useEffect(() => { fetchItems(); }, [fetchItems, npcVersion]);

  // Build region options by crawling directories under Regions (exclude Establishments)
  useEffect(() => {
    (async () => {
      try {
        const vault = await getDreadhavenRoot();
        const base = (typeof vault === 'string' && vault.trim())
          ? `${vault.trim()}\\\\10_World\\\\Regions`.replace(/\\\\/g, '\\\\')
          : 'D:\\Documents\\DreadHaven\\10_World\\Regions';
        const stack = [base];
        const seen = new Set();
        const dirs = new Set();
        while (stack.length) {
          const dir = stack.pop();
          if (!dir || seen.has(dir)) continue;
          seen.add(dir);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (e.is_dir) {
              if ((e.name || '').toLowerCase() === 'establishments') continue;
              stack.push(e.path);
              const rel = relLocation(base, `${e.path}/dummy`);
              if (rel) dirs.add(rel);
            }
          }
        }
        const arr = Array.from(dirs).sort((a,b)=>a.localeCompare(b));
        setRegionOptions(['', ...arr]);
      } catch {
        setRegionOptions(['']);
      }
    })();
  }, [regionVersion]);

  // Load establishments scoped to the selected region (faster, clearer)
  useEffect(() => {
    if (!showCreate) return;
    // Only load when creating a Shopkeeper
    if (selPurpose !== 'Shopkeeper') return;
    let cancelled = false;
    setEstablishmentsLoading(true);
    setEstablishmentsError('');
    (async () => {
      try {
        // Determine Regions root
        const vault = await getDreadhavenRoot();
        const regionsRoot = (typeof vault === 'string' && vault.trim())
          ? `${vault.trim()}\\10_World\\Regions`
          : 'D:\\Documents\\DreadHaven\\10_World\\Regions';
        // Resolve region path
        const regionPath = selRegion
          ? `${regionsRoot}\\${selRegion.replace(/\\/g,'/').replace(/\/+/, '').replace(/\//g,'\\')}`
          : regionsRoot;
        const estPath = `${regionPath}\\Establishments`;
        setEstablishmentsRoot(estPath);

        // Crawl Establishments folder recursively for markdown files
        const stack = [estPath];
        const seen = new Set();
        const acc = [];
        while (stack.length) {
          const dir = stack.pop();
          if (!dir) continue;
          const key = dir.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (!e) continue;
            if (e.is_dir) { stack.push(e.path); continue; }
            if (!/\.(md|mdx|markdown)$/i.test(e.name || '')) continue;
            const title = String(e.name || '').replace(/\.[^.]+$/, '');
            acc.push({ path: e.path, title, name: e.name, group: selRegion || '', region: selRegion || '', location: '' });
          }
        }
        if (!cancelled) {
          // Sort by title
          acc.sort((a,b)=> String(a.title).localeCompare(String(b.title)));
          setEstablishments(acc);
          setEstablishmentsLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setEstablishments([]);
          setEstablishmentsError(err?.message || String(err));
        }
      } finally {
        if (!cancelled) setEstablishmentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showCreate, selPurpose, selRegion, regionVersion]);

  useEffect(() => {
    if (selPurpose !== 'Shopkeeper') {
      setEstablishmentName('');
      setEstablishmentRecord('');
    }
  }, [selPurpose]);

  useEffect(() => {
    if (!establishmentRecord) return;
    const match = establishments.find((entry) => entry.path === establishmentRecord);
    if (!match) return;
    const defaultName = match.title || match.name || '';
    if (!defaultName) return;
    setEstablishmentName((prev) => (prev ? prev : defaultName));
  }, [establishmentRecord, establishments]);

  // Build portrait index from Assets folder (optional)
  useEffect(() => {
    (async () => {
      try {
        const vault = await getDreadhavenRoot();
        const base = (typeof vault === 'string' && vault.trim())
          ? `${vault.trim()}\\\\30_Assets\\\\Images\\\\NPC_Portraits`.replace(/\\\\/g, '\\\\')
          : DEFAULT_PORTRAITS;

        // Recursively crawl portrait folders (images may be nested)
        const stack = [base];
        const idx = {};
        const seen = new Set();
        const normalize = (s) => String(s || '')
          .replace(/\.[^.]+$/, '')
          .replace(/^portrait[_\-\s]+/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        while (stack.length) {
          const dir = stack.pop();
          if (!dir || seen.has(dir)) continue;
          seen.add(dir);
          let entries = [];
          try { entries = await listDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (e.is_dir) {
              stack.push(e.path);
            } else if (IMG_RE.test(e.name)) {
              const key = normalize(e.name);
              if (key && !idx[key]) idx[key] = e.path;
            }
          }
        }
        setPortraitIndex(idx);
      } catch (e) {
        setPortraitIndex({});
      }
    })();
  }, [portraitAssetsVersion]);

  // Load portraits on demand
  useEffect(() => {
    let cancelled = false;
    const normalize = (s) => String(s || '')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    (async () => {
      for (const it of items) {
        if (!it || !it.id) continue;
        if (portraitUrls[it.id]) continue;
        const key = normalize((it.title || it.name || ''));
        const imgPath = portraitIndex[key];
        if (!imgPath) continue;
        try {
          const bytes = await readFileBytes(imgPath);
          if (cancelled) return;
          const ext = imgPath.split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png'
            : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : ext === 'bmp' ? 'image/bmp'
            : ext === 'svg' ? 'image/svg+xml'
            : 'application/octet-stream';
          const blob = new Blob([new Uint8Array(bytes)], { type: mime });
          const url = URL.createObjectURL(blob);
          if (!cancelled) {
            setPortraitUrls((prev) => ({ ...prev, [it.id]: url }));
          }
        } catch (e) {/* ignore */}
      }
    })();
    return () => { cancelled = true; };
  }, [items, portraitIndex]);

  // Extract optional location from frontmatter or KV; fallback to relative folder path
  useEffect(() => {
    if (usingIndex) {
      return () => {};
    }
    let cancelled = false;
    (async () => {
      for (const it of items) {
        if (!it || !it.id || !it.path) continue;
        if (locations[it.id] !== undefined && typeMap[it.id] !== undefined) continue;
        try {
          const text = await readInbox(it.path);
          if (cancelled) return;
          const src = String(text || '');
          const fm = src.match(/^---\n([\s\S]*?)\n---/);
          let loc = '';
          let typ = '';
          if (fm) {
            const body = fm[1];
            const line = body.split(/\r?\n/).find((l) => /^\s*location\s*:/i.test(l));
            if (line) loc = line.split(':').slice(1).join(':').trim();
            const tline = body.split(/\r?\n/).find((l) => /^(purpose|occupation|role|job|profession|type)\s*:/i.test(l));
            if (tline) typ = tline.split(':').slice(1).join(':').trim();
          }
          if (!loc) {
            const m = src.match(/\bLocation\s*:\s*([^\n\r]+)/i);
            if (m) loc = m[1].trim();
          }
          if (!typ) {
            const m2 = src.match(/\b(Purpose|Occupation|Role|Job|Profession|Type)\s*:\s*([^\n\r]+)/i);
            if (m2) typ = m2[2].trim();
          }
          if (!loc) {
            loc = relLocation(usingPath, it.path);
          }
          if (loc) {
            setLocations((prev) => ({ ...prev, [it.id]: sanitizeChip(loc) }));
          }
          if (typ) {
            setTypeMap((prev) => ({ ...prev, [it.id]: sanitizeChip(typ) }));
          }
        } catch {/* ignore */}
      }
    })();
    return () => { cancelled = true; };
  }, [items, usingPath, usingIndex]);

  const selected = useMemo(() => {
    if (activeId) {
      const match = items.find((i) => i.id === activeId);
      if (match) return match;
      if (activeIndexEntry) {
        const relPath = activeIndexEntry.path || activeIndexEntry.relPath || '';
        const absolute = vaultRoot ? resolveVaultPath(vaultRoot, relPath) : relPath;
        return {
          id: activeIndexEntry.id || activeId,
          name: activeIndexEntry.name || '',
          title: activeIndexEntry.name || '',
          path: absolute,
          relPath,
          modified_ms: typeof activeIndexEntry.mtime === 'number' ? Math.round(activeIndexEntry.mtime * 1000) : null,
          index: activeIndexEntry,
        };
      }
    }
    return null;
  }, [items, activeId, activeIndexEntry, vaultRoot]);

  const derivedTitle = useMemo(() => {
    const meta = activeMeta || {};
    if (meta.title) return sanitizeChip(meta.title);
    if (meta.name) return sanitizeChip(meta.name);
    const src = String(bodyValue || '');
    const h1 = src.match(/^\s*#\s+([^\r\n]+)$/m);
    if (h1 && h1[1]) return sanitizeChip(h1[1]);
    const nm = src.match(/\b(?:NPC\s+Name|Name)\s*:\s*([^\r\n]+)/i);
    if (nm && nm[1]) return sanitizeChip(nm[1]);
    return String(selected?.title || selected?.name || '');
  }, [activeMeta, bodyValue, selected]);
  const selectedId = typeof selected?.id === 'string' ? selected.id : '';
  const copyNpcId = useCallback(async () => {
    const id = selectedId.trim();
    if (!id) return;
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    try {
      if (clipboard?.writeText) {
        await clipboard.writeText(id);
        showCopyToast('NPC ID copied to clipboard.');
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch (err) {
      console.warn('Failed to copy NPC ID', err);
      showCopyToast(`NPC ID ready: ${id}`);
    }
  }, [selectedId, showCopyToast]);

  const typeOptions = useMemo(() => {
    const vals = Object.values(typeMap).map((v) => sanitizeChip(v)).filter(Boolean);
    return Array.from(new Set(vals)).sort((a,b)=>a.localeCompare(b));
  }, [typeMap]);

  const locationOptions = useMemo(() => {
    const vals = Object.values(locations).map((v) => sanitizeChip(v)).filter(Boolean);
    return Array.from(new Set(vals)).sort((a,b)=>a.localeCompare(b));
  }, [locations]);

  const visibleItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    let arr = items.filter((it) => {
      const title = String(it.title || it.name || '').toLowerCase();
      const loc = String(locations[it.id] || '').toLowerCase();
      const textHit = !q || title.includes(q) || loc.includes(q);
      if (!textHit) return false;
      if (filterType) {
        const t = String(typeMap[it.id] || '').toLowerCase();
        if (t !== filterType.toLowerCase()) return false;
      }
      if (filterLocation) {
        const l = String(loc || '').toLowerCase();
        if (l !== filterLocation.toLowerCase()) return false;
      }
      return true;
    });
    const out = arr.slice();
    if (sortOrder === 'recent') {
      out.sort((a, b) => Number(b.modified_ms || 0) - Number(a.modified_ms || 0));
    } else if (sortOrder === 'za') {
      out.sort((a, b) => String(b.title || b.name || '').localeCompare(String(a.title || a.name || '')));
    } else {
      out.sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
    }
    return out;
  }, [items, filterText, filterType, filterLocation, sortOrder, locations, typeMap]);

  // Back-compat alias to avoid any lingering references during hot reloads
  const filteredItems = visibleItems;

  const metadataChips = useMemo(() => {
    const meta = activeMeta || {};
    const chips = [];
    const usedKeys = new Set();
    const seen = new Set();
    const plan = [
      { keys: ['aliases', 'alias'], split: /[,;|]/, prefix: '' },
      { keys: ['pronouns', 'pronoun'], prefix: 'Pronouns: ' },
      { keys: ['tags', 'tag', 'keywords', 'keyword'], split: /[,;|]/, prefix: '' },
      { keys: ['occupation', 'occupations', 'job', 'jobs', 'role', 'roles', 'profession', 'professions', 'position'], split: /[,;|]/, prefix: '' },
      { keys: ['faction', 'factions', 'affiliation', 'affiliations', 'organization', 'organizations', 'group', 'groups', 'clan', 'guild'], split: /[,;|]/, prefix: '' },
      { keys: ['race', 'ancestry', 'species', 'heritage', 'lineage'], prefix: '' },
      { keys: ['demeanor', 'attitude', 'mood', 'vibe'], prefix: '' },
      { keys: ['quirks', 'quirk', 'traits', 'trait'], split: /[,;|]/, prefix: '' },
      { keys: ['status'], prefix: 'Status: ' },
      { keys: ['rank'], prefix: 'Rank: ' },
      { keys: ['age'], prefix: 'Age: ' },
      { keys: ['gender'], prefix: 'Gender: ' },
    ];
    const ignore = new Set(['title', 'name', 'location', 'summary', 'description', 'notes', 'body', 'portrait', 'image', 'img', 'thumbnail']);
    const formatKey = (key) => key
      .split('_')
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
      .join(' ')
      .trim();
    const addValues = (rawValue, key, { prefix, split }) => {
      if (rawValue === undefined || rawValue === null) return;
      const str = String(rawValue);
      if (!str.trim()) return;
      const parts = split ? str.split(split) : [str];
      let added = false;
      for (const part of parts) {
        const clean = sanitizeChip(part);
        if (!clean) continue;
        const label = prefix === undefined
          ? `${formatKey(key)}: ${clean}`
          : prefix === '' ? clean : `${prefix}${clean}`;
        const dedupeKey = `${key}:${label.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        chips.push({ id: dedupeKey, label });
        added = true;
      }
      if (added) usedKeys.add(key);
    };

    plan.forEach((entry) => {
      entry.keys.forEach((key) => {
        if (meta[key] === undefined) return;
        addValues(meta[key], key, entry);
      });
    });

    Object.entries(meta).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (usedKeys.has(key)) return;
      if (ignore.has(key)) return;
      const clean = sanitizeChip(value);
      if (!clean) return;
      const label = `${formatKey(key)}: ${clean}`;
      const dedupeKey = `${key}:${label.toLowerCase()}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      chips.push({ id: dedupeKey, label });
    });

    return chips;
  }, [activeMeta]);

  const locationLabel = useMemo(() => {
    if (!selected) return '';
    const metaLoc = sanitizeChip(activeMeta.location);
    if (metaLoc) return metaLoc;
    return locations[selected.id] || relLocation(usingPath, selected.path) || '';
  }, [selected, activeMeta.location, locations, usingPath]);

  const formattedLastSaved = useMemo(() => {
    if (!lastSavedAt) return '';
    try {
      return new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return '';
    }
  }, [lastSavedAt]);

  const metadataFormDisabled = !documentReady;

  useEffect(() => {
    let cancelled = false;
    flushPendingChanges();
    if (!activeId) {
      activePathRef.current = '';
      entityDraftRef.current = {};
      lastSerializedRef.current = '';
      setLastSavedAt(null);
      setActiveMeta({});
      setActiveIndexEntry(null);
      setMetaNotice('');
      setMetaDismissed(false);
      setSaveError('');
      setBodyValue('');
      bodyRef.current = '';
      reset(NPC_FORM_DEFAULTS);
      setDocumentReady(false);
      documentReadyRef.current = false;
      dirtyRef.current = false;
      setHasPendingChanges(false);
      setBacklinks([]);
      setBacklinksLoading(false);
      return () => { cancelled = true; };
    }

    setMetaNotice('');
    setMetaDismissed(false);
    setSaveError('');
    setLastSavedAt(null);
    setDocumentReady(false);
    documentReadyRef.current = false;
    dirtyRef.current = false;
    setActiveIndexEntry(null);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setBacklinks([]);
    setBacklinksLoading(true);

    (async () => {
      let indexEntry = null;
      let entityPath = selected?.path || '';
      if (usingIndex) {
        try {
          indexEntry = await getIndexEntityById(activeId, { force: false });
        } catch (err) {
          console.warn('Failed to hydrate NPC from index', err);
        }
        if (indexEntry && !cancelled) {
          setActiveIndexEntry(indexEntry);
          const relPath = indexEntry.path || indexEntry.relPath || '';
          if (vaultRoot) {
            entityPath = resolveVaultPath(vaultRoot, relPath);
          } else if (relPath) {
            entityPath = relPath;
          }
        }
      }

      const fallbackPath = entityPath || selected?.path;
      if (!fallbackPath) {
        if (!cancelled) {
          setActiveMeta({});
          entityDraftRef.current = {};
          setBodyValue('');
          bodyRef.current = '';
          reset(NPC_FORM_DEFAULTS);
          setMetaNotice('NPC file not found.');
          lastSerializedRef.current = '';
          setHasPendingChanges(false);
          activePathRef.current = '';
          dirtyRef.current = false;
          setBacklinks([]);
          setBacklinksLoading(false);
        }
        return;
      }

      const applyLoadedEntity = (entity, body, entryMeta, backlinksList = []) => {
        const normalizedEntity = normalizeEntityMeta(entity || {}, selected || {});
        const formValues = extractFormValues(normalizedEntity);
        const sanitizedForm = sanitizeFormValues(formValues);
        const draft = { ...normalizedEntity };
        const keysToSync = [
          'id',
          'name',
          'region',
          'location',
          'faction',
          'role',
          'importance',
          'tags',
          'keywords',
          'canonical_summary',
          'relationship_ledger',
        ];
        keysToSync.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(sanitizedForm, key)) {
            draft[key] = sanitizedForm[key];
          } else if (
            [
              'region',
              'location',
              'faction',
              'role',
              'importance',
              'tags',
              'keywords',
              'canonical_summary',
              'relationship_ledger',
            ].includes(key)
          ) {
            delete draft[key];
          }
        });
        entityDraftRef.current = draft;
        const combinedMeta = {
          ...((entryMeta && entryMeta.metadata) || {}),
          ...((entryMeta && entryMeta.fields) || {}),
          ...normalizedEntity,
        };
        setActiveMeta(combinedMeta);
        reset({ ...NPC_FORM_DEFAULTS, ...formValues });
        setBodyValue(body || '');
        bodyRef.current = body || '';
        const serialized = matter.stringify(bodyRef.current || '', entityDraftRef.current || {});
        lastSerializedRef.current = serialized;
        dirtyRef.current = false;
        setMetaNotice('');
        setDocumentReady(true);
        documentReadyRef.current = true;
        setHasPendingChanges(false);
        setBacklinks(Array.isArray(backlinksList) ? backlinksList : []);
        setBacklinksLoading(false);
      };

      try {
        const result = await loadEntity(fallbackPath);
        if (cancelled) return;
        activePathRef.current = result?.path || fallbackPath;
        applyLoadedEntity(
          result?.entity || {},
          result?.body || '',
          indexEntry || selected?.index || {},
          Array.isArray(result?.backlinks) ? result.backlinks : [],
        );
      } catch (err) {
        if (cancelled) return;
        try {
          const text = await readInbox(fallbackPath);
          if (cancelled) return;
          const [meta, body, issue] = parseNpcFrontmatter(text || '');
          activePathRef.current = fallbackPath;
          applyLoadedEntity(meta || {}, body || '', indexEntry || selected?.index || {}, []);
          if (issue || err?.message) {
            setMetaNotice(issue || err?.message || '');
          }
        } catch (innerErr) {
          if (cancelled) return;
          setActiveMeta({});
          entityDraftRef.current = {};
          setBodyValue('');
          bodyRef.current = '';
          reset(NPC_FORM_DEFAULTS);
          lastSerializedRef.current = '';
          dirtyRef.current = false;
          setHasPendingChanges(false);
          setDocumentReady(false);
          documentReadyRef.current = false;
          setMetaNotice(innerErr?.message || err?.message || 'Failed to load NPC file.');
          setBacklinks([]);
          setBacklinksLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, usingIndex, selected, vaultRoot, parseNpcFrontmatter, flushPendingChanges, reset]);

  useEffect(() => {
    if (!metaNotice) {
      setMetaDismissed(false);
    }
  }, [metaNotice]);

  // Load NPCs for existing voice mappings
  useEffect(() => {
    (async () => {
      try {
        const list = await listNpcs();
        setNpcList(Array.isArray(list) ? list : []);
      } catch {
        setNpcList([]);
      }
    })();
  }, []);

  // Helper: decode provider from stored voice string
  const decodeVoiceValue = useCallback((value) => {
    if (typeof value !== 'string') return { provider: 'piper', voice: '' };
    const trimmed = value.trim();
    if (!trimmed) return { provider: 'piper', voice: '' };
    const m = trimmed.match(/^(elevenlabs|piper):(.+)$/i);
    if (m) return { provider: m[1].toLowerCase(), voice: m[2].trim() };
    return { provider: 'piper', voice: trimmed };
  }, []);

  // When selecting an NPC, prefill its voice selection
  useEffect(() => {
    if (!selected) {
      setCardVoiceProvider('piper');
      setCardVoiceValue('');
      setCardVoiceStatus('');
      return;
    }
    const baseName = titleFromName(selected?.name || selected?.title || '');
    const record = npcList.find((n) => (n?.name || '').toLowerCase() === (baseName || '').toLowerCase());
    const decoded = decodeVoiceValue(record?.voice || activeMeta?.voice || '');
    setCardVoiceProvider(decoded.provider || 'piper');
    setCardVoiceValue(decoded.voice || '');
    setCardVoiceStatus('');
    // Heuristic: if value is unprefixed and matches a saved ElevenLabs profile name, switch provider
    (async () => {
      const val = (decoded.voice || '').trim();
      if (!val) return;
      const [piperOpts, elevenOpts] = await Promise.all([
        ensureVoiceOptions('piper'),
        ensureVoiceOptions('elevenlabs'),
      ]);
      const inPiper = piperOpts.some((o) => o.value === val);
      const inEleven = elevenOpts.some((o) => o.value === val);
      if (!inPiper && inEleven) {
        setCardVoiceProvider('elevenlabs');
      }
    })();
  }, [selected, npcList, activeMeta?.voice, decodeVoiceValue]);

  const ensureVoiceOptions = useCallback(async (provider) => {
    if (provider === 'piper') {
      if (voiceOptions.piper.length > 0) return voiceOptions.piper;
      setVoiceLoading((prev) => ({ ...prev, piper: true }));
      try {
        const list = await listPiperVoices();
        const options = Array.isArray(list)
          ? list.map((voice) => ({ value: voice.id, label: voice.label || voice.id }))
          : [];
        setVoiceOptions((prev) => ({ ...prev, piper: options }));
        return options;
      } finally {
        setVoiceLoading((prev) => ({ ...prev, piper: false }));
      }
    } else if (provider === 'elevenlabs') {
      if (voiceOptions.elevenlabs.length > 0) return voiceOptions.elevenlabs;
      setVoiceLoading((prev) => ({ ...prev, elevenlabs: true }));
      try {
        const list = await invoke('list_piper_profiles');
        const items = Array.isArray(list) ? list : [];
        const options = items
          .map((it) => ({ value: it?.name || '', label: it?.voice_id ? `${it.name} (${it.voice_id})` : (it?.name || '') }))
          .filter((o) => o.value);
        setVoiceOptions((prev) => ({ ...prev, elevenlabs: options }));
        return options;
      } finally {
        setVoiceLoading((prev) => ({ ...prev, elevenlabs: false }));
      }
    }
    return [];
  }, [voiceOptions.elevenlabs.length, voiceOptions.piper.length]);

  const persistCardVoice = useCallback(async (provider, value) => {
    if (!selected) return;
    const npcName = titleFromName(selected?.name || selected?.title || '');
    let voice = String(value || '').trim();
    setCardVoiceSaving(true);
    setCardVoiceStatus('');
    try {
      const existing = npcList.find(
        (n) => (n?.name || '').toLowerCase() === npcName.toLowerCase(),
      );
      const idPool = npcList
        .map((n) => (typeof n?.id === 'string' && n.id ? n.id : null))
        .filter((id) => typeof id === 'string');
      const existingIds = new Set(idPool);
      let npcId = existing?.id;
      if (!npcId) {
        npcId = makeId('npc', npcName, existingIds);
      }
      const payload = {
        id: npcId,
        name: npcName,
        description: existing?.description || '',
        prompt: existing?.prompt || '',
        voice,
      };
      await saveNpc(payload);
      setCardVoiceStatus(voice ? 'Saved' : 'Cleared');
      // reflect in local cache
      setNpcList((prev) => {
        const next = [...prev];
        const idx = next.findIndex((n) => n.id === npcId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], voice };
        } else {
          next.push(payload);
        }
        return next;
      });
      setTimeout(() => setCardVoiceStatus(''), 1500);
    } catch (err) {
      setCardVoiceStatus(err?.message || 'Failed to save');
    } finally {
      setCardVoiceSaving(false);
    }
  }, [npcList, selected]);

  return (
    <div>
      <BackButton />
      <h1>Dungeons & Dragons · NPCs</h1>
      <div className="pantheon-controls">
      <div className="inbox-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search NPCs or location..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{ width: '280px' }}
        />
        <label>
          Sort
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="az">A - Z</option>
            <option value="za">Z - A</option>
            <option value="recent">Recents</option>
          </select>
        </label>
        <label>
          Type
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">(all types)</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
            <option value="">(all locations)</option>
            {locationOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
        <button type="button" onClick={fetchItems} disabled={loading}>
          {loading ? 'Loading.' : 'Refresh'}
        </button>
        <button type="button" onClick={() => { if (!creating) { setShowCreate(true); setNewName(''); setCreateError(''); } }} disabled={creating}>
          Add NPC
        </button>
        {usingPath && <span className="muted">Folder: {usingPath}</span>}
        {error && <span className="error">{error}</span>}
      </div>

      <section className="pantheon-grid">
        {visibleItems.map((item) => (
          <button
            key={item.id || item.path}
            className="pantheon-card"
            onClick={() => {
              if (!item.id) return;
              setActiveId(item.id);
              setModalOpen(true);
              const encoded = encodeURIComponent(item.id);
              navigate(`/dnd/npc/${encoded}`);
              setMetaDismissed(false);
              setMetaNotice('');
            }}
            title={item.path}
          >
            {portraitUrls[item.id] ? (
              <img src={portraitUrls[item.id]} alt={item.title || item.name} className="monster-portrait" />
            ) : (
              <div className="monster-portrait placeholder">?</div>
            )}
            <div className="pantheon-card-title">{item.title || item.name}</div>
            <div className="pantheon-card-meta">Location: {locations[item.id] || relLocation(usingPath, item.path) || '-'}</div>
          </button>
        ))}
        {!loading && visibleItems.length === 0 && (
          <div className="muted">No NPC files found.</div>
        )}
      </section>

      {modalOpen && (
        <div className="lightbox" onClick={() => { setModalOpen(false); setActiveId(''); navigate('/dnd/npc'); }}>
          <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
            {selected ? (
              <>
                <header className="inbox-reader-header npc-header">
                  {portraitUrls[selected.id] ? (
                    <img
                      src={portraitUrls[selected.id]}
                      alt={selected.title || selected.name}
                      className="npc-portrait"
                    />
                  ) : (
                    <div className="npc-portrait placeholder">?</div>
                  )}
                  <div className="npc-header-main">
                    {copyToast && (
                      <div className="npc-copy-toast" role="status">{copyToast}</div>
                    )}
                    <h2 className="npc-name">{derivedTitle}</h2>
                    <div className="npc-header-subline">
                      <div className="npc-header-info">
                        <span>{selected.name}</span>
                        {locationLabel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{locationLabel}</span>
                          </>
                        )}
                      </div>
                      <div className="npc-header-actions">
                        {selectedId && (
                          <button
                            type="button"
                            className="npc-id-chip"
                            onClick={copyNpcId}
                            title="Copy NPC ID"
                          >
                            ID: {selectedId}
                          </button>
                        )}
                        <button type="button" className="danger" onClick={async () => { if (!selected?.path) return; const ok = confirm(`Delete NPC file?\n\n${selected.path}`); if (!ok) return; try { await deleteInbox(selected.path); setModalOpen(false); setActiveId(''); navigate('/dnd/npc'); await fetchItems(); } catch (err) { alert(err?.message || String(err)); } }}>Delete</button>
                      </div>
                    </div>
                    {metadataChips.length > 0 && (
                      <div className="npc-chips">
                        {metadataChips.map((chip) => (
                          <span key={chip.id} className="chip">{chip.label}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </header>
                <section className="npc-voice-config" style={{ marginTop: '0.5rem' }}>
                  <fieldset className="npc-voice-selector" style={{ display: 'grid', gap: '0.5rem' }}>
                    <legend>Voice</legend>
                    <label>
                      Provider
                      <select
                        value={cardVoiceProvider}
                        onChange={async (e) => {
                          const provider = e.target.value;
                          setCardVoiceProvider(provider);
                          // load options and reset voice if current not in new set
                          const options = await ensureVoiceOptions(provider);
                          setCardVoiceValue((prev) => (options.some((o) => o.value === prev) ? prev : ''));
                        }}
                        disabled={cardVoiceSaving}
                      >
                        <option value="piper">Piper (local)</option>
                        <option value="elevenlabs">ElevenLabs</option>
                      </select>
                    </label>
                    <label>
                      Voice
                      <select
                        value={cardVoiceValue}
                        onChange={async (e) => {
                          const value = e.target.value;
                          setCardVoiceValue(value);
                          await persistCardVoice(cardVoiceProvider, value);
                        }}
                        onFocus={() => ensureVoiceOptions(cardVoiceProvider)}
                        disabled={cardVoiceSaving || (cardVoiceProvider === 'piper' ? voiceLoading.piper : voiceLoading.elevenlabs)}
                      >
                        <option value="">(none)</option>
                        {(cardVoiceProvider === 'piper' ? voiceOptions.piper : voiceOptions.elevenlabs).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {cardVoiceStatus && (
                        <span className={/failed|error/i.test(cardVoiceStatus) ? 'error' : 'muted'} style={{ marginLeft: '0.5rem' }}>
                          {cardVoiceStatus}
                        </span>
                      )}
                    </label>
                  </fieldset>
                </section>
                {metaNotice && !metaDismissed && (
                  <div className="npc-banner">
                    <span>{metaNotice}</span>
                    <button type="button" onClick={() => setMetaDismissed(true)}>Dismiss</button>
                  </div>
                )}
                <section className="npc-editor">
                  <form
                    className="npc-metadata-form"
                    onSubmit={handleSubmit(async () => {
                      await flushPendingChanges();
                    })}
                  >
                    <div className="npc-form-grid">
                      <label className="npc-form-field">
                        <span>NPC ID</span>
                        <input type="text" {...register('id')} readOnly />
                      </label>
                      <label className="npc-form-field">
                        <span>Name</span>
                        <input type="text" {...register('name')} disabled={metadataFormDisabled} autoComplete="off" />
                        {errors.name && <span className="error">{errors.name.message}</span>}
                      </label>
                      <label className="npc-form-field">
                        <span>Region</span>
                        <input type="text" {...register('region')} disabled={metadataFormDisabled} autoComplete="off" />
                      </label>
                      <label className="npc-form-field">
                        <span>Location</span>
                        <input type="text" {...register('location')} disabled={metadataFormDisabled} autoComplete="off" />
                      </label>
                      <label className="npc-form-field">
                        <span>Faction</span>
                        <input type="text" {...register('faction')} disabled={metadataFormDisabled} autoComplete="off" />
                      </label>
                      <label className="npc-form-field">
                        <span>Role</span>
                        <input type="text" {...register('role')} disabled={metadataFormDisabled} autoComplete="off" />
                      </label>
                      <Controller
                        name="importance"
                        control={control}
                        render={({ field }) => (
                          <label className="npc-form-field">
                            <span>Importance (1-5)</span>
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={field.value ?? ''}
                              onChange={(event) => {
                                const raw = event.target.value;
                                field.onChange(raw === '' ? undefined : Number(raw));
                              }}
                              onBlur={field.onBlur}
                              disabled={metadataFormDisabled}
                            />
                            {errors.importance && <span className="error">{errors.importance.message}</span>}
                          </label>
                        )}
                      />
                      <Controller
                        name="tags"
                        control={control}
                        render={({ field }) => (
                          <label className="npc-form-field">
                            <span>Tags</span>
                            <input
                              type="text"
                              value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                              onChange={(event) => field.onChange(coerceStringArray(event.target.value))}
                              onBlur={field.onBlur}
                              placeholder="Comma separated"
                              disabled={metadataFormDisabled}
                            />
                            <span className="npc-field-hint">Comma separated keywords used for filtering.</span>
                          </label>
                        )}
                      />
                      <Controller
                        name="keywords"
                        control={control}
                        render={({ field }) => (
                          <label className="npc-form-field">
                            <span>Story Keywords</span>
                            <input
                              type="text"
                              value={Array.isArray(field.value) ? field.value.join(', ') : ''}
                              onChange={(event) => field.onChange(coerceStringArray(event.target.value))}
                              onBlur={field.onBlur}
                              placeholder="Comma separated"
                              disabled={metadataFormDisabled}
                            />
                            <span className="npc-field-hint">Optional extra search metadata.</span>
                          </label>
                        )}
                      />
                      <label className="npc-form-field npc-form-field--full">
                        <span>Canonical Summary</span>
                        <textarea
                          rows={4}
                          {...register('canonical_summary')}
                          disabled={metadataFormDisabled}
                          placeholder="Single paragraph reference summary"
                        />
                      </label>
                    </div>
                    <Controller
                      name="relationship_ledger"
                      control={control}
                      render={({ field }) => (
                        <RelationshipLedgerEditor
                          value={field.value}
                          onChange={field.onChange}
                          disabled={metadataFormDisabled}
                        />
                      )}
                    />
                    <div className="npc-backlinks">
                      <div className="npc-backlinks-header">
                        <div className="npc-backlinks-title">Backlinks</div>
                        {backlinks.length > 0 && !backlinksLoading && (
                          <div className="npc-backlinks-count">{backlinks.length}</div>
                        )}
                      </div>
                      {backlinksLoading ? (
                        <div className="npc-backlinks-empty muted">Scanning vault index…</div>
                      ) : backlinks.length === 0 ? (
                        <div className="npc-backlinks-empty muted">No backlinks found.</div>
                      ) : (
                        <ul className="npc-backlinks-list">
                          {backlinks.map((link, index) => {
                            const key = link?.id ? `${link.id}-${link.type || 'entity'}-${index}` : `link-${index}`;
                            const displayName = link?.name || link?.title || link?.id || 'Unnamed entity';
                            const typeLabel = formatEntityTypeLabel(link?.type);
                            return (
                              <li key={key} className="npc-backlink-item">
                                <div className="npc-backlink-name">{displayName}</div>
                                <div className="npc-backlink-meta">
                                  <span>{typeLabel || 'Entity'}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="npc-backlink-id">{link?.id || 'unknown'}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="npc-save-row">
                      <div className="npc-save-status-text">
                        {saveError ? (
                          <span className="error">{saveError}</span>
                        ) : (
                          <span className="muted">
                            {!documentReady
                              ? 'Loading metadata…'
                              : isSaving
                                ? 'Saving…'
                                : hasPendingChanges
                                  ? 'Unsaved changes'
                                  : formattedLastSaved
                                    ? `Saved at ${formattedLastSaved}`
                                    : 'Awaiting changes'}
                          </span>
                        )}
                      </div>
                      <button type="submit" className="secondary" disabled={!documentReady || isSaving}>
                        Save now
                      </button>
                    </div>
                  </form>
                  <div className="npc-markdown-pane">
                    <ReactMde
                      value={bodyValue}
                      onChange={handleBodyChange}
                      selectedTab={selectedTab}
                      onTabChange={setSelectedTab}
                      generateMarkdownPreview={(markdown) => Promise.resolve(markdownConverter.makeHtml(markdown))}
                      minEditorHeight={360}
                      maxEditorHeight={Infinity}
                      className="npc-markdown-editor"
                    />
                  </div>
                </section>
              </>
            ) : (
              <div className="muted">Loading.</div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="lightbox" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="lightbox-panel monster-create-panel" onClick={(e) => e.stopPropagation()}>
            <h2>New NPC</h2>
            <form className="monster-create-form" onSubmit={async (e) => {
              e.preventDefault();
              if (creating) return;
              const name = newName.trim();
              if (!randName && !name) { setCreateError('Please enter a name or enable random.'); return; }
              const purpose = selPurpose === '__custom__' ? (customPurpose.trim()) : selPurpose;
              const estPath = selPurpose === 'Shopkeeper' ? establishmentRecord : '';
              const estDisplay = selPurpose === 'Shopkeeper' ? establishmentName.trim() : '';
              let createdNpcRecord = null;
              try {
                setCreating(true);
                setCreateError('');
                const resolvedName = randName ? (name || 'NPC') : name;
                const idPool = npcList
                  .map((n) => (typeof n?.id === 'string' && n.id ? n.id : null))
                  .filter((id) => typeof id === 'string');
                const existingIds = new Set(idPool);
                const npcId = makeId('npc', resolvedName || 'NPC', existingIds);
                const createdPath = await createNpc(
                  npcId,
                  randName ? '' : name,
                  selRegion || '',
                  purpose || '',
                  null,
                  false,
                  estPath || null,
                  estDisplay || null,
                );
                // Persist selected voice mapping for this NPC if provided
                try {
                  const fullPath = String(createdPath || '');
                  const base = fullPath.replace(/\\/g, '/');
                  const file = base.substring(base.lastIndexOf('/') + 1);
                  const npcName = titleFromName(file);
                  createdNpcRecord = { id: npcId, name: npcName, description: '', prompt: '', voice: '' };
                  let vv = String(voiceValue || '').trim();
                  if (vv) {
                    // Save ElevenLabs by profile name (managed in profiles list)
                    const payload = { ...createdNpcRecord, voice: vv };
                    await saveNpc(payload);
                    createdNpcRecord = payload;
                  }
                } catch (_) {}
                if (createdNpcRecord) {
                  setNpcList((prev) => {
                    const next = [...prev];
                    const idx = next.findIndex((n) => n.id === createdNpcRecord.id);
                    if (idx >= 0) {
                      next[idx] = { ...next[idx], ...createdNpcRecord };
                    } else {
                      next.push(createdNpcRecord);
                    }
                    return next;
                  });
                }
                setShowCreate(false);
                setNewName('');
                setRandName(false);
                setSelRegion('');
                setSelPurpose('');
                setCustomPurpose('');
                setEstablishmentName('');
                setEstablishmentRecord('');
                await fetchItems();
              } catch (err) {
                setCreateError(err?.message || String(err));
              } finally {
                setCreating(false);
              }
            }}>
              <label>
                Name
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); if (createError) setCreateError(''); }}
                  autoFocus
                  disabled={creating || nameSuggesting}
                  placeholder={nameSuggesting ? 'Generating name…' : ''}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={randName}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setRandName(checked);
                    if (checked) {
                      try {
                        setNameSuggesting(true);
                        setCreateError('');
                        const region = (selRegion || '').trim();
                        const purpose = (selPurpose === '__custom__' ? customPurpose : selPurpose || '').trim();
                        const prompt = `Suggest a single evocative NPC name for a fantasy setting.\nRequirements:\n- Region/Location: ${region || 'generic'}\n- Role/Purpose: ${purpose || 'NPC'}\n- Return ONLY the name, title case, without quotes or extra text.\n- 1–3 words max.`;
                        const system = 'You only output a name. No punctuation except spaces and hyphens. No prefixes/suffixes.';
                        const result = await invoke('generate_llm', { prompt, system });
                        let suggested = String(result || '').split(/\r?\n/)[0].trim();
                        suggested = suggested.replace(/^[-–•\s]+/, '').replace(/^["'“”]+|["'“”]+$/g, '');
                        if (!suggested) throw new Error('Empty name');
                        setNewName(suggested);
                        setRandName(false);
                      } catch (err) {
                        setCreateError(err?.message || 'Failed to generate a name');
                      } finally {
                        setNameSuggesting(false);
                      }
                    }
                  }}
                  disabled={creating || nameSuggesting}
                />
                Let Ollama pick the name
              </label>
              <label>
                Region/Location
                <select value={selRegion} onChange={(e) => setSelRegion(e.target.value)} disabled={creating}>
                  {regionOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt || '(root)'}</option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <select value={selPurpose} onChange={(e) => setSelPurpose(e.target.value)} disabled={creating}>
                  <option value="">(optional)</option>
                  {['Shopkeeper','Innkeeper','Guard','Noble','Priest','Blacksmith','Wizard','Thief','Soldier','Farmer','Mayor','Merchant','Guide','Bard','Captain','Healer','Alchemist','Sage','Craftsman','Hunter']
                    .map((p) => (<option key={p} value={p}>{p}</option>))}
                  <option value="__custom__">Custom…</option>
                </select>
              </label>
              <fieldset className="npc-voice-selector" style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                <legend>Voice (optional)</legend>
                <label>
                  Provider
                  <select
                    value={voiceProvider}
                    onChange={async (e) => {
                      const provider = e.target.value;
                      setVoiceProvider(provider);
                      setVoiceValue('');
                      if (provider === 'piper' && voiceOptions.piper.length === 0) {
                        setVoiceLoading((prev) => ({ ...prev, piper: true }));
                        try {
                          const list = await listPiperVoices();
                          const options = (list || []).map((v) => ({ value: v.id, label: v.label || v.id }));
                          setVoiceOptions((prev) => ({ ...prev, piper: options }));
                        } catch {}
                        setVoiceLoading((prev) => ({ ...prev, piper: false }));
                      } else if (provider === 'elevenlabs' && voiceOptions.elevenlabs.length === 0) {
                        setVoiceLoading((prev) => ({ ...prev, elevenlabs: true }));
                        try {
                          const list = await invoke('list_piper_profiles');
                          const items = Array.isArray(list) ? list : [];
                          const options = items.map((it) => ({ value: it?.name || '', label: it?.voice_id ? `${it.name} (${it.voice_id})` : (it?.name || '') })).filter((o) => o.value);
                          setVoiceOptions((prev) => ({ ...prev, elevenlabs: options }));
                        } catch {}
                        setVoiceLoading((prev) => ({ ...prev, elevenlabs: false }));
                      }
                    }}
                    disabled={creating}
                  >
                    <option value="piper">Piper (local)</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </select>
                </label>
                <label>
                  Voice
                  <select
                    value={voiceValue}
                    onChange={(e) => setVoiceValue(e.target.value)}
                    disabled={creating || (voiceProvider === 'piper' ? voiceLoading.piper : voiceLoading.elevenlabs)}
                  >
                    <option value="">(none)</option>
                    {(voiceProvider === 'piper' ? voiceOptions.piper : voiceOptions.elevenlabs).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
              </fieldset>
              {selPurpose === 'Shopkeeper' && (
                <div className="monster-create-shopkeeper">
                  <div className="monster-create-shopkeeper-title">Establishment Link</div>
                  <p className="muted">
                    Connect this shopkeeper to the storefront they manage. Select an existing establishment to
                    embed its reference in the new NPC note.
                  </p>
                  {establishmentsRoot && (
                    <p className="muted">Scanning: {establishmentsRoot}</p>
                  )}
                  <label>
                    Establishment Name
                    <input
                      type="text"
                      value={establishmentName}
                      onChange={(e) => setEstablishmentName(e.target.value)}
                      disabled={creating}
                      placeholder="e.g. The Gilded Griffin General Store"
                    />
                  </label>
                  <label>
                    Existing Shop Record
                    <select
                      value={establishmentRecord}
                      onChange={(e) => {
                        const { value } = e.target;
                        setEstablishmentRecord(value);
                        if (!value) {
                          setEstablishmentName('');
                          return;
                        }
                        const match = establishments.find((entry) => entry.path === value);
                        if (match) {
                          const autoName = match.title || match.name || '';
                          setEstablishmentName(autoName);
                        }
                      }}
                      disabled={creating || establishmentsLoading}
                    >
                      <option value="">Select an establishment</option>
                      {establishmentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedEstablishment && (
                    <div className="muted">
                      Linking to: {selectedEstablishment.label}
                    </div>
                  )}
                  {establishmentsError && <div className="error">{establishmentsError}</div>}
                  {!establishmentsLoading && !establishmentsError && establishmentsLoaded && establishmentOptions.length === 0 && (
                    <div className="muted">No establishments found. Create a storefront note first.</div>
                  )}
                </div>
              )}
              {selPurpose === '__custom__' && (
                <label>
                  Custom purpose
                  <input type="text" value={customPurpose} onChange={(e) => setCustomPurpose(e.target.value)} disabled={creating} />
                </label>
              )}
              {createError && <div className="error">{createError}</div>}
              <div className="monster-create-actions">
                <button type="button" onClick={() => { if (!creating) setShowCreate(false); }} disabled={creating}>Cancel</button>
                <button type="submit" disabled={creating}>{creating ? 'Creating.' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}












