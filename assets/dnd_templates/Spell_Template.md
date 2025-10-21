# ✴️ SPELL v1.1 (AI-Ready)

---
id: spell_<slug>_<hash>                # e.g., spell_blood_oath_binding_91fa
type: spell
name: 
aliases: []
school: ""                             # abjuration, necromancy, alchemy, pact-magic, etc.
level: 0                               # 0 (cantrip) to 9, or narrative tier
casting_time: ""                       # e.g., 1 action, 10 minutes, ritual
range: ""                              # self / touch / 30 ft / line of sight / special
duration: ""                           # instantaneous / concentration / sustained / permanent
components:
  verbal: true
  somatic: true
  material: ["a drop of blood", "a black reed"]
ritual: false
concentration: false
tags: []                               # #magic #ritual #blood_magic
keywords: []                           # search and AI retrieval
associated_class: []                   # e.g., wizard, witch-lord, cleric
domain_origin: null                    # domain_* id (where it originated)
region_origin: null                    # region_* id (e.g., Southern Swamps)
creator_id: null                       # npc_* id of spell's inventor

# Canon anchors
canonical_summary: >                   # 1–3 sentences: unchanging truth of the spell
  ...
embedding_summary: >                   # one paragraph: purpose, tone, and effect summary
  ...

# Public vs GM info
player_facing:
  - ...
gm_secrets:
  - ...
refusal_rules:
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".
  - If asked meta/OOR, defer: "Ask the DM."
  - When uncertain, describe visual/sensory magic effects, not precise mechanics.

# Spell effect details
mechanics:
  description: ""                      # concise gameplay explanation
  damage: ""                           # 3d8 fire / 2d10 necrotic / none
  saving_throw: ""                     # Con / Wis / Dex / Cha
  scaling: ""                          # how it increases with level or power
  conditions: []                       # prone, charmed, restrained, etc.
  area_of_effect: ""                   # radius, cone, cube, etc.
  secondary_effects: []                # extra effects after impact
  countermeasures: []                  # ways to resist or dispel

# Visuals & sensations
flavor:
  incantation: ""                      # spoken line or sound
  gestures: ""                         # hand or motion description
  visual_effects: ""                   # light, color, distortion, etc.
  auditory_effects: ""                 # ambient sounds, hums, whispers
  sensory_effects: ""                  # smells, temperature, physical sensations
  corruption_effects: ""               # long-term side effects or residue

# Lore & mythos
lore:
  origin_story: ""                     # how or why it was created
  notable_users: []                    # famous casters or historical events
  cultural_significance: []            # who uses or forbids it
  related_spells: []                   # similar spells or evolutions
  legends: []                          # myths or rumors about its misuse
  forbidden_texts: []                  # sources describing its creation or ban

# Materials & reagents
materials:
  required: []
  consumed: []
  rare_components: []
  substitutions: []

# Session / campaign state
session_state:
  availability: common                 # common / rare / unique / lost
  legal_status: restricted             # legal / restricted / forbidden / divine-right-only
  last_cast: 2025-10-21
  recent_usage_notes: []

# Cross-links
related_docs: []                       # item_*, npc_*, domain_*, quest_*, region_*

# Media & ambience
art:
  image: vault://images/spells/<id>.png
  sigil: vault://images/spells/<id>_sigil.png
music_cue_prompt: >
  Ambient hum of blood energy pulsing through water and whispering reeds.

privacy: gm|player
---

## 🪶 Description
(Brief sensory summary: what it looks and feels like when cast.)

## ⚙️ Mechanics
(Casting time, range, components, effects, damage, scaling.)

## 🔮 Lore & Origins
(Who invented it, what pact or event birthed it, where it was first used.)

## 🕯️ Myths & Legends
(Stories of its misuse or miracles tied to its casting.)

## 🧩 GM Notes
(Secrets, plot hooks, and conditions that alter the spell’s behavior.)
