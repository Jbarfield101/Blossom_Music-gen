import { useMemo, useState, useCallback, useEffect, useReducer, useRef } from 'react';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import './Calendar.css';

const WEEK_START_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const LOCAL_STORAGE_KEY = 'calendar.events';

const EVENT_CATEGORIES = [
  {
    id: 'work',
    label: 'Work',
    accent: '#7c8bff',
    defaultTitle: 'Work session',
  },
  {
    id: 'social',
    label: 'Social',
    accent: '#f472b6',
    defaultTitle: 'Social plan',
  },
  {
    id: 'task',
    label: 'Task',
    accent: '#34d399',
    defaultTitle: 'Task reminder',
  },
  {
    id: 'custom',
    label: 'Custom',
    accent: '#f59e0b',
    defaultTitle: '',
  },
];

function sanitizeStoredEvents(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  return Object.entries(raw).reduce((acc, [dateKey, events]) => {
    if (!Array.isArray(events)) {
      return acc;
    }

    const sanitized = events
      .map((event) => {
        if (!event) return null;
        const startMinutes = Number(event.startMinutes ?? parseTimeToMinutes(event.startTime));
        const endMinutes = Number(event.endMinutes ?? parseTimeToMinutes(event.endTime));
        if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
          return null;
        }
        return {
          id: event.id ?? `${dateKey}-${startMinutes}-${endMinutes}`,
          title: event.title ?? 'Untitled event',
          category: EVENT_CATEGORIES.some((cat) => cat.id === event.category)
            ? event.category
            : 'custom',
          startTime: event.startTime ?? minutesToTimeString(startMinutes),
          endTime: event.endTime ?? minutesToTimeString(endMinutes),
          startMinutes,
          endMinutes,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMinutes - b.startMinutes);

    if (sanitized.length > 0) {
      acc[dateKey] = sanitized;
    }
    return acc;
  }, {});
}

function loadStoredEvents() {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored);
    return sanitizeStoredEvents(parsed);
  } catch (error) {
    console.warn('Failed to load stored calendar events', error);
    return {};
  }
}

function calendarEventsReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { dateKey, event } = action.payload;
      const existing = state[dateKey] ?? [];
      const nextEvents = [...existing, event].sort((a, b) => a.startMinutes - b.startMinutes);
      return { ...state, [dateKey]: nextEvents };
    }
    case 'set': {
      return sanitizeStoredEvents(action.payload ?? {});
    }
    default:
      return state;
  }
}

function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return Number.NaN;
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

function minutesToTimeString(minutes) {
  const hrs = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = Math.floor(minutes % 60)
    .toString()
    .padStart(2, '0');
  return `${hrs}:${mins}`;
}

function validateTimeRange(startValue, endValue) {
  const startMinutes = parseTimeToMinutes(startValue);
  const endMinutes = parseTimeToMinutes(endValue);
  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
    return { isValid: false, message: 'Please provide valid start and end times.' };
  }
  if (startMinutes >= endMinutes) {
    return {
      isValid: false,
      message: 'The start time must be earlier than the end time.',
    };
  }
  return { isValid: true, startMinutes, endMinutes };
}

function hasTimeCollision(events, startMinutes, endMinutes) {
  return events.some((event) => {
    const startsBeforeEnd = event.startMinutes < endMinutes;
    const endsAfterStart = event.endMinutes > startMinutes;
    return startsBeforeEnd && endsAfterStart;
  });
}

function generateHourLabels() {
  return Array.from({ length: 24 }, (_, hour) => {
    const label = `${hour.toString().padStart(2, '0')}:00`;
    return { hour, label };
  });
}

function formatMinutesRange(startMinutes, endMinutes) {
  return `${minutesToTimeString(startMinutes)} – ${minutesToTimeString(endMinutes)}`;
}

function createDefaultFormState(category = 'work') {
  const meta = EVENT_CATEGORIES.find((item) => item.id === category);
  return {
    category,
    title: meta?.defaultTitle ?? '',
    startTime: '09:00',
    endTime: '10:00',
  };
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCalendarWeeks(monthDate, weekStart) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstOfMonth.getDay() - weekStart + 7) % 7;
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const startDate = new Date(year, month, 1 - offset);
  const baseDay = startDate.getDate();

  return Array.from({ length: totalCells / 7 }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const cellDate = new Date(startDate);
      cellDate.setDate(baseDay + weekIndex * 7 + dayIndex);
      return cellDate;
    })
  );
}

