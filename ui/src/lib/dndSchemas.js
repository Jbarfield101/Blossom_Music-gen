import { z } from 'zod';

import { ENTITY_ID_PATTERN } from './dndIds.js';

const stringArray = z.array(z.string());

const ledgerEntrySchema = z
  .object({
    id: z.string().regex(ENTITY_ID_PATTERN),
    notes: z.string().optional(),
  })
  .strict()
  .partial({ notes: true });

const baseEntitySchema = z
  .object({
    id: z.string().regex(ENTITY_ID_PATTERN, 'Invalid entity id'),
    type: z.string().optional(),
    name: z.string().min(1).optional(),
  })
  .passthrough();

const voiceConfigSchema = z.union([
  z.string(),
  z
    .object({
      engine: z.string().optional(),
      preset: z.string().optional(),
      pitch: z.number().optional(),
      rate: z.number().optional(),
    })
    .partial()
    .strict(),
]);

const revealLadderSchema = z
  .object({
    tier_1_safe: stringArray.optional(),
    tier_2_costly: stringArray.optional(),
    tier_3_dangerous: stringArray.optional(),
  })
  .partial()
  .strict();

const stringOrStringArray = z.union([z.string(), stringArray]);
const stringOrNumber = z.union([z.string(), z.number()]);

const countySummarySchema = z
  .object({
    id: z.string().regex(ENTITY_ID_PATTERN).optional(),
    name: z.string().optional(),
    seat_of_power: z.string().optional(),
    population: stringOrNumber.optional(),
    allegiance: z.string().optional(),
    notes: z.string().optional(),
  })
  .partial()
  .strict();

