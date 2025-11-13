import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { isTauri, invoke } from '@tauri-apps/api/core';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import EventModal from '../components/EventModal.jsx';
import './Calendar.css';

const WEEK_START_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const REMINDER_POLL_INTERVAL = 60_000;

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
    id: 'appointment',
    label: 'Appointment',
    accent: '#2563eb',
    defaultTitle: 'Appointment',
  },
  {
    id: 'chores',
    label: 'Chores',
    accent: '#dc2626',
    defaultTitle: 'Chore block',
  },
  {
    id: 'job',
    label: 'Job',
    accent: '#7c3aed',
    defaultTitle: 'Job shift',
  },
  {
    id: 'dnd',
    label: 'Dungeons and Dragons',
    accent: '#fb923c',
    defaultTitle: 'Dungeons & Dragons Session',
  },
  {
    id: 'dm-session',
    label: 'DM Session',
    accent: '#0ea5e9',
    defaultTitle: 'Dungeon Master Session',
  },
  {
    id: 'Blossom_Task',
    label: 'Blossom Task',
    accent: '#b14b67',
    defaultTitle: 'Blossom planning session',
  },
  {
    id: 'custom',
    label: 'Custom',
    accent: '#f59e0b',
    defaultTitle: '',
  },
];

function sanitizeCategory(value) {
  if (typeof value !== 'string') {
    return 'custom';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 'custom';
  }
  return EVENT_CATEGORIES.some((category) => category.id === trimmed)
    ? trimmed
    : 'custom';
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

function formatMinutesRange(startMinutes, endMinutes) {
  return `${minutesToTimeString(startMinutes)} – ${minutesToTimeString(endMinutes)}`;
}

const QUARTER_HOUR_MINUTES = 15;
const QUARTER_SLOTS_PER_DAY = (24 * 60) / QUARTER_HOUR_MINUTES;

function generateQuarterHourSlots() {
  return Array.from({ length: QUARTER_SLOTS_PER_DAY }, (_, index) => {
    const startMinutes = index * QUARTER_HOUR_MINUTES;
    const hours = Math.floor(startMinutes / 60)
      .toString()
      .padStart(2, '0');
    const minutes = String(startMinutes % 60).padStart(2, '0');
    const label = `${hours}:${minutes}`;
    return { index, label, startMinutes };
  });
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

function parseDateKey(dateKey) {
  if (typeof dateKey !== 'string') {
    return null;
  }
  const parts = dateKey.split('-');
  if (parts.length !== 3) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
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

function combineDateAndTime(dateKey, timeValue) {
  if (!dateKey || !timeValue) return null;
  const date = parseDateKey(dateKey);
  if (!date) return null;
  const [hoursStr, minutesStr] = timeValue.split(':');
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  const combined = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0);
  return combined.toISOString();
}

function normalizeEventRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const remoteId = Number.parseInt(record.id ?? record.remoteId, 10);
  if (!Number.isFinite(remoteId)) {
    return null;
  }
  const startRaw = record.start_time ?? record.startTime;
  if (typeof startRaw !== 'string' || !startRaw.trim()) {
    return null;
  }
  const startDate = new Date(startRaw);
  if (Number.isNaN(startDate.getTime())) {
    return null;
  }
  const endRaw = record.end_time ?? record.endTime;
  const endDate = endRaw ? new Date(endRaw) : null;
  const fallbackEnd = new Date(startDate.getTime() + 60 * 60 * 1000);
  const normalizedEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : fallbackEnd;
  const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
  const endMinutes = normalizedEnd.getHours() * 60 + normalizedEnd.getMinutes();
  const dateKey = formatDateKey(startDate);
  const reminderSeconds = Number.parseInt(record.reminder_offset ?? record.reminderOffset, 10);
  const reminderOffsetMinutes = Number.isFinite(reminderSeconds)
    ? Math.max(0, Math.floor(reminderSeconds / 60))
    : 0;
  const recurrenceValue =
    typeof record.recurrence === 'string' && record.recurrence.trim()
      ? record.recurrence.trim()
      : 'none';

  return {
    id: `event-${remoteId}-${dateKey}-${startMinutes}-${endMinutes}`,
    remoteId,
    title: record.title && typeof record.title === 'string' ? record.title.trim() || 'Untitled event' : 'Untitled event',
    description:
      record.description && typeof record.description === 'string'
        ? record.description
        : '',
    category: sanitizeCategory(record.status),
    dateKey,
    startTime: minutesToTimeString(startMinutes),
    endTime: minutesToTimeString(endMinutes),
    startMinutes,
    endMinutes,
    recurrence: recurrenceValue,
    reminderOffsetMinutes,
  };
}

function normalizeEventsByDate(records) {
  if (!Array.isArray(records)) {
    return {};
  }
  const byDate = {};
  records.forEach((record) => {
    const normalized = normalizeEventRecord(record);
    if (!normalized) return;
    if (!byDate[normalized.dateKey]) {
      byDate[normalized.dateKey] = [];
    }
    byDate[normalized.dateKey].push(normalized);
  });

  Object.keys(byDate).forEach((dateKey) => {
    byDate[dateKey].sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) {
        return a.startMinutes - b.startMinutes;
      }
      if (a.endMinutes !== b.endMinutes) {
        return a.endMinutes - b.endMinutes;
      }
      return a.id.localeCompare(b.id);
    });
  });

  return byDate;
}