function getStartOfWeek(date, weekStart) {
  const result = startOfDay(date);
  const diff = (result.getDay() - weekStart + 7) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

export default function Calendar() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const [weekStart, setWeekStart] = useState(WEEK_START_OPTIONS[0].value);
  const [eventsByDate, dispatchEvents] = useReducer(
    calendarEventsReducer,
    {},
    loadStoredEvents
  );
  const [isDayViewOpen, setDayViewOpen] = useState(false);
  const [formState, setFormState] = useState(() => createDefaultFormState());
  const [formError, setFormError] = useState('');
  const dayViewRef = useRef(null);

  const categoryMap = useMemo(
    () =>
      EVENT_CATEGORIES.reduce((acc, category) => {
        acc[category.id] = category;
        return acc;
      }, {}),
    []
  );
  const hourSlots = useMemo(() => generateHourLabels(), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(eventsByDate));
  }, [eventsByDate]);

  const handleCloseDayView = useCallback(() => {
    setDayViewOpen(false);
    setFormError('');
  }, []);

  const weeks = useMemo(
    () => buildCalendarWeeks(visibleMonth, weekStart),
    [visibleMonth, weekStart]
  );

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
    []
  );
  const fullDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }),
    []
  );
  const shortWeekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
    []
  );
  const longWeekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { weekday: 'long' }),
    []
  );
  const rangeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
    []
  );
  const rangeFormatterWithYear = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    []
  );

  const weekdayLabels = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(2021, 7, 1 + weekStart + index));
      return {
        short: shortWeekdayFormatter.format(date),
        long: longWeekdayFormatter.format(date),
      };
    });
  }, [weekStart, shortWeekdayFormatter, longWeekdayFormatter]);

  const monthLabel = useMemo(
    () => monthFormatter.format(visibleMonth),
    [monthFormatter, visibleMonth]
  );
  const selectedLabel = useMemo(
    () => (selectedDate ? fullDateFormatter.format(selectedDate) : ''),
    [selectedDate, fullDateFormatter]
  );
  const daysInVisibleMonth = useMemo(
    () => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate(),
    [visibleMonth]
  );

  const weekRange = useMemo(() => {
    if (!selectedDate) return null;
    const start = getStartOfWeek(selectedDate, weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }, [selectedDate, weekStart]);

  const weekRangeLabel = useMemo(() => {
    if (!weekRange) return '—';
    const sameYear =
      weekRange.start.getFullYear() === weekRange.end.getFullYear();
    if (sameYear) {
      const startLabel = rangeFormatter.format(weekRange.start);
      const endLabel = rangeFormatter.format(weekRange.end);
      return `${startLabel} – ${endLabel}, ${weekRange.start.getFullYear()}`;
    }
    const startLabel = rangeFormatterWithYear.format(weekRange.start);
    const endLabel = rangeFormatterWithYear.format(weekRange.end);
    return `${startLabel} – ${endLabel}`;
  }, [weekRange, rangeFormatter, rangeFormatterWithYear]);

  const relativeLabel = useMemo(() => {
    if (!selectedDate) return '—';
    const diff = Math.round((selectedDate.getTime() - today.getTime()) / MS_IN_DAY);
    if (diff === 0) return 'Today';
    const abs = Math.abs(diff);
    const unit = abs === 1 ? 'day' : 'days';
    return diff > 0 ? `${abs} ${unit} from now` : `${abs} ${unit} ago`;
  }, [selectedDate, today]);

  const isoValue = useMemo(() => {
    if (!selectedDate) return '—';
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [selectedDate]);

  const selectedDateKey = useMemo(
    () => (selectedDate ? formatDateKey(selectedDate) : null),
    [selectedDate]
  );
  const dayEvents = selectedDateKey ? eventsByDate[selectedDateKey] ?? [] : [];

  const handleOverlayClick = useCallback(
    (event) => {
      if (event.target === event.currentTarget) {
        handleCloseDayView();
      }
    },
    [handleCloseDayView]
  );

  useEffect(() => {
    if (!isDayViewOpen) {
      return undefined;
    }
    const node = dayViewRef.current;
    if (!node) {
      return undefined;
    }

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusFirstElement = () => {
      const focusable = node.querySelectorAll(focusableSelector);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        node.focus();
      }
    };

    focusFirstElement();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCloseDayView();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = Array.from(node.querySelectorAll(focusableSelector)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1'
      );

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCloseDayView, isDayViewOpen]);

  const handleMonthChange = useCallback(
    (direction) => {
      setVisibleMonth((prev) => {
        const next = new Date(prev.getFullYear(), prev.getMonth() + direction, 1);
        return next;
      });
    },
    [setVisibleMonth]
  );

  const handleToday = useCallback(() => {
    setVisibleMonth(startOfMonth(today));
    setSelectedDate(today);
  }, [today]);

  const handleSelectDate = useCallback(
    (date) => {
      const normalized = startOfDay(date);
      setSelectedDate(normalized);
      setVisibleMonth((prev) => {
        if (
          prev.getFullYear() === normalized.getFullYear() &&
          prev.getMonth() === normalized.getMonth()
        ) {
          return prev;
        }
        return startOfMonth(normalized);
      });
      setFormError('');
      setDayViewOpen(true);
    },
    [setSelectedDate, setVisibleMonth]
  );

  const handleAddEventClick = useCallback(() => {
    setFormError('');
    if (selectedDate) {
      setDayViewOpen(true);
      return;
    }
    const normalizedToday = today;
    setSelectedDate(normalizedToday);
    setVisibleMonth(startOfMonth(normalizedToday));
    setDayViewOpen(true);
  }, [selectedDate, setSelectedDate, setVisibleMonth, today]);

  const handleFormChange = useCallback(
    (event) => {
      const { name, value } = event.target;
      setFormError('');
      if (name === 'category') {
        setFormState((prev) => {
          const nextCategory = value;
          const nextMeta = categoryMap[nextCategory];
          const nextTitle =
            nextCategory === 'custom'
              ? prev.category === 'custom'
                ? prev.title
                : ''
              : nextMeta?.defaultTitle ?? prev.title ?? '';
          return {
            ...prev,
            category: nextCategory,
            title: nextTitle,
          };
        });
        return;
      }
      setFormState((prev) => ({ ...prev, [name]: value }));
    },
    [categoryMap]
  );

  const handleSubmitEvent = useCallback(
    (event) => {
      event.preventDefault();
      if (!selectedDateKey) {
        setFormError('Please pick a day from the calendar first.');
        return;
      }

      const { category, title, startTime, endTime } = formState;
      const trimmedTitle = title.trim();
      const categoryMeta = categoryMap[category];
      if (category === 'custom' && trimmedTitle.length === 0) {
        setFormError('Please provide a title when using the custom category.');
        return;
      }

      const { isValid, startMinutes, endMinutes, message } = validateTimeRange(
        startTime,
        endTime
      );

      if (!isValid) {
        setFormError(message ?? 'Please provide a valid time range.');
        return;
      }

      if (hasTimeCollision(dayEvents, startMinutes, endMinutes)) {
        setFormError('This time overlaps with an existing event.');
        return;
      }

      const resolvedTitle =
        trimmedTitle.length > 0
          ? trimmedTitle
          : categoryMeta?.defaultTitle || 'Untitled event';

      const normalizedStart = minutesToTimeString(startMinutes);
      const normalizedEnd = minutesToTimeString(endMinutes);

      const newEvent = {
        id: `${selectedDateKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: resolvedTitle,
        category,
        startTime: normalizedStart,
        endTime: normalizedEnd,
        startMinutes,
        endMinutes,
      };

      dispatchEvents({ type: 'add', payload: { dateKey: selectedDateKey, event: newEvent } });
      setFormError('');
      setFormState((prev) => {
        const base = {
          ...prev,
          startTime: normalizedStart,
          endTime: normalizedEnd,
        };
        if (category === 'custom') {
          return { ...base, title: '' };
        }
        return { ...base, title: categoryMeta?.defaultTitle ?? base.title };
      });
    },
    [categoryMap, dayEvents, dispatchEvents, formState, selectedDateKey]
  );

  const handleWeekStartChange = useCallback((event) => {
    setWeekStart(Number(event.target.value));
  }, []);

  return (
    <>
      <BackButton />
      <h1>Calendar</h1>
      <main className="calendar-page">
        <section className="calendar-main">
          <header className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-icon-button"
                aria-label="Go to previous month"
                onClick={() => handleMonthChange(-1)}
              >
                <Icon name="ChevronLeft" size={20} />
              </button>
              <div className="calendar-current-month" aria-live="polite">
                <span className="calendar-month-label">{monthLabel}</span>
                <span className="calendar-month-summary">
                  {daysInVisibleMonth} days
                </span>
              </div>
              <button
                type="button"
                className="calendar-icon-button"
                aria-label="Go to next month"
                onClick={() => handleMonthChange(1)}
              >
                <Icon name="ChevronRight" size={20} />
              </button>
            </div>
            <div className="calendar-toolbar-actions">
              <button
                type="button"
                className="calendar-action-button"
                onClick={handleToday}
              >
                Today
              </button>
              <button
                type="button"
                className="calendar-action-button calendar-action-button--primary"
                onClick={handleAddEventClick}
              >
                Add event
              </button>
              <label className="calendar-week-start">
                Week starts on
                <select
                  className="calendar-select"
                  value={weekStart}
                  onChange={handleWeekStartChange}
                >
                  {WEEK_START_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>
          <div
            className="calendar-grid"
            role="grid"
            aria-label={`Calendar for ${monthLabel}`}
          >
            <div className="calendar-grid-header" role="row">
              {weekdayLabels.map((weekday) => (
                <div
                  key={weekday.long}
                  className="calendar-weekday"
                  role="columnheader"
                  aria-label={weekday.long}
                >
                  {weekday.short}
                </div>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="calendar-week" role="row">
                {week.map((date) => {
                  const key = formatDateKey(date);
                  const eventsForDay = eventsByDate[key] ?? [];
                  const eventCount = eventsForDay.length;
                  const eventCountLabel =
                    eventCount > 0
                      ? `, ${eventCount} ${eventCount === 1 ? 'event' : 'events'} scheduled`
                      : '';
                  const inCurrentMonth =
                    date.getMonth() === visibleMonth.getMonth() &&
                    date.getFullYear() === visibleMonth.getFullYear();
                  const isToday = isSameDay(date, today);
                  const isSelected =
                    selectedDate != null && isSameDay(date, selectedDate);

                  const cellClassNames = [
                    'calendar-cell',
                    !inCurrentMonth && 'calendar-cell--outside',
                    isToday && 'calendar-cell--today',
                    isSelected && 'calendar-cell--selected',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  const label = `${fullDateFormatter.format(
                    date
                  )}${isToday ? ' (Today)' : ''}${eventCountLabel}`;

                  return (
                    <button
                      key={key}
                      type="button"
                      className={cellClassNames}
                      aria-pressed={isSelected}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={label}
                      onClick={() => handleSelectDate(date)}
                      data-date={key}
                    >
                      <span className="calendar-cell-day">{date.getDate()}</span>
                      {isToday && <span className="calendar-cell-badge">Today</span>}
                      {eventCount > 0 && (
                        <div className="calendar-cell-event-chips" aria-hidden="true">
                          {eventsForDay.slice(0, 3).map((eventItem) => {
                            const meta = categoryMap[eventItem.category];
                            const color = meta?.accent || '#9ca3af';
                            return (
                              <span
                                key={eventItem.id}
                                className="calendar-cell-event-chip"
                                style={{ '--event-chip-color': color }}
                                title={`${eventItem.title} • ${formatMinutesRange(
                                  eventItem.startMinutes,
                                  eventItem.endMinutes
                                )}`}
                              >
                                {meta?.label ?? 'Custom'}
                              </span>
                            );
                          })}
                          {eventCount > 3 && (
                            <span className="calendar-cell-event-chip calendar-cell-event-chip--count">
                              +{eventCount - 3}
                            </span>
                          )}
                        </div>
                      )}
                      <span className="visually-hidden">
                        {eventCount > 0
                          ? `${eventCount} ${eventCount === 1 ? 'event' : 'events'} scheduled`
                          : 'No events scheduled'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </main>
      {isDayViewOpen && (
        <div
          className="calendar-day-view-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-day-view-title"
          onMouseDown={handleOverlayClick}
        >
          <div
            className="calendar-day-view"
            ref={dayViewRef}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="calendar-day-view-header">
              <div className="calendar-day-view-header-text">
                <h2 id="calendar-day-view-title">Day planner</h2>
                <p className="calendar-day-view-subtitle">
                  {selectedDate ? selectedLabel : 'Pick a day to start planning.'}
                </p>
                {selectedDate && (
                  <p className="calendar-day-view-meta" role="status">
                    {relativeLabel} · {weekRangeLabel} · ISO {isoValue}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="calendar-day-view-close"
                onClick={handleCloseDayView}
                aria-label="Close day planner"
              >
                <Icon name="X" size={20} />
              </button>
            </header>
            <div className="calendar-day-view-body">
              <section className="calendar-day-view-schedule" aria-label="Hourly schedule">
                <h3 className="calendar-day-view-section-title">Schedule</h3>
                <p className="calendar-day-view-summary">
                  {dayEvents.length > 0
                    ? `${dayEvents.length} ${
                        dayEvents.length === 1 ? 'event' : 'events'
                      } scheduled`
                    : 'No events scheduled yet.'}
                </p>
                <div className="calendar-day-grid" role="list">
                  {hourSlots.map(({ hour, label }) => {
                    const eventsForHour = dayEvents.filter(
                      (eventItem) => Math.floor(eventItem.startMinutes / 60) === hour
                    );
                    return (
                      <div key={label} className="calendar-day-hour" role="listitem">
                        <span className="calendar-day-hour-label">{label}</span>
                        <div className="calendar-day-hour-events">
                          {eventsForHour.length === 0 ? (
                            <span className="calendar-day-hour-empty">—</span>
                          ) : (
                            eventsForHour.map((eventItem) => {
                              const meta = categoryMap[eventItem.category];
                              const chipColor = meta?.accent || '#9ca3af';
                              return (
                                <article
                                  key={eventItem.id}
                                  className="calendar-event-chip"
                                  style={{ '--event-chip-color': chipColor }}
                                >
                                  <header className="calendar-event-chip-header">
                                    <span className="calendar-event-chip-title">{eventItem.title}</span>
                                    <span className="calendar-event-chip-time">
                                      {formatMinutesRange(
                                        eventItem.startMinutes,
                                        eventItem.endMinutes
                                      )}
                                    </span>
                                  </header>
                                  <span className="calendar-event-chip-category">
                                    {meta?.label ?? 'Custom'}
                                  </span>
                                </article>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="calendar-day-view-form-section" aria-label="Add new event">
                <h3 className="calendar-day-view-section-title">Add event</h3>
                <form className="calendar-day-view-form" onSubmit={handleSubmitEvent}>
                  <div className="calendar-form-grid">
                    <label className="calendar-form-field">
                      <span className="calendar-form-label">Category</span>
                      <select
                        name="category"
                        className="calendar-select"
                        value={formState.category}
                        onChange={handleFormChange}
                      >
                        {EVENT_CATEGORIES.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="calendar-form-field">
                      <span className="calendar-form-label">Title</span>
                      <input
                        type="text"
                        name="title"
                        className="calendar-input"
                        value={formState.title}
                        onChange={handleFormChange}
                        placeholder={
                          formState.category === 'custom'
                            ? 'Describe your event'
                            : categoryMap[formState.category]?.defaultTitle || 'Event title'
                        }
                        required={formState.category === 'custom'}
                        aria-describedby={formError ? 'calendar-form-error' : undefined}
                        aria-invalid={formError ? true : undefined}
                      />
                    </label>
                    <label className="calendar-form-field">
                      <span className="calendar-form-label">Starts</span>
                      <input
                        type="time"
                        name="startTime"
                        className="calendar-input"
                        value={formState.startTime}
                        onChange={handleFormChange}
                        step="300"
                        aria-describedby={formError ? 'calendar-form-error' : undefined}
                        aria-invalid={formError ? true : undefined}
                      />
                    </label>
                    <label className="calendar-form-field">
                      <span className="calendar-form-label">Ends</span>
                      <input
                        type="time"
                        name="endTime"
                        className="calendar-input"
                        value={formState.endTime}
                        onChange={handleFormChange}
                        step="300"
                        aria-describedby={formError ? 'calendar-form-error' : undefined}
                        aria-invalid={formError ? true : undefined}
                      />
                    </label>
                  </div>
                  {formError && (
                    <p className="calendar-form-error" role="alert" id="calendar-form-error">
                      {formError}
                    </p>
                  )}
                  <div className="calendar-form-actions">
                    <button type="submit" className="calendar-action-button calendar-action-button--primary">
                      Save event
                    </button>
                    <button
                      type="button"
                      className="calendar-action-button"
                      onClick={() => {
                        setFormError('');
                        setFormState(createDefaultFormState(formState.category));
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
