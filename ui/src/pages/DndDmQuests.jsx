import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  { to: '/dnd/dungeon-master/quests/faction', icon: 'Shield', title: 'Faction Quests', description: 'Faction-driven objectives and arcs.' },
  { to: '/dnd/dungeon-master/quests/main', icon: 'Swords', title: 'Main Quests', description: 'Primary storyline and key beats.' },
  { to: '/dnd/dungeon-master/quests/personal', icon: 'UserRound', title: 'Personal Quests', description: 'Character-driven goals and threads.' },
  { to: '/dnd/dungeon-master/quests/side', icon: 'ScrollText', title: 'Side Quests', description: 'Optional tasks and diversions.' },
];

export default function DndDmQuests() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Quests</h1>
      <main className="dashboard dnd-card-grid">
        {sections.map(({ to, icon, title, description }) => (
          <Card key={to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </main>
    </>
  );
}
