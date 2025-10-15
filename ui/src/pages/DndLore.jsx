import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import './Dnd.css';

const sections = [
  { to: '/dnd/lore/secrets', icon: 'KeyRound', title: 'Known Secrets', description: 'Discoveries, rumors, and hidden truths. (WIP)' },
  { to: '/dnd/lore/journal', icon: 'Notebook', title: 'Journal Entries', description: 'Session notes and personal journals. (WIP)' },
  { to: '/dnd/lore/stories', icon: 'ScrollText', title: 'Stories & Legends', description: 'Chronicles of epic moments and table tales. (WIP)' },
  { to: '/dnd/lore/notes', icon: 'StickyNote', title: 'Loose Notes', description: 'Quick thoughts, sketches, and session scraps. (WIP)' },
  { to: '/dnd/lore/relations', icon: 'Users', title: 'Player Relations', description: 'Tracking bonds, rivalries, and party dynamics. (WIP)' },
  { to: '/dnd/lore/spellbook', icon: 'BookMarked', title: 'Spell Book', description: 'Catalog spells, incantations, and arcane research.' },
  { to: '/dnd/lore/races', icon: 'ScrollText', title: 'Races', description: 'Playable ancestries and cultural notes.' },
  { to: '/dnd/lore/classes', icon: 'Sword', title: 'Classes', description: 'Class features, variants, and notes.' },
  { to: '/dnd/lore/rules', icon: 'Scale', title: 'Rules', description: 'House rules, optional rules, clarifications.' },
  { to: '/dnd/lore/background-rules', icon: 'BookOpen', title: 'Backgrounds & Rules', description: 'Background options and table rules.' },
];

export default function DndLore() {
  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Lore</h1>
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
