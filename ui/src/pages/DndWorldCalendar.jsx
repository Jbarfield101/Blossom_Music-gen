import { useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

const FR_MONTHS = [
  'Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn', 'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal',
];

const DEFAULT_STATE = { year: 1491, month: 0, day: 1 };

function clampDay(day, monthLen) {
  return Math.max(1, Math.min(monthLen, day));
}

function monthLength(_) {
  // Simplified FR: 30 days per month. Festivals omitted for now.
  return 30;
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

  const setYear = (y) => setState((s) => ({ ...s, year: y }));
  const setMonth = (m) => setState((s) => ({ ...s, month: Math.max(0, Math.min(FR_MONTHS.length - 1, m)), day: clampDay(s.day, monthLength(m)) }));
  const setDay = (d) => setState((s) => ({ ...s, day: clampDay(d, currentMonthLen) }));

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
      <main className="dashboard" style={{ padding: '1rem', display: 'grid', gap: 'var(--space-lg)' }}>
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
      </main>
    </>
  );
}

