import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { openCommandPalette } from '../lib/commandPalette.js';
import { listEntitiesByType } from '../lib/vaultIndex.js';
import { loadEntity, saveEntity } from '../lib/vaultAdapter.js';
import { useVaultVersion } from '../lib/vaultEvents.jsx';
import './Dnd.css';

const STATUS_COLUMNS = [
  { id: 'backlog', title: 'Backlog', blurb: 'Hooks and ideas waiting to launch.' },
  { id: 'active', title: 'Active', blurb: 'Quests in play this session.' },
  { id: 'done', title: 'Done', blurb: 'Resolved arcs and completed missions.' },
];

const STATUS_ORDER = STATUS_COLUMNS.map((column) => column.id);

const STATUS_LABELS = new Map(STATUS_COLUMNS.map((column) => [column.id, column.title]));

function createEmptyColumns() {
  return STATUS_COLUMNS.reduce((accumulator, column) => {
    accumulator[column.id] = [];
    return accumulator;
  }, {});
}

function normalizeStatus(value) {
  if (!value && value !== 0) return 'backlog';
  const lower = String(value).trim().toLowerCase();
  if (STATUS_ORDER.includes(lower)) return lower;
  if (lower === 'in-progress' || lower === 'inprogress') return 'active';
  if (lower === 'completed' || lower === 'complete' || lower === 'finished') return 'done';
  return 'backlog';
}

function coerceStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function sanitizeChip(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\*_`]+/g, '')
    .trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value && typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractSummary(metadata, fields) {
  const candidates = [
    metadata?.canonical_summary,
    fields?.canonical_summary,
    metadata?.summary,
    fields?.summary,
    metadata?.description,
    fields?.description,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const line = candidate.trim().split(/\r?\n/)[0];
      if (line) return line.trim();
    }
  }
  return '';
}

function parsePriority(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatRelativeTime(timestampMs) {
  if (!timestampMs) return '';
  try {
    const delta = Date.now() - timestampMs;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (Math.abs(delta) < hour) {
      const minutes = Math.round(delta / minute);
      if (minutes === 0) return 'moments ago';
      return `${Math.abs(minutes)} min ago`;
    }
    if (Math.abs(delta) < day) {
      const hours = Math.round(delta / hour);
      return `${Math.abs(hours)} hr ago`;
    }
    const days = Math.round(delta / day);
    if (Math.abs(days) <= 7) return `${Math.abs(days)} d ago`;
  } catch (err) {
    console.warn('Failed to format date', err);
  }
  try {
    return new Date(timestampMs).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

const sections = [
  { to: '/dnd/dungeon-master/quests/faction', icon: 'Shield', title: 'Faction Quests', description: 'Faction-driven objectives and arcs.' },
  { to: '/dnd/dungeon-master/quests/main', icon: 'Swords', title: 'Main Quests', description: 'Primary storyline and key beats.' },
  { to: '/dnd/dungeon-master/quests/personal', icon: 'UserRound', title: 'Personal Quests', description: 'Character-driven goals and threads.' },
  { to: '/dnd/dungeon-master/quests/side', icon: 'ScrollText', title: 'Side Quests', description: 'Optional tasks and diversions.' },
  {
    to: '/dnd/dungeon-master/quests/generator',
    icon: 'Sparkles',
    title: 'Quest Generator',
    description: 'AI-assisted synopsis creation for fresh adventures.',
  },
];

export default function DndDmQuests() {
  const [columns, setColumns] = useState(() => createEmptyColumns());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingMap, setSavingMap] = useState({});

  const columnsRef = useRef(columns);
  const questsRef = useRef({});

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  const questVersion = useVaultVersion(['20_dm/quests']);

  const fetchQuests = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const { entries } = await listEntitiesByType('quest', { force });

      const nextColumns = createEmptyColumns();
      const questMap = {};

      for (const entry of entries) {
        const safeId = String(entry.id || '').trim();
        if (!safeId) {
          continue;
        }
        const indexMeta = entry.index || {};
        const metadata = indexMeta.metadata || {};
        const fields = indexMeta.fields || {};
        const status = normalizeStatus(metadata.status ?? fields.status);

        const name = entry.title || entry.name || metadata.name || fields.name || 'Untitled Quest';
        const summary = extractSummary(metadata, fields);
        const tags = coerceStringArray(metadata.tags ?? fields.tags ?? []).map(sanitizeChip);
        const location = sanitizeChip(firstNonEmpty(metadata.location, fields.location, metadata.region, fields.region));
        const faction = sanitizeChip(firstNonEmpty(metadata.faction, fields.faction, metadata.affiliation, fields.affiliation));
        const priority = parsePriority(metadata.priority ?? fields.priority);

        const quest = {
          id: safeId,
          title: name,
          status,
          summary,
          tags,
          location,
          faction,
          priority,
          path: entry.path,
          relPath: entry.relPath,
          modified_ms: entry.modified_ms,
        };

        questMap[safeId] = quest;
        nextColumns[status].push(quest);
      }

      const sortCards = (a, b) => {
        const pa = parsePriority(a.priority);
        const pb = parsePriority(b.priority);
        if (pa !== null || pb !== null) {
          if (pa === null) return 1;
          if (pb === null) return -1;
          if (pb !== pa) return pb - pa;
        }
        return String(a.title || '').localeCompare(String(b.title || ''));
      };

      STATUS_COLUMNS.forEach(({ id }) => {
        nextColumns[id].sort(sortCards);
      });

      questsRef.current = questMap;
      setColumns(nextColumns);
      columnsRef.current = nextColumns;
    } catch (err) {
      console.error('Failed to load quests', err);
      setError(err?.message || 'Failed to load quests.');
      questsRef.current = {};
      const empty = createEmptyColumns();
      setColumns(empty);
      columnsRef.current = empty;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuests({ force: false });
  }, [fetchQuests, questVersion]);

  const handleDragEnd = useCallback(
    async (result) => {
      const { destination, source, draggableId } = result;
      if (!destination) return;
      if (destination.droppableId === source.droppableId && destination.index === source.index) return;

      const sourceId = source.droppableId;
      const destinationId = destination.droppableId;

      const previousColumns = STATUS_COLUMNS.reduce((accumulator, column) => {
        accumulator[column.id] = columnsRef.current[column.id].map((card) => ({ ...card }));
        return accumulator;
      }, {});
      const questMapSnapshot = { ...questsRef.current };

      const sourceList = Array.from(columnsRef.current[sourceId] || []);
      const movedQuest = sourceList[source.index];
      if (!movedQuest) return;

      if (sourceId === destinationId) {
        const reordered = Array.from(columnsRef.current[sourceId] || []);
        const [card] = reordered.splice(source.index, 1);
        reordered.splice(destination.index, 0, card);
        const updatedColumns = {
          ...columnsRef.current,
          [sourceId]: reordered,
        };
        setColumns(updatedColumns);
        columnsRef.current = updatedColumns;
        return;
      }

      const destinationList = Array.from(columnsRef.current[destinationId] || []);
      const [removed] = sourceList.splice(source.index, 1);
      const optimisticCard = { ...removed, status: destinationId };
      destinationList.splice(destination.index, 0, optimisticCard);

      const optimisticColumns = {
        ...columnsRef.current,
        [sourceId]: sourceList,
        [destinationId]: destinationList,
      };
      questsRef.current[draggableId] = { ...(questsRef.current[draggableId] || removed), status: destinationId };

      setColumns(optimisticColumns);
      columnsRef.current = optimisticColumns;
      setSavingMap((prev) => ({ ...prev, [draggableId]: true }));

      try {
        const questInfo = questsRef.current[draggableId] || removed;
        const entityResult = await loadEntity(questInfo.path);
        const entity = entityResult?.entity || {};
        const updatedEntity = {
          ...entity,
          status: destinationId,
        };
        await saveEntity({
          entity: updatedEntity,
          body: entityResult?.body || '',
          path: entityResult?.path || questInfo.path,
        });
        await fetchQuests({ force: true, silent: true });
      } catch (err) {
        console.error('Failed to move quest', err);
        setError(err?.message || 'Failed to update quest status.');
        questsRef.current = questMapSnapshot;
        setColumns(previousColumns);
        columnsRef.current = previousColumns;
      } finally {
        setSavingMap((prev) => {
          const next = { ...prev };
          delete next[draggableId];
          return next;
        });
      }
    },
    [fetchQuests],
  );

  return (
    <>
      <BackButton />
      <div className="quest-page">
        <div className="quest-header">
          <div>
            <h1>Dungeons &amp; Dragons — Quest Board</h1>
            <p className="muted">
              Drag quests between columns to update their status. Changes are saved automatically.
            </p>
          </div>
          <div className="quest-actions">
            <button type="button" onClick={() => openCommandPalette({ templateId: 'quest' })}>
              Quick Create
            </button>
            <button type="button" onClick={() => fetchQuests({ force: true })} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {error && <div className="quest-error">{error}</div>}
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="quest-board">
            {STATUS_COLUMNS.map((column) => {
              const cards = columns[column.id] || [];
              return (
                <Droppable key={column.id} droppableId={column.id}>
                  {(provided, snapshot) => (
                    <section
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`quest-column ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                    >
                      <header className="quest-column-header">
                        <div>
                          <h2 className="quest-column-title">{column.title}</h2>
                          <p className="quest-column-blurb muted">{column.blurb}</p>
                        </div>
                        <div className="quest-column-count">{cards.length}</div>
                      </header>
                      <div className="quest-column-body">
                        {cards.map((quest, index) => (
                          <Draggable key={quest.id} draggableId={quest.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <article
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={[
                                  'quest-card',
                                  dragSnapshot.isDragging ? 'dragging' : '',
                                  savingMap[quest.id] ? 'saving' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <div className="quest-card-header">
                                  <h3 className="quest-card-title">{quest.title}</h3>
                                  {savingMap[quest.id] && <span className="quest-card-saving">Saving…</span>}
                                </div>
                                {quest.summary && <p className="quest-card-summary">{quest.summary}</p>}
                                <div className="quest-card-meta">
                                  {quest.location && <span>{quest.location}</span>}
                                  {quest.faction && <span>{quest.faction}</span>}
                                  {quest.priority !== null && <span>Priority {quest.priority}</span>}
                                </div>
                                {quest.tags.length > 0 && (
                                  <div className="quest-card-tags">
                                    {quest.tags.slice(0, 4).map((tag) => (
                                      <span key={tag} className="quest-tag">
                                        {tag}
                                      </span>
                                    ))}
                                    {quest.tags.length > 4 && <span className="quest-tag more">+{quest.tags.length - 4}</span>}
                                  </div>
                                )}
                                <div className="quest-card-footer">
                                  <span>{STATUS_LABELS.get(quest.status) || quest.status}</span>
                                  <span>{formatRelativeTime(quest.modified_ms)}</span>
                                </div>
                              </article>
                            )}
                          </Draggable>
                        ))}
                        {cards.length === 0 && !loading && (
                          <div className="quest-column-empty">Drop quests here to populate this column.</div>
                        )}
                        {provided.placeholder}
                      </div>
                    </section>
                  )}
                </Droppable>
              );
            })}
          </div>
        </DragDropContext>
      </div>
      <section className="dashboard dnd-card-grid quest-secondary-nav">
        {sections.map(({ to, icon, title, description }) => (
          <Card key={to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </section>
    </>
  );
}
