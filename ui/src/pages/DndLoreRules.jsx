import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndLoreRules() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Rules</h1>
      <section className="dashboard" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <section className="dnd-surface">
          <h2>Rules & Clarifications</h2>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Track house rules, optional modules, and frequently referenced rulings.
          </p>
          <p className="muted">Coming soon — indexing notes and quick reference.</p>
        </section>
      </section>
    </>
  );
}

