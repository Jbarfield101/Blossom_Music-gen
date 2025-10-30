# 🏰 DOMAIN v1.2 (AI-Ready, with Counties)

---
id: domain_<slug>_<hash>              # e.g., domain_bloodreed_hold_8b2c
type: domain
name: 
aliases: []
category: []                           # kingdom, province, city-state, swamp dominion…
affiliation: []                        # empire, confederacy, alliance
seat_of_power: 
capital: 
population: 0
population_demographics:               # percentages must total 100
  - group: ""
    share: 0
ruler_id: null                         # npc_*, faction_*, or council identifier
tags: []                                # #domain #province #swamp
keywords: []                            # search/embedding terms
alignment_or_reputation: []             # lawful, cruel, prosperous, cursed…

# Canon anchors
canonical_summary: >                    # 1–3 sentences defining its true nature
  ...
embedding_summary: >                    # one paragraph for search embedding
  ...

# Public vs GM data
player_facing:                          # safe for players
  - ...
gm_secrets:                             # hidden truths; GM only
  - ...
refusal_rules:                          # LLM guardrails
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".
  - If asked meta/OOR, defer: "Ask the DM."
  - If uncertain, describe atmosphere or rumor, not confirmed fact.

# Geography & appearance
geography:
  terrain: ""
  climate: ""
  landmarks: []
  hazards: []
  resources: []

# History
history:
  founding: ""
  rise_to_power: ""
  major_events: []
  recent_history: ""

# Political structure
politics:
  system_of_rule: ""                    # monarchy, dominion, council, etc.
  ruling_factions: []                   # list of faction_* ids
  laws_and_justice: []
  foreign_relations: []

# 🧭 Administrative divisions (NEW)
administrative_divisions:
  counties:                             # list of county_* ids or inline objects
    - id: county_<slug>_<hash>
      name: ""
      seat_of_power: ""                 # chief town/fortress
      population: ""                    # or estimate
      allegiance: ""                    # house/faction
      notes: ""
    - id: county_<slug>_<hash>
      name: ""
      seat_of_power: ""
      population: ""
      allegiance: ""
      notes: ""
  # Optional: other sub-divisions like marches/prefectures
  marches: []
  prefectures: []

# Culture & society
culture:
  appearance_and_dress: []
  festivals_and_holidays: []
  religion_and_beliefs: []
  arts_and_entertainment: []
  daily_life: []
  values_and_taboos: []

# Economy
economy:
  exports: []
  imports: []
  currency: ""
  industries: []
  trade_routes: []

# Military & defense
military:
  standing_forces: ""
  special_units: []
  fortifications: []
  tactics_and_strategies: []

# Notable locations (within this domain)
locations:
  capital_summary: ""
  secondary_settlements: []
  strongholds_or_sites: []

# Legends & rumors
legends:
  - ...
rumors:
  - ...

# Relationships
relationships:
  allies: []
  rivals: []
  vassals: []                           # may include county_* rulers
  foreign_ties: []

# Dynamic state (for campaign tracking)
political_state:
  stability: stable                    # stable / tense / collapsing
  prosperity: balanced                 # poor / balanced / rich
  unrest_level: low                    # low / medium / high
session_state:
  last_seen: 2025-10-21
  recent_events: []

# Cross-links
related_docs: []                       # npc_*, faction_*, item_*, quest_*, county_* ids

# Media & ambience
art:
  map: vault://images/domains/<id>.png
  counties_map: vault://images/domains/<id>_counties.png
  emblem: vault://images/domains/<id>_emblem.png
music_cue_prompt: >
  ...

privacy: gm|player
---

## 🗺️ Overview
(A concise summary of geography, politics, and atmosphere.)

## 🏞️ Geography & Appearance
(Terrain, climate, landmarks, resources.)

## 📜 History
- Founding / Origins
- Rise to Power
- Major Events
- Recent History

## ⚖️ Political Structure
(System of rule, factions, laws, relations.)

## 🧭 Administrative Divisions
- **Counties:** List each county with seat, allegiance, and a one-line hook.
- **Other Subdivisions:** Marches, prefectures, etc., if relevant.

## 🎭 Culture & People
(Appearance, beliefs, festivals, arts, daily life.)

## 💰 Economy
(Exports, imports, industries, and trade.)

## 🛡️ Military & Defense
(Forces, tactics, fortifications.)

## 🏛️ Notable Locations
(Capital, major cities, sacred sites, ruins.)

## 🕯️ Legends & Lore
(Rumors, prophecies, and hidden truths.)

## 🕳️ GM Secrets
(Conspiracies, hidden rulers, ancient origins.)
