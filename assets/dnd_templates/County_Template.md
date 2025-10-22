# 🏞️ COUNTY v1.1 (AI-Ready)

---
id: county_<slug>_<hash>               # e.g., county_blackfen_5f2a  
type: county  
name:  
aliases: []  
category: []                            # march, barony, county, prefecture, etc.  
region_id: null                         # region_* id  
domain_id: null                         # domain_* id  
seat_of_power: ""                       # main town or fortress  
capital: ""                             # administrative capital if different  
ruling_house: ""                        # noble family or witch-lord delegate  
governance_type: ""                     # hereditary / appointed / ecclesiastical / autonomous  
population: ""  
primary_species: []  
major_settlements: []                   # towns or villages within this county  
tags: []                                # #county #domain #politics  
keywords: []                            # for semantic search  

# Canon anchors
canonical_summary: >                    # 1–3 sentences defining its true role
  ...
embedding_summary: >                    # one paragraph optimized for retrieval
  ...

# Public vs GM data
player_facing:
  - ...
gm_secrets:
  - ...
refusal_rules:
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".
  - If asked meta/OOR, defer: "Ask the DM."
  - When uncertain, describe local rumor, not objective fact.

# Geography & settlements
geography:
  terrain: ""
  climate: ""
  borders: []                           # neighboring counties or domains
  natural_resources: []
  landmarks: []                         # rivers, woods, ruins, etc.
  travel_routes: []                     # roads, waterways, trade paths

settlements:
  - name: ""
    type: ""                            # town, village, fortress
    description: ""
    notable_features: []
    allegiance: ""                      # local lord or faction
    population: ""

# History & politics
history:
  founding: ""
  major_events: []
  recent_changes: ""
politics:
  current_ruler: ""
  vassals: []                           # minor nobles, barons, clergy
  rival_counties: []
  foreign_relations: []
  notable_laws: []

# Culture & society
culture:
  ethos: ""                             # values and customs
  festivals: []
  religion: []
  dress_and_symbolism: []
  sayings_or_mottos: []
  cuisine: []

# Economy
economy:
  exports: []
  imports: []
  industries: []
  trade_routes: []
  currency: ""
  taxation_policy: ""

# Military & defense
military:
  troop_count: 0
  composition: []                       # infantry, cavalry, witch-guards, militia
  fortifications: []
  notable_commanders: []
  alliances: []
  threats: []

# Legends & mysteries
legends:
  - ...
rumors:
  - ...

# Dynamic state
county_state:
  stability: balanced                   # stable / tense / collapsing
  prosperity: moderate                  # poor / moderate / rich
  unrest_level: low                     # low / medium / high
  danger_level: medium
session_state:
  last_updated: 2025-10-21
  recent_events: []

# Cross-links
related_docs: []                        # domain_*, region_*, faction_*, npc_*, quest_* ids

# GM notes
gm_notes:
  secrets: []
  plot_hooks: []
  consequences: []

# Media & ambience
art:
  map: vault://images/counties/<id>.png
  emblem: vault://images/counties/<id>_sigil.png
music_cue_prompt: >
  Low rustic strings mixed with distant drums and swamp winds, evoking weary governance amid decaying grandeur.

privacy: gm|player
---

## 🏰 Overview
(A concise description of the county’s geography, culture, and leadership.)

## 🌾 Geography & Settlements
(Key towns, landmarks, and natural features.)

## ⚖️ Politics & History
(Heritage, rulers, alliances, and rivalries.)

## 🎭 Culture & People
(Customs, religion, art, and daily life.)

## 💰 Economy & Trade
(Resources, industries, and trade routes.)

## 🛡️ Military & Defense
(Forces, fortifications, and threats.)

## 🕯️ Legends & Rumors
(Folk tales, hidden truths, and mysteries.)

## 🕳️ GM Notes
(Secrets, ongoing conflicts, and narrative triggers.)