const npcSchema = baseEntitySchema
  .extend({
    type: z.literal('npc').optional(),
    name: z.string().min(1, 'NPC name is required'),
    aliases: stringArray.optional(),
    titles: stringArray.optional(),
    importance: z.number().int().min(1).max(5).optional(),
    region: z.string().optional(),
    location: z.string().optional(),
    faction: z.string().optional(),
    role: z.string().optional(),
    tags: stringArray.optional(),
    keywords: stringArray.optional(),
    canonical_summary: z.string().optional(),
    embedding_summary: z.string().optional(),
    player_facing: stringArray.optional(),
    knowledge_scope: z
      .object({
        true_facts: stringArray.optional(),
        rumors_believed: stringArray.optional(),
        blindspots: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    gm_secrets: stringArray.optional(),
    relationship_ledger: z
      .object({
        allies: z.array(ledgerEntrySchema).optional(),
        rivals: z.array(ledgerEntrySchema).optional(),
        debts_owed_to_npc: z.array(ledgerEntrySchema).optional(),
        debts_owed_by_npc: z.array(ledgerEntrySchema).optional(),
      })
      .partial()
      .strict()
      .optional(),
    bargaining_chips: stringArray.optional(),
    voice: voiceConfigSchema.optional(),
    speech_style: z
      .object({
        timbre: z.string().optional(),
        pacing: z.string().optional(),
        dialect: z.string().optional(),
      })
      .partial()
      .strict()
      .optional(),
    acting_notes: z
      .object({
        demeanor: stringArray.optional(),
        body_language: stringArray.optional(),
        catchphrases: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    scene_behavior: z
      .object({
        default_goal: z.string().optional(),
        stall_tactics: stringArray.optional(),
        negotiation_tactics: stringArray.optional(),
        reveal_ladder: revealLadderSchema.optional(),
      })
      .partial()
      .strict()
      .optional(),
    refusal_rules: stringArray.optional(),
    session_state: z
      .object({
        mood: z.string().optional(),
        hp_status: z.string().optional(),
        conditions: stringArray.optional(),
        last_seen: z.string().optional(),
        recent_events: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    hooks: z
      .object({
        social: stringArray.optional(),
        exploration: stringArray.optional(),
        combat: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    stat_ref: z
      .object({
        cr_or_level: z.union([z.string(), z.number()]).optional(),
        ac: z.union([z.string(), z.number()]).optional(),
        hp: z.union([z.string(), z.number()]).optional(),
        notable_abilities: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    portrait: z.string().optional(),
    audio: z
      .object({
        theme: z.string().optional(),
        sfx: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    music_cue_prompt: z.string().optional(),
    privacy: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string().optional(),
  })
  .passthrough();

const questSchema = baseEntitySchema.extend({
  type: z.literal('quest').optional(),
});

const locationSchema = baseEntitySchema.extend({
  type: z.literal('loc').optional(),
});

const factionSchema = baseEntitySchema.extend({
  type: z.literal('faction').optional(),
});

const monsterSchema = baseEntitySchema.extend({
  type: z.literal('monster').optional(),
});

const encounterSchema = baseEntitySchema.extend({
  type: z.literal('encounter').optional(),
});

const sessionSchema = baseEntitySchema.extend({
  type: z.literal('session').optional(),
});

const domainSchema = baseEntitySchema
  .extend({
    type: z.literal('domain').optional(),
    aliases: stringArray.optional(),
    category: stringOrStringArray.optional(),
    affiliation: stringOrStringArray.optional(),
    seat_of_power: z.string().optional(),
    capital: z.string().optional(),
    population: stringOrNumber.optional(),
    primary_species: stringArray.optional(),
    ruler_id: z.string().optional(),
    tags: stringArray.optional(),
    keywords: stringArray.optional(),
    alignment_or_reputation: stringOrStringArray.optional(),
    canonical_summary: z.string().optional(),
    embedding_summary: z.string().optional(),
    player_facing: stringArray.optional(),
    gm_secrets: stringArray.optional(),
    refusal_rules: stringArray.optional(),
    geography: z
      .object({
        terrain: z.string().optional(),
        climate: z.string().optional(),
        landmarks: stringArray.optional(),
        hazards: stringArray.optional(),
        resources: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    history: z
      .object({
        founding: z.string().optional(),
        rise_to_power: z.string().optional(),
        major_events: stringArray.optional(),
        recent_history: z.string().optional(),
      })
      .partial()
      .strict()
      .optional(),
    politics: z
      .object({
        system_of_rule: z.string().optional(),
        ruling_factions: stringArray.optional(),
        laws_and_justice: stringArray.optional(),
        foreign_relations: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    administrative_divisions: z
      .object({
        counties: z.array(countySummarySchema).optional(),
        marches: stringArray.optional(),
        prefectures: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    culture: z
      .object({
        appearance_and_dress: stringArray.optional(),
        festivals_and_holidays: stringArray.optional(),
        religion_and_beliefs: stringArray.optional(),
        arts_and_entertainment: stringArray.optional(),
        daily_life: stringArray.optional(),
        values_and_taboos: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    economy: z
      .object({
        exports: stringArray.optional(),
        imports: stringArray.optional(),
        currency: z.string().optional(),
        industries: stringArray.optional(),
        trade_routes: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    military: z
      .object({
        standing_forces: z.string().optional(),
        special_units: stringArray.optional(),
        fortifications: stringArray.optional(),
        tactics_and_strategies: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    locations: z
      .object({
        capital_summary: z.string().optional(),
        secondary_settlements: stringArray.optional(),
        strongholds_or_sites: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    legends: stringArray.optional(),
    rumors: stringArray.optional(),
    relationships: z
      .object({
        allies: stringArray.optional(),
        rivals: stringArray.optional(),
        vassals: stringArray.optional(),
        foreign_ties: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    political_state: z
      .object({
        stability: z.string().optional(),
        prosperity: z.string().optional(),
        unrest_level: z.string().optional(),
      })
      .partial()
      .strict()
      .optional(),
    session_state: z
      .object({
        last_seen: z.string().optional(),
        recent_events: stringArray.optional(),
      })
      .partial()
      .strict()
      .optional(),
    related_docs: stringArray.optional(),
    art: z
      .object({
        map: z.string().optional(),
        counties_map: z.string().optional(),
        emblem: z.string().optional(),
      })
      .partial()
      .strict()
      .optional(),
    music_cue_prompt: z.string().optional(),
    privacy: z.string().optional(),
  })
  .passthrough();

export const npcCollectionSchema = z.array(npcSchema);
export const questCollectionSchema = z.array(questSchema);
export const locationCollectionSchema = z.array(locationSchema);
export const factionCollectionSchema = z.array(factionSchema);
export const monsterCollectionSchema = z.array(monsterSchema);
export const encounterCollectionSchema = z.array(encounterSchema);
export const sessionCollectionSchema = z.array(sessionSchema);
export const domainCollectionSchema = z.array(domainSchema);

export {
  npcSchema,
  questSchema,
  locationSchema,
  factionSchema,
  monsterSchema,
  encounterSchema,
  sessionSchema,
  domainSchema,
};
