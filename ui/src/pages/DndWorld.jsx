import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  {
    to: '/dnd/world/pantheon',
    icon: 'Sparkles',
    title: 'Pantheon',
    description: 'Gods, domains, and religious orders.',
  },
  {
    to: '/dnd/world/regions',
    icon: 'Map',
    title: 'Regions',
    description: 'Continents, nations, cities, and locales.',
  },
];

export default function DndWorld() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · World</h1>
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
