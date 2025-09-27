import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndLoreClasses() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Classes</h1>
      <main className="dashboard" style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <section className="dnd-surface">
          <h2>Class Reference</h2>
          <p className="muted" style={{ marginTop: '0.25rem' }}>
            Centralize class features, subclass notes, and homebrew variants.
          </p>
          <p className="muted">Coming soon — indexing notes and quick reference.</p>
        </section>
      </main>
    </>
  );
}

