import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  { to: '/dnd/lore/secrets', icon: 'KeyRound', title: 'Known Secrets', description: 'Discoveries, rumors, and hidden truths. (WIP)' },
  { to: '/dnd/lore/journal', icon: 'Notebook', title: 'Journal Entries', description: 'Session notes and personal journals. (WIP)' },
];

export default function DndLore() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Lore</h1>
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
