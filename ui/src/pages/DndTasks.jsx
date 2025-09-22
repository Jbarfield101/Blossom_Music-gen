import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndTasks() {
  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons · Tasks</h1>
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
          Under construction
        </div>
      </main>
    </>
  );
}

