import React, { useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import ChargesForm from '../components/inventory/ChargesForm.jsx';
import DurabilityForm from '../components/inventory/DurabilityForm.jsx';
import OriginForm from '../components/inventory/OriginForm.jsx';
import PlacementForm from '../components/inventory/PlacementForm.jsx';
import {
  WorldInventoryProvider,
  useWorldInventory,
  filterItems,
} from '../lib/worldInventoryState.js';
import './Dnd.css';
import './DndDmWorldInventory.css';

const DEFAULT_RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];

function createInitialNewItemForm() {
  return {
    name: '',
    type: '',
    rarity: DEFAULT_RARITIES[0],
    tags: '',
    ownerId: '',
    containerId: '',
    locationId: '',
    description: '',
    notes: '',
    weight: '',
    attunementRequired: false,
  };
}

function highlightMatches(value, query) {
  const text = value ?? '';
  const search = (query ?? '').trim();
  if (!search) {
    return String(text);
  }
  const escaped = search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  if (!escaped) {
    return String(text);
  }
  const regex = new RegExp(`(${escaped})`, 'ig');
  const parts = String(text).split(regex);
  if (parts.length === 1) {
    return parts[0];
  }
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={`match-${index}`}>{part}</mark>
    ) : (
      <React.Fragment key={`text-${index}`}>{part}</React.Fragment>
    )
  );
}

function computeFacets(itemsCollection) {
  const tagMap = new Map();
  const rarityMap = new Map();
  const questMap = new Map();
  for (const id of itemsCollection.allIds) {
    const item = itemsCollection.byId[id];
    if (!item) continue;
    for (const tag of item.tags) {
      const key = tag.toLowerCase();
      const entry = tagMap.get(key) || { value: key, label: tag, count: 0 };
      if (entry.count === 0) {
        entry.label = tag;
      }
      entry.count += 1;
      tagMap.set(key, entry);
    }
    const rarityKey = (item.rarity || 'common').toLowerCase();
    const rarityEntry =
      rarityMap.get(rarityKey) || {
        value: rarityKey,
        label: item.rarity || 'common',
        count: 0,
      };
    if (rarityEntry.count === 0) {
      rarityEntry.label = item.rarity || 'common';
    }
    rarityEntry.count += 1;
    rarityMap.set(rarityKey, rarityEntry);
    for (const quest of item.quests) {
      const key = quest.toLowerCase();
      const entry = questMap.get(key) || { value: key, label: quest, count: 0 };
      if (entry.count === 0) {
        entry.label = quest;
      }
      entry.count += 1;
      questMap.set(key, entry);
    }
  }
  const sortByLabel = (a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  return {
    tags: Array.from(tagMap.values()).sort(sortByLabel),
    rarities: Array.from(rarityMap.values()).sort(sortByLabel),
    quests: Array.from(questMap.values()).sort(sortByLabel),
  };
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || value.length <= 12) {
    return value;
  }
  return date.toLocaleString();
}

