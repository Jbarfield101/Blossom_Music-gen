import test from 'node:test';
import assert from 'node:assert/strict';

import { npcSchema } from '../src/lib/dndSchemas.js';

test('npcSchema rejects NPCs without an id', () => {
  const result = npcSchema.safeParse({
    type: 'npc',
    name: 'Vorra',
  });
  assert.equal(result.success, false);
});

test('npcSchema accepts template-aligned NPCs', () => {
  const payload = {
    id: 'npc_acolyte-vorra_7c2e',
    type: 'npc',
    name: 'Acolyte Vorra',
    aliases: ['Vorra the Acolyte'],
    titles: ['Watcher of the Gate'],
    importance: 3,
    region: 'Dreadhaven',
    location: 'Sanctum of Echoes',
    faction: 'Order of Dusk',
    role: 'Acolyte',
    tags: ['acolyte', 'ritualist'],
    keywords: ['vorra', 'sanctum'],
    canonical_summary: 'Vorra safeguards the Sanctum of Echoes.',
    embedding_summary: 'A dedicated ritualist who maintains the Sanctum wards.',
    player_facing: ['Stoic and guarded, but respectful to clerics.'],
    knowledge_scope: {
      true_facts: ['Knows the Sanctum guard rotations.'],
      rumors_believed: ['Believes the wards are failing.'],
      blindspots: ['Unaware of the hidden passage.'],
    },
    gm_secrets: ['Vorra works for a rival faction.'],
    relationship_ledger: {
      allies: [{ id: 'npc_master-ila_8ab3', notes: 'Mentor' }],
      rivals: ['npc_shadow-broker_44df'],
      debts_owed_to_npc: [],
      debts_owed_by_npc: [],
    },
    bargaining_chips: ['Control over the Sanctum wards.'],
    voice: {
      engine: 'piper',
      preset: 'solemn-toned',
      pitch: 0,
      rate: 1,
    },
    speech_style: {
      timbre: 'smooth',
      pacing: 'measured',
      dialect: 'coastal',
    },
    acting_notes: {
      demeanor: ['calm'],
      body_language: ['hands clasped'],
      catchphrases: ['The wards must hold.'],
    },
    scene_behavior: {
      default_goal: 'Keep outsiders calm.',
      stall_tactics: ['Offer blessings.'],
      negotiation_tactics: ['Invoke duty.'],
      reveal_ladder: {
        tier_1_safe: ['Shares basic sanctum lore.'],
        tier_2_costly: ['Reveals the ward fracture.'],
        tier_3_dangerous: ['Names the saboteur.'],
      },
    },
    refusal_rules: ['Never reveal GM secrets without approval.'],
    session_state: {
      mood: 'neutral',
      hp_status: 'healthy',
      conditions: [],
      last_seen: '2025-10-16',
      recent_events: ['2025-10-15: Assisted the PCs.'],
    },
    hooks: {
      social: ['Bring an offering to gain audience.'],
      exploration: ['Seek the hidden passage with Vorra.'],
      combat: ['Disrupt rituals to weaken Vorra.'],
    },
    stat_ref: {
      cr_or_level: '5',
      ac: 14,
      hp: '38',
      notable_abilities: ['Channel Divinity'],
    },
    portrait: 'vault://images/npc/npc_acolyte-vorra_7c2e.png',
    audio: {
      theme: 'vault://audio/npc/npc_acolyte-vorra_7c2e/theme.mp3',
      sfx: ['chanting'],
    },
    music_cue_prompt: 'Somber ritual tones.',
    privacy: 'gm',
    description: 'Guardian of the Sanctum.',
    prompt: 'You are Vorra, steadfast guardian of the Sanctum.',
  };

  const result = npcSchema.safeParse(payload);
  assert.equal(result.success, true, result.success ? undefined : result.error.message);
  assert.equal(result.success && result.data.id, payload.id);
});
