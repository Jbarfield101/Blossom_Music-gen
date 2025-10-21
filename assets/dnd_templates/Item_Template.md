# 🗡️ ITEM v1.1 (AI-Ready)

---
id: item_<slug>_<hash>             # e.g., item_bloodreed_blade_4f9d
type: item
name: 
item_type:                         # weapon, relic, potion, charm, etc.
rarity: mundane | common | uncommon | rare | very-rare | legendary | artifact
category: []                       # weapon, armor, consumable, relic, etc.
tags: []                            # searchable terms (#swamp, #relic)
keywords: []                        # embedding hints for AI search
value_gp: 0
weight: 0
bulk: 0
owner_id: null                      # npc_* or player_*
container_id: null
location_id: null
set_id: null                        # if part of a set
quest_ids: []                       # crosslinks
attachments: []                     # gems, enchantments, runes, etc.
legal_status: legal | contraband | sacred | banned
risk: []                            # cursed, volatile, haunted, etc.

# Canon anchors (LLM must not drift)
canonical_summary: >                # 1–3 sentences defining its true nature
  ...
embedding_summary: >                # one paragraph for semantic search
  ...

# Public vs private
player_facing:                      # safe info at table
  - ...
gm_secrets:                         # hidden info for DM only
  - ...
refusal_rules:                      # roleplay guardrails
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".
  - If asked meta/OOR, defer: "Ask the DM."
  - If unsure, prefer mysterious or incomplete answers.

# Physical & magical state
attunement:
  required: false
  slots: 0
  bound_to: null
charges:
  max: 0
  current: 0
  recharge: null
durability:
  max: 0
  current: 0
  condition: pristine | worn | broken
session_state:
  visibility: visible                # visible / hidden / disguised
  condition_flags: []                # cursed, glowing, cracked, etc.
  last_interaction: 2025-10-21
  recent_events: []                  # short timestamped notes

# Effects & mechanics
mechanics:
  rules_text: ""                     # concise rules, damage, DCs, etc.
  dc: null
  damage: ""
  range: ""
  duration: ""
  properties: []                     # finesse, heavy, thrown, etc.
effects:
  - name: 
    description: 
    save_dc: null
    recharge: null

# Provenance & ledger
ledger:
  - date: YYYY-MM-DD
    action: created|transferred|used|broken|restored
    by: ""
    notes: ""

# World linkage
related_docs: []                     # region_*, npc_*, quest_*, etc.

# Media
art:
  icon: vault://images/items/<id>.png
  variants: []
music_cue_prompt: >
  ...

privacy: gm|player
---

## 🪶 Description
- **Short:** …
- **Lore (GM):** …

## ⚙️ Mechanics
(Rules text, effects, DCs, damage, recharge, etc.)

## ✨ Effects
- Name — what it does (any save/DC)

## 📜 Provenance (Ledger)
- YYYY-MM-DD — kind — by — notes

## 🕳️ GM Notes
(Identification DCs, false rumors, curses, hidden triggers.)

## 🖼️ Image
![[assets/items/{{id}}.png]]
