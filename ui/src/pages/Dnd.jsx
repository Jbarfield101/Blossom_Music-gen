import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  {
    to: '/dnd/inbox',
    icon: 'Inbox',
    title: 'Inbox',
    description: 'Recently added or unfiled notes from your vault.',
  },
  {
    to: '/dnd/world',
    icon: 'Globe',
    title: 'World',
    description: 'Regions, locations, factions, and worldbuilding.',
  },
  {
    to: '/dnd/dungeon-master',
    icon: 'Crown',
    title: 'Dungeon Master',
    description: 'Session notes, encounters, initiatives, and tools.',
  },
  {
    to: '/dnd/assets',
    icon: 'Package',
    title: 'Assets',
    description: 'Images, maps, handouts, and reference materials.',
  },
  {
    to: '/dnd/lore',
    icon: 'BookOpen',
    title: 'Lore',
    description: 'Browse campaign lore entries gathered by Blossom.',
  },
  {
    to: '/dnd/tasks',
    icon: 'ListTodo',
    title: 'Tasks',
    description: 'Track campaign todos and session tasks.',
  },
  {
    to: '/dnd/whisper',
    icon: 'MessageCircle',
    title: 'Discord & Whisper',
    description: 'Set up Discord integrations and live transcription.',
  },
  {
    to: '/dnd/chat',
    icon: 'MessageSquare',
    title: 'Chat',
    description: 'Experiment with upcoming chat-based helpers.',
  },
];

export default function Dnd() {
  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons</h1>
      <section className="dashboard dnd-card-grid">
        {sections.map(({ to, icon, title, description }) => (
          <Card key={to} to={to} icon={icon} title={title}>
            {description}
          </Card>
        ))}
      </section>
    </>
  );
}
