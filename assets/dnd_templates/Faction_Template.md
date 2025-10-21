# 🏰 FACTION v1.1 (AI-Ready)

---
id: faction_<slug>_<hash>          # e.g., faction_bloodreed_legion_7fa2
type: faction
name: 
aliases: []
category: []                        # guild, cult, noble house, military order, syndicate, alliance…
region: 
seat_of_power: 
founding_date: 
leader_ids: []                      # npc_* ids or null
symbols: []                         # icons, sigils, banners
colors: []
alignment_or_reputation: []
tags: []                             # #faction #region etc.
keywords: []                         # search/embedding helpers

# Canon anchors (LLM must not drift)
canonical_summary: >                 # 1–3 sentences: who they are + core truth
  ...
embedding_summary: >                 # 1 paragraph for search embedding
  ...

# Public vs private
player_facing:                       # safe info for players
  - ...
gm_secrets:                          # hidden truths; DM only
  - ...
refusal_rules:                       # roleplay guardrails
  - Never reveal gm_secrets unless DM explicitly says “reveal <item>”.
  - If asked for future plans, answer with plausible speculation or denial.
  - If meta or OOR, defer: “Ask the DM.”

# Lore & history
history:
  origins: ...
  rise_to_power: ...
  notable_events: []
  recent_activity: []

# Hierarchy & structure
organization:
  leadership_model: ""               # council, bloodline, merit, cult hierarchy
  ranks_and_roles: []                # e.g. initiate → captain → elder
  membership_requirements: []        # oaths, rites, dues
  internal_culture: []               # codes, sayings, rituals

# Goals & motives
objectives:
  short_term: []
  long_term: []
  hidden_agendas: []

# Methods & tactics
methods:
  political: []
  military: []
  magical_or_spiritual: []
  economic: []

# Resources & assets
resources:
  wealth: ""
  military_strength: ""
  magical_power: ""
  territories: []
  influence_networks: []

# Relationships & diplomacy
relationships:
  allies: []                         # faction_* or npc_* ids
  rivals: []
  vassals: []
  foreign_ties: []

# Culture & identity
culture:
  appearance_or_dress: []
  religion_or_beliefs: []
  festivals_or_rites: []
  values_and_taboos: []
  mottos: []

# Key members (link to NPC files)
notable_members:
  - npc_id: 
    name: 
    role: 
    traits: 
    status: active|dead|unknown

# Hooks & encounters
hooks:
  combat: []
  social: []
  exploration: []

# Rumors & legends
rumors: []
legends: []

# Dynamic world state
faction_state:
  influence_level: medium             # low/medium/high
  reputation: neutral                 # friendly/feared/hated
  territories_held: []
  current_operations: []
  last_seen: 2025-10-21
  recent_events: []                   # timestamped short notes

# Cross-links
related_docs: []                      # quest_*, region_*, npc_*, item_* ids

# Media & ambience
art:
  emblem: vault://images/factions/<id>.png
  banner: vault://images/factions/<id>_banner.png
music_cue_prompt: >
  ...

privacy: gm|player
---

## 🏷️ Overview
(Short summary of what the faction is, what it wants, and why it matters.)

## 📖 History
- Founding / Origins  
- Rise to Power  
- Notable Events  
- Recent Activity  

## 🧭 Hierarchy & Structure
(Describe leadership, ranks, initiation rites, internal culture.)

## 🎯 Goals & Motives
(Short-term, long-term, and hidden agendas.)

## ⚔️ Methods & Tactics
(Political, military, magical, and economic strategies.)

## 💰 Resources & Assets
(Wealth, armies, relics, territory, influence networks.)

## 🤝 Relationships
(Allies, rivals, vassals, foreign ties.)

## 🎭 Culture & Identity
(Symbols, beliefs, festivals, mottos, appearance.)

## 👤 Notable Members
(List of key NPCs, founders, or heroes.)

## 🧩 Encounters & Hooks
(Combat, social, or exploration-based ways players meet them.)

## 🕯️ Rumors & Legends
(Whispers, folk tales, and hidden truths.)

## 🕳️ GM Secrets
(Endgame motives, betrayals, and what happens if they win/fall.)
