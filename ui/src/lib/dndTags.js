import sections from './dndTagSections.json';

export const TAG_SECTIONS = sections.map((section) => ({
  ...section,
  tags: Array.isArray(section.tags) ? [...section.tags] : [],
  includes: Array.isArray(section.includes) ? [...section.includes] : [],
  fallbacks: Array.isArray(section.fallbacks) ? [...section.fallbacks] : [],
}));

export const TAGS = [
  'NPCs',
  'Pantheon',
  'Monsters',
  'Quests',
  'Factions',
  'Regions',
  'Locations',
  'Items',
  'Events',
  'Lore',
  'Rumors',
  'Encounters',
  'Treasures',
  'Downtime',
  'Worldbuilding',
];

export const CANONICAL_TAGS = Array.from(
  new Set(TAG_SECTIONS.flatMap((section) => section.tags || [])),
).sort();

export default TAGS;
