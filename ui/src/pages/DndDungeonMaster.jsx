import BackButton from '../components/BackButton.jsx';
import Card from '../components/Card.jsx';
import { TAGS } from '../lib/dndTags.js';
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
    </>
  );
}
