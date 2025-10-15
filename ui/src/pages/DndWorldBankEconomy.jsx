import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndWorldBankEconomy() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Bank Economy</h1>
      <section className="dashboard" style={{ padding: '1rem' }}>
        <div
          style={{
            background: 'var(--card-bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '1rem',
          }}
        >
          Chart the flow of wealth, set exchange rates, and plan the fiscal health of your world.
        </div>
      </section>
    </>
  );
}
