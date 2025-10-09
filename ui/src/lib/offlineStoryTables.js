const TRAITS = [
  'Quick to laugh but slow to trust, with a knack for keeping morale high.',
  'Methodical and patient, always weighing every option before acting.',
  'Restless explorer who can never resist poking into a forgotten corner.',
  'Soft-spoken storyteller who prefers clever words to sharp steel.',
  'Keeps meticulous notes on every encounter and conversation.',
  'Brash confidence masking a deep concern for friends and innocents.',
  'Quiet observer who studies others to mirror their mannerisms when needed.',
  'Lives for the thrill of improvisation and daring gambles.',
  'Cheerfully optimistic, convinced that every setback hides an opportunity.',
  'Stoic guardian who rarely smiles but never abandons an ally.',
];

const IDEALS = [
  'Knowledge. Understanding the world is the surest path to guiding it toward a better future.',
  'Freedom. No chain, law, or tyrant will hold back those who yearn to choose their own fate.',
  'Justice. The wicked must be held to account, no matter how long the pursuit.',
  'Community. A strong hearth protects every soul within it, and I will keep that fire burning.',
  'Innovation. Bold experimentation pushes civilization forward one spark at a time.',
  'Tradition. The lessons of our ancestors keep us balanced amidst the chaos of change.',
  'Compassion. Strength exists to shelter the vulnerable and uplift the downtrodden.',
  'Balance. Light and shadow must remain in harmony, lest the world fall to ruin.',
  'Glory. Deeds worthy of song give purpose to the struggle of every day.',
  'Pragmatism. Lofty ideals falter without plans grounded in reality.',
];

const BACKSTORIES = [
  'Raised in a remote border village, they brokered peace between farmers and roaming spirits. When a new magistrate tried to tax the land into ruin, they left to gather allies who could defend the settlement.',
  'As an apprentice archivist in a floating academy, they uncovered a forbidden ledger detailing debts owed to trapped elementals. They now travel to free those beings and restore the balance of magic.',
  'Born into a mercantile dynasty, they sabotaged their own caravan to prevent a war-profiteering deal. Exiled for treason, they wander the realms exposing similar schemes.',
  'A former battlefield medic haunted by the ones they could not save, they now hunt relics rumored to mend even the deepest wounds.',
  'Once an entertainer aboard a traveling circus, they fled after witnessing a patron bargain away a child to fiends. They now weave glamours and blades to track the cult responsible.',
  'They served as a scout for a reclusive druid circle until a wildfire—set by careless nobles—devoured their forest. With the circle scattered, they roam to teach others how to respect the wilds.',
  'They were a scribe for the royal court who learned that the king had been replaced by an impostor. Armed with coded missives, they seek proof and allies to reclaim the throne.',
  'Growing up in the shadow of an ancient ruin, they accidentally awakened a sleeping guardian who marked them as its emissary. Their journey now follows whispers of forgotten oaths.',
  'They escaped an underground fighting pit with help from an unknown benefactor. Every town they visit holds another clue to that savior’s identity.',
  'They studied under a retired dragon slayer who vanished while chasing rumors of a resurgent wyrm. They continue the hunt, determined to finish what their mentor began.',
];

function pickRandom(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No offline entries available.');
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

export function sampleOfflineStory(kind) {
  switch (kind) {
    case 'traits':
      return pickRandom(TRAITS);
    case 'ideals':
      return pickRandom(IDEALS);
    case 'backstory':
      return pickRandom(BACKSTORIES);
    default:
      throw new Error(`Unsupported offline story kind: ${kind}`);
  }
}

export function offlineStoryHint(kind) {
  switch (kind) {
    case 'traits':
      return 'Suggestion sourced from offline personality tables.';
    case 'ideals':
      return 'Offline ideal tables provided this prompt.';
    case 'backstory':
      return 'Offline adventure hooks supplied this backstory.';
    default:
      return '';
  }
}
