import { useEffect, useMemo, useState, useCallback } from 'react';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const FR_MONTHS = [
  'Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn', 'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal',
];

const DEFAULT_STATE = { year: 1491, month: 0, day: 1 };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clampDay(day, monthLen) {
  return Math.max(1, Math.min(monthLen, day));
}

function monthLength(_) {
  // Simplified FR: 30 days per month. Festivals omitted for now.
  return 30;
}

// In FR simplified model (30-day months), each new month starts 2 weekdays later (30 % 7 == 2).
// Use a deterministic anchor so the grid looks like a real calendar.
function monthWeekdayOffset(year, month) {
  // Anchor: Year 1491, Hammer (0) starts on a Sunday (offset 0)
  // Each month shifts by 2 days of the week.
  const baseYear = 1491;
  const yearShift = ((year - baseYear) % 7 + 7) % 7; // keep stable even if not used
  const monthShift = (month * 2) % 7;
  return (0 + monthShift + yearShift) % 7;
}

function buildMonthGrid(year, month) {
  const daysInMonth = monthLength(month);
  const offset = monthWeekdayOffset(year, month); // 0..6, 0 means Sunday
  // total cells = 6 weeks x 7 to cover all cases
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const weeks = [];
  let current = 1 - offset;
  for (let w = 0; w < totalCells / 7; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      week.push(current);
      current += 1;
    }
    weeks.push(week);
  }
  return weeks; // numbers may be <=0 (prev month) or >daysInMonth (next month)
}

export default function DndWorldCalendar() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem('dndCalendarState');
      if (!raw) return DEFAULT_STATE;
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return DEFAULT_STATE;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('dndCalendarState', JSON.stringify(state)); } catch {}
  }, [state]);

  const currentMonthName = FR_MONTHS[state.month] || `Month ${state.month + 1}`;
  const currentMonthLen = useMemo(() => monthLength(state.month), [state.month]);
  const calendarWeeks = useMemo(() => buildMonthGrid(state.year, state.month), [state.year, state.month]);

  const setYear = (y) => setState((s) => ({ ...s, year: y }));
  const setMonth = (m) => setState((s) => ({ ...s, month: Math.max(0, Math.min(FR_MONTHS.length - 1, m)), day: clampDay(s.day, monthLength(m)) }));
  const setDay = (d) => setState((s) => ({ ...s, day: clampDay(d, currentMonthLen) }));

  const prevMonth = useCallback(() => {
    setState((s) => {
      let y = s.year; let m = s.month - 1; let d = s.day;
      if (m < 0) { m = FR_MONTHS.length - 1; y -= 1; }
      d = clampDay(d, monthLength(m));
      return { year: y, month: m, day: d };
    });
  }, []);

  const nextMonth = useCallback(() => {
    setState((s) => {
      let y = s.year; let m = s.month + 1; let d = s.day;
      if (m >= FR_MONTHS.length) { m = 0; y += 1; }
      d = clampDay(d, monthLength(m));
      return { year: y, month: m, day: d };
    });
  }, []);

  const advanceDays = (n) => {
    setState((s) => {
      let y = s.year; let m = s.month; let d = s.day + n;
      while (d > monthLength(m)) { d -= monthLength(m); m += 1; if (m >= FR_MONTHS.length) { m = 0; y += 1; } }
      while (d < 1) { m -= 1; if (m < 0) { m = FR_MONTHS.length - 1; y -= 1; } d += monthLength(m); }
      return { year: y, month: m, day: d };
    });
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Campaign Calendar</h1>
      <section className="dashboard" style={{ padding: '1rem', display: 'grid', gap: 'var(--space-lg)' }}>
        <section className="dnd-surface" aria-labelledby="calendar-current-heading">
          <div className="section-head">
            <div>
              <h2 id="calendar-current-heading">Current Date</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>Forgotten Realms month names, 30 days per month.</p>
            </div>
            <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => advanceDays(-7)}>-7d</button>
              <button type="button" onClick={() => advanceDays(-1)}>-1d</button>
              <button type="button" onClick={() => advanceDays(1)}>+1d</button>
              <button type="button" onClick={() => advanceDays(7)}>+7d</button>
            </div>
          </div>
          <div className="dnd-summary-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="dnd-summary-card">
              <div className="muted">Year</div>
              <input type="number" value={state.year} onChange={(e) => setYear(parseInt(e.target.value || '0', 10))} />
            </div>
            <div className="dnd-summary-card">
              <div className="muted">Month</div>
              <select value={state.month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
                {FR_MONTHS.map((name, idx) => (
                  <option value={idx} key={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="dnd-summary-card">
              <div className="muted">Day</div>
              <input type="number" min={1} max={currentMonthLen} value={state.day} onChange={(e) => setDay(parseInt(e.target.value || '1', 10))} />
            </div>
          </div>
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            {currentMonthName} {state.day}, DR {state.year}
          </div>
        </section>

        <section className="dnd-surface" aria-labelledby="calendar-month-heading">
          <div className="section-head">
            <div>
              <h2 id="calendar-month-heading">{currentMonthName} {state.year}</h2>
              <p className="muted" style={{ marginTop: '0.25rem' }}>30-day month grid (simplified Forgotten Realms).</p>
            </div>
            <div className="button-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={prevMonth} aria-label="Previous month">Prev</button>
              <button type="button" onClick={nextMonth} aria-label="Next month">Next</button>
            </div>
          </div>
          <div role="grid" aria-label={`Month grid for ${currentMonthName} ${state.year}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: '6px' }}>
            {WEEKDAYS.map((name) => (
              <div key={name} role="columnheader" className="muted" style={{ textAlign: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>{name}</div>
            ))}
            {calendarWeeks.map((week, wi) => (
              <div key={`w-${wi}`} role="row" style={{ display: 'contents' }}>
                {week.map((n, di) => {
                  const inMonth = n >= 1 && n <= currentMonthLen;
                  const isSelected = inMonth && n === state.day;
                  const baseStyle = {
                    position: 'relative',
                    minHeight: 100,
                    borderRadius: 10,
                    padding: '28px 10px 10px',
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    background: 'var(--panel)'
                  };
                  const style = {
                    ...baseStyle,
                    opacity: inMonth ? 1 : 0.5,
                    boxShadow: isSelected ? 'inset 0 0 0 2px var(--accent)' : 'none',
                  };
                  const handleClick = () => {
                    if (inMonth) {
                      setDay(n);
                    } else if (n < 1) {
                      prevMonth();
                      setTimeout(() => setDay(clampDay(monthLength((state.month + FR_MONTHS.length - 1) % FR_MONTHS.length) + n, monthLength((state.month + FR_MONTHS.length - 1) % FR_MONTHS.length))), 0);
                    } else {
                      nextMonth();
                      setTimeout(() => setDay(clampDay(n - currentMonthLen, monthLength((state.month + 1) % FR_MONTHS.length))), 0);
                    }
                  };
                  return (
                    <button key={`d-${wi}-${di}`} type="button" role="gridcell" onClick={handleClick} style={style} aria-pressed={isSelected} aria-current={isSelected ? 'date' : undefined}>
                      <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 12, fontWeight: 700, opacity: 0.8 }}>{inMonth ? n : (n < 1 ? (monthLength((state.month + FR_MONTHS.length - 1) % FR_MONTHS.length) + n) : (n - currentMonthLen))}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}