function createDefaultEventDraft(dateKey, category = 'Blossom_Task') {
  const sanitizedCategory = sanitizeCategory(category);
  const meta = EVENT_CATEGORIES.find((item) => item.id === sanitizedCategory);
  return {
    title: sanitizedCategory === 'custom' ? '' : meta?.defaultTitle ?? 'Untitled event',
    description: '',
    category: sanitizedCategory,
    date: dateKey,
    startTime: '09:00',
    endTime: '10:00',
    recurrence: 'none',
    reminderOffsetMinutes: 0,
    remoteId: null,
  };
}

function getErrorMessage(error) {
  if (!error) return 'An unexpected error occurred.';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  return 'An unexpected error occurred.';
}

function serializeDraftToPayload(draft) {
  const titleText = draft.title?.trim() ?? '';
  const descriptionText = draft.description?.trim() ?? '';
  const reminderMinutes = Number.parseInt(draft.reminderOffsetMinutes, 10);
  const payload = {
    title: titleText || 'Untitled event',
    description: descriptionText || null,
    start_time: combineDateAndTime(draft.date, draft.startTime),
    end_time: combineDateAndTime(draft.date, draft.endTime),
    recurrence: draft.recurrence && draft.recurrence !== 'none' ? draft.recurrence : null,
    reminder_offset: Number.isFinite(reminderMinutes) ? Math.max(0, reminderMinutes) * 60 : 0,
    status: draft.category,
  };
  return payload;
}

