import { useCallback, useEffect, useState } from 'react';
import { listLore } from '../api/lore';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndLore() {
  const [lore, setLore] = useState([]);
  const [loreLoading, setLoreLoading] = useState(false);
  const [loreError, setLoreError] = useState('');
  const [loreLoaded, setLoreLoaded] = useState(false);

  const fetchLore = useCallback(async () => {
    setLoreLoading(true);
    setLoreError('');
    try {
      const items = await listLore();
      setLore(Array.isArray(items) ? items : []);
      setLoreLoaded(true);
    } catch (err) {
      console.error(err);
      setLoreError(err?.message || String(err));
      setLoreLoaded(false);
    } finally {
      setLoreLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLore();
  }, [fetchLore]);

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; Lore</h1>
      <div className="dnd-lore">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          <button type="button" onClick={fetchLore} disabled={loreLoading}>
            {loreLoading ? 'Loading...' : 'Refresh'}
          </button>
          {loreLoading && <span>Loading lore...</span>}
        </div>
        {loreError && (
          <div className="warning" style={{ marginBottom: '1rem' }}>
            <div>Failed to load lore: {loreError}</div>
            <button type="button" onClick={fetchLore} disabled={loreLoading}>
              Try again
            </button>
          </div>
        )}
        {!loreLoading && !loreError && loreLoaded && lore.length === 0 && (
          <p>No lore entries found.</p>
        )}
        {lore.length > 0 && (
          <ul
            style={{
              display: 'grid',
              gap: '1rem',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {lore.map((item) => (
              <li
                key={item.path || item.title}
                style={{
                  background: '#111827',
                  borderRadius: '12px',
                  padding: '1rem',
                  border: '1px solid #1f2937',
                }}
              >
                <h3 style={{ margin: '0 0 0.5rem' }}>{item.title}</h3>
                {item.summary ? (
                  <p style={{ margin: 0 }}>{item.summary}</p>
                ) : (
                  <p style={{ margin: 0, fontStyle: 'italic', opacity: 0.8 }}>
                    No summary available.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
