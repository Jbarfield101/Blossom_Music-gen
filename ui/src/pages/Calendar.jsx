import { useMemo, useState, useCallback } from 'react';
import BackButton from '../components/BackButton.jsx';
import Icon from '../components/Icon.jsx';
import './Calendar.css';

const WEEK_START_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;

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

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = startOfDay(date) - start;
  return Math.floor(diff / MS_IN_DAY);
}

function isLeapYear(year) {
  if (year % 4 !== 0) return false;
  if (year % 100 !== 0) return true;
  return year % 400 === 0;
}

export default function Calendar() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => today);
  const [weekStart, setWeekStart] = useState(WEEK_START_OPTIONS[0].value);

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

  const dayOfYear = useMemo(
    () => (selectedDate ? getDayOfYear(selectedDate) : null),
    [selectedDate]
  );
  const totalDaysInYear = useMemo(() => {
    if (!selectedDate) return null;
    return isLeapYear(selectedDate.getFullYear()) ? 366 : 365;
  }, [selectedDate]);
  const quarter = useMemo(
    () =>
      selectedDate != null
        ? Math.floor(selectedDate.getMonth() / 3) + 1
        : null,
    [selectedDate]
  );
  const isoValue = useMemo(() => {
    if (!selectedDate) return '—';
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, [selectedDate]);

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
    },
    [setSelectedDate, setVisibleMonth]
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
                  )}${isToday ? ' (Today)' : ''}`;

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
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <aside className="calendar-sidebar">
          <h2 className="calendar-sidebar-title">Date details</h2>
          {selectedDate ? (
            <>
              <p className="calendar-selected-label">{selectedLabel}</p>
              <dl className="calendar-detail-list">
                <div className="calendar-detail-item">
                  <dt className="calendar-detail-term">Relative</dt>
                  <dd className="calendar-detail-value">{relativeLabel}</dd>
                </div>
                <div className="calendar-detail-item">
                  <dt className="calendar-detail-term">Week range</dt>
                  <dd className="calendar-detail-value">{weekRangeLabel}</dd>
                </div>
                <div className="calendar-detail-item">
                  <dt className="calendar-detail-term">Day of year</dt>
                  <dd className="calendar-detail-value">
                    {dayOfYear != null && totalDaysInYear != null
                      ? `${dayOfYear} of ${totalDaysInYear}`
                      : '—'}
                  </dd>
                </div>
                <div className="calendar-detail-item">
                  <dt className="calendar-detail-term">Quarter</dt>
                  <dd className="calendar-detail-value">
                    {quarter != null ? `Q${quarter}` : '—'}
                  </dd>
                </div>
                <div className="calendar-detail-item">
                  <dt className="calendar-detail-term">ISO date</dt>
                  <dd className="calendar-detail-value">{isoValue}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="calendar-empty-state">
              Select any day in the grid to see more information.
            </p>
          )}
        </aside>
      </main>
    </>
  );
}
