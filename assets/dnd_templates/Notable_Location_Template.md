# 🏙️ LOCATION v1.1 (AI-Ready)

---
id: location_<slug>_<hash>             # e.g., location_mistspire_keep_3af9
type: location
name: 
aliases: []
category: []                           # fortress, city, ruin, temple, landmark, etc.
region_id: null                        # region_* id
domain_id: null                        # domain_* id
associated_factions: []                # faction_* ids
constructed: ""                        # date, era, or unknown
primary_function: ""                   # seat of power, temple, trade hub, etc.
current_status: active                 # active / abandoned / ruined / cursed
tags: []                               # #location #region #faction
keywords: []                           # semantic search helpers

# Canon anchors (AI context integrity)
canonical_summary: >                   # 1–3 sentences: the immutable truth of this place
  ...
embedding_summary: >                   # one paragraph for retrieval/search
  ...

# Public vs private info
player_facing:
  - ...
gm_secrets:
  - ...
refusal_rules:
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".
  - If asked meta/OOR, defer: "Ask the DM."
  - If uncertain, describe atmosphere or rumor, not fact.

# Appearance & surroundings
appearance:
  exterior: ""
  interior: ""
  architecture_style: ""
  notable_features: []
geography:
  terrain: ""
  weather: ""
  nearby_settlements: []
  travel_difficulty: medium             # easy / medium / hard / perilous

# History & politics
history:
  founding: ""
  notable_events: []
  myths_and_legends: []
politics_and_culture:
  current_function: ""
  cultural_significance: []
  faction_influence: []
  governance_type: ""                   # council, lordship, priesthood, etc.

# Layout & defenses
layout:
  chambers:
    - name: ""
      purpose: ""
      description: ""
  hidden_areas: []
defenses_and_hazards:
  physical: []
  magical: []
  environmental: []

# Notable figures & NPCs
figures:
  rulers_or_leaders: []
  notable_npcs: []
  allies_and_enemies: []

# Encounters & hooks
encounters:
  combat: []
  exploration: []
  social: []

# Economy & resources
economy:
  exports: []
  resources: []
  trade_value: ""
  strategic_importance: ""

# Legends & mysteries
legends_and_mysteries:
  - ...
rumors:
  - ...

# Session / world state
session_state:
  political_state: stable               # stable / tense / collapsing
  prosperity: moderate                  # poor / moderate / rich
  danger_level: medium
  last_seen: 2025-10-21
  recent_events: []

# Cross-links
related_docs: []                        # npc_*, item_*, faction_*, quest_* ids

# GM notes
gm_notes:
  secrets: []
  quest_connections: []
  future_outcomes: []

# Media & ambience
art:
  image: vault://images/locations/<id>.png
  map: vault://images/locations/<id>_map.png
music_cue_prompt: >
  ...

privacy: gm|player
---

## 🧠 Overview
(A short sensory and atmospheric description.)

## 🏛️ Appearance & Structure
(Architecture, design, visual character, and scale.)

## 🏞️ Geography & Surroundings
(Location context, terrain, weather, nearby settlements.)

## 📜 History & Origins
(Founding, major events, myths, and legends.)

## ⚖️ Political & Cultural Role
(Current use, faction influence, and traditions.)

## 🧩 Layout & Defenses
(Interior structure, security, and hazards.)

## 👤 Notable Figures
(Rulers, guardians, cultists, NPCs tied to the site.)

## 🧭 Encounters & Hooks
(Combat, exploration, and social opportunities.)

## 💰 Economy & Resources
(Trade, exports, strategic value.)

## 🕯️ Legends & Mysteries
(Myths, rumors, and hidden truths.)

## 🕳️ GM Notes
(Secrets, prophecies, and what changes if conquered or destroyed.)