function FilterChip({ label, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`wi-chip${selected ? ' is-selected' : ''}`}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function WorldInventoryFilters({ facets, filters, onFiltersChange }) {
  const handleSearch = (event) => {
    onFiltersChange({ search: event.target.value });
  };

  const handleRarityChange = (event) => {
    const value = event.target.value;
    if (value === 'all') {
      onFiltersChange({ rarities: [] });
    } else {
      onFiltersChange({ rarities: [value] });
    }
  };

  const toggleTag = (value) => {
    const selected = filters.tags.includes(value);
    const next = selected
      ? filters.tags.filter((existing) => existing !== value)
      : [...filters.tags, value];
    onFiltersChange({ tags: next });
  };

  const toggleQuest = (value) => {
    const selected = filters.quests.includes(value);
    const next = selected
      ? filters.quests.filter((existing) => existing !== value)
      : [...filters.quests, value];
    onFiltersChange({ quests: next });
  };

  return (
    <div className="wi-filter-panel">
      <label className="wi-filter-search">
        <span>Search</span>
        <input
          type="search"
          placeholder="Name, tag, or keyword"
          value={filters.search}
          onChange={handleSearch}
        />
      </label>
      <label className="wi-filter-select">
        <span>Rarity</span>
        <select value={filters.rarities[0] || 'all'} onChange={handleRarityChange}>
          <option value="all">All rarities</option>
          {facets.rarities.map((rarity) => (
            <option key={rarity.value} value={rarity.value}>
              {rarity.label} ({rarity.count})
            </option>
          ))}
        </select>
      </label>
      <div className="wi-filter-chips">
        <span className="wi-filter-label">Tags</span>
        <div className="wi-chip-group">
          {facets.tags.length === 0 && <p className="wi-empty">No tags recorded.</p>}
          {facets.tags.map((tag) => (
            <FilterChip
              key={tag.value}
              label={`${tag.label} (${tag.count})`}
              selected={filters.tags.includes(tag.value)}
              onToggle={() => toggleTag(tag.value)}
            />
          ))}
        </div>
      </div>
      <div className="wi-filter-chips">
        <span className="wi-filter-label">Quests</span>
        <div className="wi-chip-group">
          {facets.quests.length === 0 && <p className="wi-empty">No quests linked.</p>}
          {facets.quests.map((quest) => (
            <FilterChip
              key={quest.value}
              label={`${quest.label} (${quest.count})`}
              selected={filters.quests.includes(quest.value)}
              onToggle={() => toggleQuest(quest.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorldInventoryCreateForm({
  form,
  errors,
  pending,
  ownerOptions,
  containerOptions,
  locationOptions,
  onChange,
  onSubmit,
  onCancel,
}) {
  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    onChange(name, type === 'checkbox' ? checked : value);
  };

  return (
    <form className="wi-create-form" onSubmit={onSubmit}>
      <div className="wi-create-grid">
        <label>
          <span>Name *</span>
          <input
            name="name"
            type="text"
            value={form.name}
            onChange={handleChange}
            disabled={pending}
            placeholder="Ex: Bag of Holding"
          />
        </label>
        <label>
          <span>Type *</span>
          <input
            name="type"
            type="text"
            value={form.type}
            onChange={handleChange}
            disabled={pending}
            placeholder="Ex: Wondrous item"
          />
        </label>
        <label>
          <span>Rarity *</span>
          <input
            name="rarity"
            type="text"
            list="wi-rarity-options"
            value={form.rarity}
            onChange={handleChange}
            disabled={pending}
            placeholder="Ex: uncommon"
          />
          <datalist id="wi-rarity-options">
            {DEFAULT_RARITIES.map((rarity) => (
              <option key={rarity} value={rarity} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Tags</span>
          <input
            name="tags"
            type="text"
            value={form.tags}
            onChange={handleChange}
            disabled={pending}
            placeholder="Comma separated"
          />
        </label>
        <label>
          <span>Owner</span>
          <select
            name="ownerId"
            value={form.ownerId}
            onChange={handleChange}
            disabled={pending}
          >
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Container</span>
          <select
            name="containerId"
            value={form.containerId}
            onChange={handleChange}
            disabled={pending}
          >
            <option value="">Unassigned</option>
            {containerOptions.map((container) => (
              <option key={container.id} value={container.id}>
                {container.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Location</span>
          <select
            name="locationId"
            value={form.locationId}
            onChange={handleChange}
            disabled={pending}
          >
            <option value="">Unassigned</option>
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Weight (lbs)</span>
          <input
            name="weight"
            type="number"
            min="0"
            step="0.1"
            value={form.weight}
            onChange={handleChange}
            disabled={pending}
          />
        </label>
      </div>
      <label>
        <span>Description</span>
        <textarea
          name="description"
          rows={3}
          value={form.description}
          onChange={handleChange}
          disabled={pending}
          placeholder="What makes this item special?"
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea
          name="notes"
          rows={2}
          value={form.notes}
          onChange={handleChange}
          disabled={pending}
        />
      </label>
      <label className="wi-create-checkbox">
        <input
          name="attunementRequired"
          type="checkbox"
          checked={form.attunementRequired}
          onChange={handleChange}
          disabled={pending}
        />
        <span>Requires attunement</span>
      </label>
      {errors.length > 0 && <p className="wi-error">{errors.join(' ')}</p>}
      <div className="wi-create-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create item'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function WorldInventoryItemList({ items, selectedId, onSelect, lookups, searchTerm }) {
  if (items.length === 0) {
    return <p className="wi-empty">No items match the current filters.</p>;
  }
  return (
    <ul className="wi-item-list">
      {items.map((item) => {
        const owner = lookups.owners.byId[item.ownerId];
        const container = lookups.containers.byId[item.containerId];
        const location = lookups.locations.byId[item.locationId];
        const ownerLabel = owner ? `Owner: ${owner.name}` : '';
        const containerLabel = container ? `Container: ${container.name}` : '';
        const locationLabel = location ? `Location: ${location.name}` : '';
        return (
          <li key={item.id}>
            <button
              type="button"
              className={`wi-item${selectedId === item.id ? ' is-selected' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <div className="wi-item-header">
                <span className="wi-item-name">{highlightMatches(item.name, searchTerm)}</span>
                <span className="wi-item-rarity">{highlightMatches(item.rarity ?? '', searchTerm)}</span>
              </div>
              <div className="wi-item-sub">
                {item.type && <span>{highlightMatches(item.type, searchTerm)}</span>}
                {owner && <span>{highlightMatches(ownerLabel, searchTerm)}</span>}
                {container && <span>{highlightMatches(containerLabel, searchTerm)}</span>}
                {location && <span>{highlightMatches(locationLabel, searchTerm)}</span>}
              </div>
              <div className="wi-item-tags">
                {item.tags.map((tag) => (
                  <span key={tag} className="wi-tag">
                    {highlightMatches(tag, searchTerm)}
                  </span>
                ))}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InventoryEntitySection({ title, collection }) {
  const entries = collection.allIds.map((id) => collection.byId[id]).filter(Boolean);
  return (
    <section className="wi-entity-section">
      <h2>{title}</h2>
      {entries.length === 0 && <p className="wi-empty">No records yet.</p>}
      <ul className="wi-entity-list">
        {entries.map((entry) => (
          <li key={entry.id} className="wi-entity-item">
            <div className="wi-entity-head">
              <span className="wi-entity-name">{entry.name}</span>
              {entry.type && <span className="wi-entity-type">{entry.type}</span>}
            </div>
            {entry.summary && <p className="wi-entity-summary">{entry.summary}</p>}
            {entry.tags.length > 0 && (
              <div className="wi-entity-tags">
                {entry.tags.map((tag) => (
                  <span key={tag} className="wi-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProvenanceLedger({ item, pending, onCreate, onUpdate, onDelete }) {
  const [mode, setMode] = useState('view');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ timestamp: '', actor: '', action: '', notes: '' });

  useEffect(() => {
    setMode('view');
    setEditingId('');
    setForm({ timestamp: '', actor: '', action: '', notes: '' });
  }, [item.id]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const beginNew = () => {
    setMode('new');
    setEditingId('');
    setForm({ timestamp: new Date().toISOString().slice(0, 16), actor: '', action: '', notes: '' });
  };

  const beginEdit = (entry) => {
    setMode('edit');
    setEditingId(entry.id);
    setForm({
      timestamp: entry.timestamp ? entry.timestamp.slice(0, 16) : '',
      actor: entry.actor,
      action: entry.action,
      notes: entry.notes,
    });
  };

  const resetForm = () => {
    setMode('view');
    setEditingId('');
    setForm({ timestamp: '', actor: '', action: '', notes: '' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      timestamp: form.timestamp ? new Date(form.timestamp).toISOString() : '',
      actor: form.actor,
      action: form.action,
      notes: form.notes,
    };
    if (mode === 'edit' && editingId) {
      await onUpdate(editingId, payload);
    } else {
      await onCreate(payload);
    }
    resetForm();
  };

  const handleDelete = async (entryId) => {
    await onDelete(entryId);
    if (editingId === entryId) {
      resetForm();
    }
  };

  return (
    <section className="wi-panel">
      <div className="wi-panel-header">
        <h3>Provenance Ledger</h3>
        <button type="button" onClick={beginNew} disabled={pending}>
          Add entry
        </button>
      </div>
      {item.provenance.origin && (
        <p className="wi-provenance-origin">Origin: {item.provenance.origin}</p>
      )}
      <ul className="wi-ledger-list">
        {item.provenance.ledger.length === 0 && (
          <li className="wi-empty">No provenance entries yet.</li>
        )}
        {item.provenance.ledger.map((entry) => (
          <li key={entry.id} className="wi-ledger-entry">
            <div className="wi-ledger-meta">
              <span className="wi-ledger-time">{formatTimestamp(entry.timestamp)}</span>
              {entry.actor && <span className="wi-ledger-actor">{entry.actor}</span>}
            </div>
            {entry.action && <div className="wi-ledger-action">{entry.action}</div>}
            {entry.notes && <p className="wi-ledger-notes">{entry.notes}</p>}
            <div className="wi-ledger-actions">
              <button type="button" onClick={() => beginEdit(entry)} disabled={pending}>
                Edit
              </button>
              <button type="button" onClick={() => handleDelete(entry.id)} disabled={pending}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {(mode === 'new' || mode === 'edit') && (
        <form className="wi-ledger-form" onSubmit={handleSubmit}>
          <label>
            <span>When</span>
            <input
              type="datetime-local"
              name="timestamp"
              value={form.timestamp}
              onChange={handleChange}
              disabled={pending}
            />
          </label>
          <label>
            <span>Actor</span>
            <input
              type="text"
              name="actor"
              value={form.actor}
              onChange={handleChange}
              disabled={pending}
            />
          </label>
          <label>
            <span>Action</span>
            <input
              type="text"
              name="action"
              value={form.action}
              onChange={handleChange}
              disabled={pending}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              disabled={pending}
              rows={3}
            />
          </label>
          <div className="wi-ledger-buttons">
            <button type="submit" disabled={pending}>
              {mode === 'edit' ? 'Save changes' : 'Add entry'}
            </button>
            <button type="button" onClick={resetForm} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function WorldInventoryDetail({ item, lookups, pending, actions }) {
  const ownerOptions = useMemo(
    () => lookups.owners.allIds.map((id) => lookups.owners.byId[id]).filter(Boolean),
    [lookups.owners]
  );
  const containerOptions = useMemo(
    () => lookups.containers.allIds.map((id) => lookups.containers.byId[id]).filter(Boolean),
    [lookups.containers]
  );
  const locationOptions = useMemo(
    () => lookups.locations.allIds.map((id) => lookups.locations.byId[id]).filter(Boolean),
    [lookups.locations]
  );

  const submitCharges = async (changes) => {
    await actions.adjustCharges(item.id, changes);
  };

  const submitDurability = async (changes) => {
    await actions.adjustDurability(item.id, changes);
  };

  const handleMoveChange = async (field, value) => {
    await actions.moveItem(item.id, {
      ownerId: field === 'ownerId' ? value : item.ownerId,
      containerId: field === 'containerId' ? value : item.containerId,
      locationId: field === 'locationId' ? value : item.locationId,
    });
  };

  const updateOrigin = async (value) => {
    await actions.updateItem(item.id, { provenance: { origin: value } });
  };

  return (
    <section className="wi-detail">
      <header className="wi-detail-header">
        <div>
          <h2>{item.name}</h2>
          <p className="wi-detail-sub">{item.type || 'Item'} · {item.rarity}</p>
        </div>
        {pending && <span className="wi-status">Saving…</span>}
      </header>
      {item.description && <p className="wi-detail-description">{item.description}</p>}
      {item.attunement.required && (
        <p className="wi-detail-attunement">
          Requires attunement
          {item.attunement.restrictions.length > 0 &&
            ` (${item.attunement.restrictions.join(', ')})`}
        </p>
      )}
      {item.attunement.attunedTo.length > 0 && (
        <p className="wi-detail-attuned">Attuned to: {item.attunement.attunedTo.join(', ')}</p>
      )}
      {item.notes && <p className="wi-detail-notes">{item.notes}</p>}

      <div className="wi-detail-grid">
        <ChargesForm values={item.charges} pending={pending} onSubmit={submitCharges} />
        <DurabilityForm values={item.durability} pending={pending} onSubmit={submitDurability} />
      </div>

      <PlacementForm
        ownerId={item.ownerId}
        containerId={item.containerId}
        locationId={item.locationId}
        ownerOptions={ownerOptions}
        containerOptions={containerOptions}
        locationOptions={locationOptions}
        pending={pending}
        onChange={handleMoveChange}
      />

      <OriginForm
        origin={item.provenance.origin || ''}
        pending={pending}
        onSubmit={updateOrigin}
      />

      <ProvenanceLedger
        item={item}
        pending={pending}
        onCreate={(entry) => actions.addLedgerEntry(item.id, entry)}
        onUpdate={(entryId, entry) => actions.updateLedgerEntry(item.id, entryId, entry)}
        onDelete={(entryId) => actions.deleteLedgerEntry(item.id, entryId)}
      />
    </section>
  );
}

export function WorldInventoryView() {
  const { state, actions } = useWorldInventory();
  const { loading, error, items, owners, containers, locations, filters, selectedItemId, pendingItems } =
    state;

  const [isCreating, setIsCreating] = useState(false);
  const [newItemForm, setNewItemForm] = useState(() => createInitialNewItemForm());
  const [createErrors, setCreateErrors] = useState([]);

  const facets = useMemo(() => computeFacets(items), [items]);

  const filteredItems = useMemo(
    () => filterItems(items, filters, { owners, containers, locations }),
    [items, filters, owners, containers, locations]
  );

  const ownerOptions = useMemo(
    () => owners.allIds.map((id) => owners.byId[id]).filter(Boolean),
    [owners]
  );
  const containerOptions = useMemo(
    () => containers.allIds.map((id) => containers.byId[id]).filter(Boolean),
    [containers]
  );
  const locationOptions = useMemo(
    () => locations.allIds.map((id) => locations.byId[id]).filter(Boolean),
    [locations]
  );

  const selectedItem = selectedItemId ? items.byId[selectedItemId] : null;
  const pending = selectedItem ? Boolean(pendingItems[selectedItem.id]) : false;
  const createPending = Boolean(pendingItems.__create__);

  const resetCreateForm = () => {
    setNewItemForm(createInitialNewItemForm());
    setCreateErrors([]);
  };

  const closeCreate = () => {
    setIsCreating(false);
    resetCreateForm();
  };

  const handleToggleCreate = () => {
    if (isCreating) {
      closeCreate();
    } else {
      resetCreateForm();
      setIsCreating(true);
    }
  };

  const handleCreateChange = (field, value) => {
    setNewItemForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = newItemForm.name.trim();
    const trimmedType = newItemForm.type.trim();
    const trimmedRarity = newItemForm.rarity.trim();
    const errors = [];
    if (!trimmedName) {
      errors.push('Name is required.');
    }
    if (!trimmedType) {
      errors.push('Type is required.');
    }
    if (!trimmedRarity) {
      errors.push('Rarity is required.');
    }
    if (errors.length > 0) {
      setCreateErrors(errors);
      return;
    }

    const tags = newItemForm.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const payload = {
      name: trimmedName,
      type: trimmedType,
      rarity: trimmedRarity,
      tags,
      ownerId: newItemForm.ownerId,
      containerId: newItemForm.containerId,
      locationId: newItemForm.locationId,
      description: newItemForm.description.trim(),
      notes: newItemForm.notes.trim(),
      attunement: {
        required: Boolean(newItemForm.attunementRequired),
        restrictions: [],
        notes: '',
        attunedTo: [],
      },
    };
    if (newItemForm.weight !== '') {
      const weightValue = Number(newItemForm.weight);
      if (Number.isFinite(weightValue)) {
        payload.weight = weightValue;
      }
    }

    try {
      await actions.createItem(payload);
      closeCreate();
    } catch (createError) {
      console.warn('Unable to create item', createError);
      setCreateErrors([]);
    }
  };

  return (
    <section className="world-inventory-layout">
      <section className="wi-panel">
        <div className="wi-panel-header">
          <h2>Items</h2>
          <div className="wi-panel-actions">
            {createPending && <span className="wi-status">Creating…</span>}
            <button type="button" onClick={handleToggleCreate} disabled={createPending}>
              {isCreating ? 'Close' : 'New Item'}
            </button>
          </div>
        </div>
        {isCreating && (
          <WorldInventoryCreateForm
            form={newItemForm}
            errors={createErrors}
            pending={createPending}
            ownerOptions={ownerOptions}
            containerOptions={containerOptions}
            locationOptions={locationOptions}
            onChange={handleCreateChange}
            onSubmit={handleCreateSubmit}
            onCancel={closeCreate}
          />
        )}
        <WorldInventoryFilters facets={facets} filters={filters} onFiltersChange={actions.setFilters} />
        {loading && !state.loaded && <p className="wi-status">Loading inventory…</p>}
        {error && <p className="wi-error">{error}</p>}
        <WorldInventoryItemList
          items={filteredItems}
          selectedId={selectedItemId}
          onSelect={actions.selectItem}
          lookups={{ owners, containers, locations }}
          searchTerm={filters.search}
        />
      </section>
      <section className="wi-detail-column">
        {!selectedItem && <p className="wi-empty">Select an item to review its details.</p>}
        {selectedItem && (
          <WorldInventoryDetail
            item={selectedItem}
            lookups={{ owners, containers, locations }}
            pending={pending}
            actions={actions}
          />
        )}
      </section>
      <aside className="wi-sidebar">
        <InventoryEntitySection title="Containers" collection={containers} />
        <InventoryEntitySection title="Owners" collection={owners} />
        <InventoryEntitySection title="Locations" collection={locations} />
      </aside>
    </section>
  );
}

export default function DndDmWorldInventory({ api }) {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · World Inventory</h1>
      <WorldInventoryProvider api={api}>
        <WorldInventoryView />
      </WorldInventoryProvider>
    </>
  );
}

