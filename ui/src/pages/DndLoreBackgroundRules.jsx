import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndLoreBackgroundRules() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Backgrounds & Rules</h1>
      <section className="dashboard" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <section className="dnd-surface">
          <h2>Backgrounds & Table Rules</h2>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Capture background options, starting features, and any table-specific adjustments.
          </p>
          <p className="muted">Coming soon — indexing notes and quick reference.</p>
        </section>
      </section>
    </>
  );
}

