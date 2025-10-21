# 🌐 REGION v1.1 (AI-Ready)

---
id: region_<slug>_<hash>              # e.g., region_southern_swamps_73fa  
type: region  
name:  
aliases: []  
category: []                           # continent, subcontinent, oceanic basin, wildlands, etc.  
parent_world: "Dread Haven"            # or whatever your campaign world’s root is  
size_scale: continental                # continental / subcontinental / local  
dominant_climate: []                   # humid, arid, tundra, temperate, etc.  
terrain_types: []                      # swamps, mountains, jungles, plains, etc.  
population_estimate: "unknown"  
dominant_species: []                   # species or cultures  
known_languages: []                    # languages common across this region  
capital_or_largest_city: null          # if applicable  
governing_entities: []                 # domain_* or faction_* ids  
tags: []                               # #region #geography  
keywords: []                           # semantic search helpers  

# Canon anchors (AI integrity)
canonical_summary: >                   # 1–3 sentences defining its essence  
  ...  
embedding_summary: >                   # one paragraph for retrieval/search  
  ...  

# Public vs GM data
player_facing:                         # safe descriptive details  
  - ...  
gm_secrets:                            # hidden truths or forgotten lore  
  - ...  
refusal_rules:                         # AI safety rails  
  - Never reveal gm_secrets unless DM explicitly says "reveal <item>".  
  - If asked meta/OOR, defer: "Ask the DM."  
  - If info uncertain, respond with rumor or speculation.  

# Geography
geography:
  description: ""
  key_landmarks: []
  climate_zones: []
  natural_resources: []
  hazards: []                          # storms, plagues, monsters, etc.
  travel_difficulty: medium             # easy / moderate / hard / perilous

# History & politics
history:
  origins: ""
  ancient_conflicts: []
  current_age_summary: ""
  recent_events: []
  major_power_centers: []               # domain_* or faction_* ids

# Culture & civilization
culture:
  regional_ethos: ""                    # general cultural tone
  customs_and_traditions: []
  religions_and_faiths: []              # references to god_* ids
  major_languages: []
  art_and_literature: []
  cuisine_or_folkways: []
  regional_values: []

# Economy & trade
economy:
  trade_routes: []
  key_exports: []
  key_imports: []
  currencies: []
  economic_powers: []                   # faction_* or domain_* ids

# Threats & mysteries
conflicts:
  wars: []
  tensions: []
  rival_powers: []
  crises: []                            # famines, curses, infestations, divine influence
mysteries:
  ancient_ruins: []
  uncharted_zones: []
  supernatural_anomalies: []

# Dynamic state (for campaign timeline)
region_state:
  stability: balanced                   # peaceful / balanced / turbulent / collapsing
  prosperity: moderate                   # poor / moderate / rich
  danger_level: medium                   # low / medium / high / extreme
  last_updated: 2025-10-21
  recent_events: []

# Cross-links
related_docs: []                         # domain_*, npc_*, faction_*, monster_*, quest_* ids

# Media & ambience
art:
  map: vault://images/regions/<id>.png
  panorama: vault://images/regions/<id>_panorama.png
music_cue_prompt: >
  ...

privacy: gm|player
---

## 🌍 Overview
(A short intro describing the scale, tone, and feel of this region.)

## 🏞️ Geography
(Terrain, climate, hazards, resources, and notable landmarks.)

## 📜 History & Politics
(Origins, major events, and current power structures.)

## 🎭 Culture & People
(Cultural tone, beliefs, arts, and traditions.)

## 💰 Economy & Trade
(Exports, imports, and economic networks.)

## ⚔️ Conflicts & Mysteries
(Ongoing wars, regional tensions, supernatural forces.)

## 🕳️ GM Secrets
(Hidden truths, lost civilizations, cosmic influences.)