export default function Calendar() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const [weekStart, setWeekStart] = useState(WEEK_START_OPTIONS[0].value);
  const [eventsByDate, setEventsByDate] = useState({});
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [isDayViewOpen, setDayViewOpen] = useState(false);
  const [isTauriEnv, setIsTauriEnv] = useState(false);
  const [modalState, setModalState] = useState({ open: false, mode: 'create', draft: null });
  const [mutationState, setMutationState] = useState({ submitting: false, deleting: false, error: '' });
  const [toasts, setToasts] = useState([]);
  const dayViewRef = useRef(null);
  const toastTimersRef = useRef(new Map());
  const reminderPollRef = useRef(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      toastTimersRef.current.forEach((timeoutId) => {
        if (typeof window !== 'undefined') {
          window.clearTimeout(timeoutId);
        }
      });
      toastTimersRef.current.clear();
      if (reminderPollRef.current && typeof window !== 'undefined') {
        window.clearTimeout(reminderPollRef.current);
      }
      reminderPollRef.current = null;
    };
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeoutId = toastTimersRef.current.get(id);
    if (timeoutId && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
    toastTimersRef.current.delete(id);
  }, []);

  const pushToast = useCallback(
    (message, tone = 'info') => {
      if (!message) return;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, message, tone }]);
      if (typeof window !== 'undefined') {
        const timeoutId = window.setTimeout(() => dismissToast(id), 6000);
        toastTimersRef.current.set(id, timeoutId);
      }
    },
    [dismissToast]
  );

  const fetchEvents = useCallback(async () => {
    if (!isTauriEnv) {
      setEventsLoading(false);
      return;
    }
    setEventsLoading(true);
    setEventsError('');
    try {
      const records = await invoke('list_events');
      if (!isMountedRef.current) return;
      setEventsByDate(normalizeEventsByDate(records));
    } catch (error) {
      if (!isMountedRef.current) return;
      setEventsError(getErrorMessage(error));
    } finally {
      if (isMountedRef.current) {
        setEventsLoading(false);
      }
    }
  }, [isTauriEnv]);

  useEffect(() => {
    let cancelled = false;
    async function detectEnvironment() {
      try {
        const available = await isTauri();
        if (cancelled || !isMountedRef.current) return;
        setIsTauriEnv(available);
        if (!available) {
          setEventsLoading(false);
          setEventsError('Calendar tools are available in the desktop app.');
        }
      } catch (error) {
        if (cancelled || !isMountedRef.current) return;
        setIsTauriEnv(false);
        setEventsLoading(false);
        setEventsError(getErrorMessage(error));
      }
    }
    detectEnvironment();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnv) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      await fetchEvents();
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauriEnv, fetchEvents]);

  useEffect(() => {
    if (!isTauriEnv) {
      return undefined;
    }
    let cancelled = false;
    async function pollReminders() {
      if (cancelled || !isMountedRef.current) {
        return;
      }
      try {
        const due = await invoke('check_reminders');
        if (!isMountedRef.current || cancelled) return;
        if (Array.isArray(due)) {
          due.forEach((event) => {
            const normalized = normalizeEventRecord(event);
            if (normalized) {
              pushToast(
                `Reminder: ${normalized.title} · ${formatMinutesRange(
                  normalized.startMinutes,
                  normalized.endMinutes
                )}`,
                'info'
              );
            } else if (event && typeof event.title === 'string') {
              pushToast(`Reminder: ${event.title}`, 'info');
            }
          });
        }
      } catch (error) {
        // Swallow polling errors to avoid spamming the UI.
      } finally {
        if (cancelled || !isMountedRef.current) return;
        if (typeof window !== 'undefined') {
          const timeoutId = window.setTimeout(pollReminders, REMINDER_POLL_INTERVAL);
          reminderPollRef.current = timeoutId;
        }
      }
    }

    pollReminders();

    return () => {
      cancelled = true;
      if (reminderPollRef.current && typeof window !== 'undefined') {
        window.clearTimeout(reminderPollRef.current);
      }
      reminderPollRef.current = null;
    };
  }, [isTauriEnv, pushToast]);

  const handleCloseDayView = useCallback(() => {
    setDayViewOpen(false);
    setModalState({ open: false, mode: 'create', draft: null });
    setMutationState({ submitting: false, deleting: false, error: '' });
  }, []);

  const updateSelectionToDate = useCallback(
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
      return normalized;
    },
    [setSelectedDate, setVisibleMonth]
  );

  const openCreateModal = useCallback(
    (dateKey) => {
      setModalState({ open: true, mode: 'create', draft: createDefaultEventDraft(dateKey) });
      setMutationState({ submitting: false, deleting: false, error: '' });
    },
    []
  );

  const openEditModal = useCallback((event) => {
    if (!event) return;
    setModalState({
      open: true,
      mode: 'edit',
      draft: {
        title: event.title,
        description: event.description ?? '',
        category: event.category,
        date: event.dateKey,
        startTime: event.startTime,
        endTime: event.endTime,
        recurrence: event.recurrence ?? 'none',
        reminderOffsetMinutes: event.reminderOffsetMinutes ?? 0,
        remoteId: event.remoteId,
      },
    });
    setMutationState({ submitting: false, deleting: false, error: '' });
  }, []);

  const handleMonthChange = useCallback(
    (direction) => {
      setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    },
    []
  );

  const handleToday = useCallback(() => {
    const normalizedToday = updateSelectionToDate(today);
    setDayViewOpen(true);
    openCreateModal(formatDateKey(normalizedToday));
  }, [openCreateModal, today, updateSelectionToDate]);

  const handleSelectDate = useCallback(
    (date) => {
      const normalized = updateSelectionToDate(date);
      setDayViewOpen(true);
      setModalState((prev) =>
        prev.open && prev.mode === 'create'
          ? prev
          : { open: false, mode: 'create', draft: createDefaultEventDraft(formatDateKey(normalized)) }
      );
    },
    [updateSelectionToDate]
  );

  const handleAddEventClick = useCallback(() => {
    const baseDate = selectedDate ?? today;
    const normalized = updateSelectionToDate(baseDate);
    setDayViewOpen(true);
    openCreateModal(formatDateKey(normalized));
  }, [openCreateModal, selectedDate, today, updateSelectionToDate]);

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
      const date = new Date(Date.UTC(2021, 7, 1 + weekStart + index, 12));
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

  const weekRange = useMemo(() => {
    if (!selectedDate) return null;
    const start = getStartOfWeek(selectedDate, weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }, [selectedDate, weekStart]);

  const weekRangeLabel = useMemo(() => {
    if (!weekRange) return '—';
    const sameYear = weekRange.start.getFullYear() === weekRange.end.getFullYear();
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

  const categoryMap = useMemo(
    () =>
      EVENT_CATEGORIES.reduce((acc, category) => {
        acc[category.id] = category;
        return acc;
      }, {}),
    []
  );

  const hourSlots = useMemo(() => generateQuarterHourSlots(), []);

  const dayEvents = selectedDateKey ? eventsByDate[selectedDateKey] ?? [] : [];

  const dayEventsBySlot = useMemo(() => {
    if (!dayEvents || dayEvents.length === 0) {
      return {};
    }
    return dayEvents.reduce((acc, eventItem) => {
      const rawIndex = Math.floor(eventItem.startMinutes / QUARTER_HOUR_MINUTES);
      const clampedIndex = Number.isFinite(rawIndex)
        ? Math.min(Math.max(rawIndex, 0), QUARTER_SLOTS_PER_DAY - 1)
        : null;
      if (clampedIndex == null) {
        return acc;
      }
      if (!acc[clampedIndex]) {
        acc[clampedIndex] = [];
      }
      acc[clampedIndex].push(eventItem);
      return acc;
    }, {});
  }, [dayEvents]);

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

  const handleSaveDraft = useCallback(
    async (draft) => {
      if (!isTauriEnv) {
        setMutationState((prev) => ({ ...prev, error: 'Desktop environment required.' }));
        return;
      }
      setMutationState((prev) => ({ ...prev, submitting: true, error: '' }));
      try {
        const payload = serializeDraftToPayload(draft);
        if (modalState.mode === 'edit' && draft.remoteId != null) {
          await invoke('update_event', { eventId: draft.remoteId, changes: payload });
          pushToast('Event updated.', 'success');
        } else {
          await invoke('create_event', { event: payload });
          pushToast('Event scheduled.', 'success');
        }
        await fetchEvents();
        setModalState({ open: false, mode: 'create', draft: null });
        setDayViewOpen(true);
      } catch (error) {
        setMutationState((prev) => ({ ...prev, error: getErrorMessage(error) }));
        return;
      } finally {
        setMutationState((prev) => ({ ...prev, submitting: false }));
      }
    },
    [fetchEvents, isTauriEnv, modalState.mode, pushToast]
  );

  const handleDeleteDraft = useCallback(
    async (draft) => {
      if (!isTauriEnv || !draft?.remoteId) {
        setMutationState((prev) => ({ ...prev, error: 'Unable to delete this event.' }));
        return;
      }
      const confirmDelete =
        typeof window !== 'undefined'
          ? window.confirm('Delete this event? This cannot be undone.')
          : true;
      if (!confirmDelete) {
        return;
      }
      setMutationState((prev) => ({ ...prev, deleting: true, error: '' }));
      try {
        await invoke('delete_event', { eventId: draft.remoteId });
        pushToast('Event deleted.', 'success');
        await fetchEvents();
        setModalState({ open: false, mode: 'create', draft: null });
      } catch (error) {
        setMutationState((prev) => ({ ...prev, error: getErrorMessage(error) }));
        return;
      } finally {
        setMutationState((prev) => ({ ...prev, deleting: false }));
      }
    },
    [fetchEvents, isTauriEnv, pushToast]
  );

  return (
    <>
      <div className="calendar-page">
        <header className="calendar-header">
          <BackButton to="/tools" label="Back to tools" />
          <div className="calendar-header-text">
            <h1 className="calendar-title">Calendar</h1>
            <p className="calendar-subtitle">
              Plan upcoming sessions, stay on top of rehearsals, and capture reminders.
            </p>
          </div>
        </header>
        <section className="calendar-main" aria-labelledby="calendar-heading">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-icon-button"
                aria-label="Previous month"
                onClick={() => handleMonthChange(-1)}
              >
                <Icon name="ChevronLeft" size={20} />
              </button>
              <div className="calendar-current-month">
                <span className="calendar-month-label" id="calendar-heading">
                  {monthLabel}
                </span>
                <span className="calendar-month-summary">
                  {eventsLoading ? 'Loading events…' : `${Object.keys(eventsByDate).length} days with plans`}
                </span>
              </div>
              <button
                type="button"
                className="calendar-icon-button"
                aria-label="Next month"
                onClick={() => handleMonthChange(1)}
              >
                <Icon name="ChevronRight" size={20} />
              </button>
            </div>
            <div className="calendar-toolbar-actions">
              <button type="button" className="calendar-action-button" onClick={handleToday}>
                Today
              </button>
              <label className="calendar-week-start">
                Week starts on
                <select
                  className="calendar-select"
                  value={weekStart}
                  onChange={(event) => setWeekStart(Number.parseInt(event.target.value, 10))}
                >
                  {WEEK_START_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="calendar-action-button calendar-action-button--primary"
                onClick={handleAddEventClick}
                disabled={eventsLoading || !isTauriEnv}
              >
                <Icon name="Plus" size={18} />
                Add event
              </button>
            </div>
          </div>
          {eventsError && (
            <div className="calendar-error" role="alert">
              {eventsError}
            </div>
          )}
          <section className="calendar-grid-section" aria-label="Month view">
            <div className="calendar-grid" role="grid" aria-label={`Calendar for ${monthLabel}`}>
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
                    const isSelected = selectedDate != null && isSameDay(date, selectedDate);

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
                                  {eventItem.title}
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
        </section>
      </div>
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
              <div className="calendar-day-view-header-actions">
                <button
                  type="button"
                  className="calendar-action-button"
                  onClick={handleAddEventClick}
                  disabled={!selectedDateKey || !isTauriEnv}
                >
                  <Icon name="Plus" size={16} />
                  New event
                </button>
                <button
                  type="button"
                  className="calendar-day-view-close"
                  aria-label="Close day planner"
                  onClick={handleCloseDayView}
                >
                  <Icon name="X" size={20} />
                </button>
              </div>
            </header>
            <div className="calendar-day-view-body">
              <section className="calendar-day-view-schedule" aria-label="Hourly schedule">
                <h3 className="calendar-day-view-section-title">Schedule</h3>
                <p className="calendar-day-view-summary">
                  {eventsLoading
                    ? 'Loading events…'
                    : dayEvents.length > 0
                    ? `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'} scheduled`
                    : 'No events scheduled yet.'}
                </p>
                <div className="calendar-day-grid" role="list">
                  {hourSlots.map(({ index, label }) => {
                    const eventsForSlot = dayEventsBySlot[index] ?? [];
                    return (
                      <div key={label} className="calendar-day-hour" role="listitem">
                        <span className="calendar-day-hour-label">{label}</span>
                        <div className="calendar-day-hour-events">
                          {eventsForSlot.length === 0 ? (
                            <span className="calendar-day-hour-empty">—</span>
                          ) : (
                            eventsForSlot.map((eventItem) => {
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
                                  {eventItem.description && (
                                    <p className="calendar-event-chip-description">
                                      {eventItem.description}
                                    </p>
                                  )}
                                  <footer className="calendar-event-chip-footer">
                                    <span className="calendar-event-chip-category">
                                      {meta?.label ?? 'Custom'}
                                    </span>
                                    <div className="calendar-event-chip-actions">
                                      <button
                                        type="button"
                                        className="calendar-event-chip-button"
                                        onClick={() => openEditModal(eventItem)}
                                        aria-label={`Edit ${eventItem.title}`}
                                      >
                                        <Icon name="PenLine" size={16} />
                                      </button>
                                      <button
                                        type="button"
                                        className="calendar-event-chip-button calendar-event-chip-button--danger"
                                        onClick={() => handleDeleteDraft({ ...eventItem })}
                                        aria-label={`Delete ${eventItem.title}`}
                                        disabled={mutationState.deleting}
                                      >
                                        <Icon name="Trash2" size={16} />
                                      </button>
                                    </div>
                                  </footer>
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
            </div>
          </div>
        </div>
      )}
      <EventModal
        open={modalState.open}
        mode={modalState.mode}
        draft={modalState.draft}
        categories={EVENT_CATEGORIES}
        onClose={() => setModalState({ open: false, mode: 'create', draft: null })}
        onSubmit={handleSaveDraft}
        onDelete={handleDeleteDraft}
        submitting={mutationState.submitting}
        deleting={mutationState.deleting}
        error={mutationState.error}
      />
      {toasts.length > 0 && (
        <div className="calendar-toast-region" role="status" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`calendar-toast calendar-toast--${toast.tone}`}>
              <span>{toast.message}</span>
              <button
                type="button"
                className="calendar-toast-dismiss"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <Icon name="X" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
