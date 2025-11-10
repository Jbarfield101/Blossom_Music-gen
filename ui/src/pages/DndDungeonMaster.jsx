import { useCallback, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import { TAGS } from '../lib/dndTags.js';
import { rollDiceExpression } from '../lib/dice.js';
import './Dnd.css';

const sections = [
  {
    to: '/dnd/campaign-dashboard',
    icon: 'LayoutDashboard',
    title: 'Campaign Dashboard',
    description: 'Recent prep, quick creation shortcuts, and session overviews.',
  },
  {
    to: '/dnd/dungeon-master/events',
    icon: 'Calendar',
    title: 'Events',
    description: 'Session plans, timelines, and hooks.',
  },
  {
    to: '/dnd/dungeon-master/monsters',
    icon: 'Skull',
    title: 'Monsters',
    description: 'Bestiary and custom creature notes.',
  },
  {
    to: '/dnd/npc',
    icon: 'Users',
    title: 'NPCs',
    description: 'Quick access to important NPC notes.',
  },
  {
    to: '/dnd/dungeon-master/players',
    icon: 'User',
    title: 'Players',
    description: 'PC sheets, bonds, and party info.',
  },
  {
    to: '/dnd/dungeon-master/quests',
    icon: 'ScrollText',
    title: 'Quests',
    description: 'Active, pending, and completed quests.',
  },
  {
    to: '/dnd/dungeon-master/establishments',
    icon: 'Building',
    title: 'Establishments',
    description: 'Taverns, shops, and notable businesses.',
  },
  {
    to: '/dnd/dungeon-master/world-inventory',
    icon: 'Boxes',
    title: 'World Inventory',
    description:
      'Audit magical loot, provenance, attunement, and placement across the world.',
  },
  {
    to: '/dnd/dungeon-master/tag-manager',
    icon: 'Tags',
    title: 'Tag Manager',
    description: TAGS.join(' \u2022 '),
  },
];

export default function DndDungeonMaster() {
  const [diceExpression, setDiceExpression] = useState('1d20');
  const [diceHistory, setDiceHistory] = useState([]);
  const [diceError, setDiceError] = useState('');
  const latestRoll = diceHistory[0] ?? null;

  const handleRollDice = useCallback(
    (event) => {
      event.preventDefault();
      try {
        const expression = diceExpression.trim() || '1d20';
        const roll = rollDiceExpression(expression);
        const entry = {
          id: `roll-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          expression,
          total: roll.total,
          breakdown: roll.breakdown,
        };
        setDiceHistory((prev) => [entry, ...prev].slice(0, 5));
        setDiceError('');
      } catch (error) {
        setDiceError(error?.message || 'Unable to roll dice.');
      }
    },
    [diceExpression],
  );

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &mdash; Dungeon Master Hub</h1>
      <p className="dnd-intro">
        Jump into campaign prep tools, manage world notes, and find utilities tailored for your
        table.
      </p>
      <section className="dashboard dnd-card-grid">
        {sections.map(({ to, icon, title, description }) => (
          <Card key={to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </section>
      <section className="card dnd-dm-tools">
        <header className="dnd-dm-tools__header">
          <div>
            <h2>DM Tools</h2>
            <p className="card-caption">
              Quick helpers for live sessions. More utilities will appear here as they are ready.
            </p>
          </div>
        </header>
        <div className="dnd-dm-tools__grid">
          <article className="dnd-dm-tool-card">
            <div>
              <h3>Dice Roller</h3>
              <p className="card-caption">Use shorthand like 2d6+3 or d20-1.</p>
            </div>
            <form className="dnd-dice-form" onSubmit={handleRollDice}>
              <label className="dnd-dice-label">
                <span>Dice Expression</span>
                <input
                  type="text"
                  value={diceExpression}
                  onChange={(event) => {
                    setDiceExpression(event.target.value);
                    setDiceError('');
                  }}
                  placeholder="2d6+3"
                />
              </label>
              <PrimaryButton type="submit">Roll Dice</PrimaryButton>
            </form>
            {diceError && (
              <p className="card-caption" style={{ color: 'var(--accent)' }}>
                {diceError}
              </p>
            )}
            {latestRoll && (
              <div className="dnd-dice-result">
                <div className="dnd-dice-total">
                  <span className="card-caption">Result</span>
                  <strong>{latestRoll.total}</strong>
                  <span className="card-caption">{latestRoll.expression}</span>
                </div>
                <ul className="dnd-dice-breakdown">
                  {latestRoll.breakdown.map((segment, index) => {
                    const signSymbol = segment.sign === -1 ? '-' : '+';
                    if (segment.type === 'dice') {
                      return (
                        <li key={`${latestRoll.id}-dice-${index}`}>
                          <span>
                            {signSymbol}
                            {segment.expression}
                          </span>
                          <span>
                            [{segment.rolls.join(', ')}] = {segment.subtotal}
                          </span>
                        </li>
                      );
                    }
                    return (
                      <li key={`${latestRoll.id}-mod-${index}`}>
                        <span>Modifier</span>
                        <span>
                          {signSymbol}
                          {segment.value}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {diceHistory.length > 1 && (
              <div className="dnd-dice-history">
                <h4>Recent rolls</h4>
                <ul>
                  {diceHistory.slice(1).map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.expression}</span>
                      <strong>{entry.total}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        </div>
      </section>
    </>
  );
}
