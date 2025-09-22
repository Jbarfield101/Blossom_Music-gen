import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndWorldFactions() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Factions</h1>
      <main className="dashboard" style={{ padding: '1rem' }}>
        <div
          style={{
            background: 'var(--card-bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '1rem',
          }}
        >
          Chronicle the influential factions, guilds, and secret societies that shape your world.
        </div>
      </main>
    </>
  );
}
