import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

export default function DndDmPlayersHome() {
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('dnd.player.current');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setPlayer({
            name: String(parsed.name || 'Adventurer'),
            class: String(parsed.class || ''),
            level: Number(parsed.level || 1),
          });
        }
      }
    } catch {}
  }, []);

  const subtitle = useMemo(() => {
    if (!player) return 'Create and manage player characters.';
    const parts = [];
    if (player.class) parts.push(player.class);
    if (player.level) parts.push(`Level ${player.level}`);
    return parts.join(' · ');
  }, [player]);

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Players</h1>
      <main className="dashboard dnd-card-grid">
        {player ? (
          <Card to="/dnd/dungeon-master/players/sheet" icon="User" title={player.name}>
            {subtitle || 'Open character sheet'}
          </Card>
        ) : (
          <Card to="/dnd/dungeon-master/players/new" icon="Sparkles" title="Create a Player Character">
            Guided character creator with helpful explanations.
          </Card>
        )}

        {player && (
          <Card to="/dnd/dungeon-master/players/new" icon="Sparkles" title="Create a Player Character">
            Start a new character with a step-by-step wizard.
          </Card>
        )}

        <Card to="/dnd/dungeon-master/players/sheet" icon="FileEdit" title="Open Full Sheet">
          Edit all character fields directly.
        </Card>

        <Card to="#" icon="Info" title="Tips for Players">
          Use the guided creator to fill Identity → Abilities → Story. You can edit everything later in the full sheet.
        </Card>
      </main>
      <section className="dnd-surface" style={{ marginTop: 'var(--space-lg)' }}>
        <h2>What’s Different?</h2>
        <p className="muted">
          Instead of dropping directly into a dense sheet, begin with a guided flow. You can always switch to the full sheet to tweak advanced details.
        </p>
      </section>
    </>
  );
}

