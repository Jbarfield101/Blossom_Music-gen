import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  {
    to: '/dnd/lore',
    icon: 'BookOpen',
    title: 'Lore',
    description: 'Browse campaign lore entries gathered by Blossom.',
  },
  {
    to: '/dnd/npcs',
    icon: 'Users',
    title: 'NPCs',
    description: 'Create, edit, and manage your non-player characters.',
  },
  {
    to: '/dnd/piper',
    icon: 'Mic2',
    title: 'Piper',
    description: 'Discover voices and synthesize dialogue for your stories.',
  },
  {
    to: '/dnd/discord',
    icon: 'MessageCircle',
    title: 'Discord',
    description: 'Set up Discord integrations for your campaign.',
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
