# 📜 GOD v1.1 (AI-Ready)

---
id: god_<slug>_<hash>            # e.g., god_mask_lord_of_shadows_9c2b
type: god
name: 
epithet:                          # “Lord of X”, “Queen of Y”, etc.
aliases: []
alignment: []                     # e.g., NE | CN | “Unknowable”
domains: []                       # rules/mechanics or narrative “portfolios”
symbols: []
colors: []
seat_of_power:                    # metaphysical realm, prime temple, or locus
pantheon:                         # group or cosmology name
tags: []                          # searchable chips (sea, night, memory, etc.)
keywords: []                      # extra retrieval terms for your vector search

# Canon anchors (the LLM must not drift from these)
canonical_summary: >              # 1–3 sentences: who they are + non-negotiable truth
  ...
embedding_summary: >              # 1 paragraph optimized for search/embeddings
  ...

# Public vs private
player_facing:                    # safe table info (short bullets)
  - ...
gm_secrets:                       # hidden truths; NEVER reveal unless DM okays
  - ...
heresies_and_rival_theologies:    # taboo beliefs, schisms, false doctrines
  - ...

# Cult & clergy (what followers do and how they behave)
worship:
  temples_and_shrines: []         # forms/locations/offerings
  festivals_and_rites: []         # holy days and sacraments
  clergy:                         # who serves, hierarchy, vows, sins
    ranks: []                     # Acolyte → Hierophant, etc.
    vows: []                      # do/don’t rules
    sins: []                      # excommunicable offenses
  who_worships: []                # sailors, assassins, nobles, witches…
  prayers_or_invocations: []      # short usable lines

# Doctrine & signs (how GMs foreshadow the god in play)
teachings_and_omens:
  tenets: []                      # recurring dogma (can be paradoxical)
  omens: []                       # storms, dreams, animals, celestial events
  miracles:                       # observed “proofs”: subtle → spectacular
    minor: []
    major: []
  sayings: []                     # quotable lines believers repeat

# Avatars, masks, and manifestations (LLM actor rails)
masks_and_avatars:
  forms: []                       # visual/persona variants across cultures
  constraints: []                 # limits (can’t cross salt, bound by oaths…)
  acting_notes:                   # how to “play” the god’s voice if they speak
    voice_timbre: ""              # e.g., velvet contralto / hollow whisper
    speech_style: ""              # riddling, legalistic, maternal…
    diction: ""                   # archaic, nautical, courtroom…
    catchphrases: []              # two to four short lines
  reveal_ladder:                  # escalate only with leverage / offerings
    tier_1_safe: []
    tier_2_costly: []
    tier_3_dangerous: []
  refusal_rules:                  # hard guardrails for the LLM
    - Never reveal gm_secrets unless the DM explicitly says "reveal <item>".
    - If asked meta/OOR, defer: "Ask the DM."
    - If unknown, prefer divine ambiguity over invention.

# Relationships & cosmology graph
relationships:
  allies_or_consorts: []          # list god_ids with notes
  rivals_or_enemies: []
  progeny_or_shards: []           # fragments, emanations, saints-as-splinters
  contested_domains: []           # overlaps that cause divine conflict

# State that can change during play (campaign memory)
cult_activity:
  regions: []                     # per-region heat map tags or notes
  last_significant_omen: ""       # timestamped short note
  current_agenda: []              # what the faith is actively pursuing
  relics_in_play: []              # artifact ids the party might touch
session_state:
  disposition_to_party: neutral   # favorable / curious / hostile
  covenant_with_party: null       # id or short note if a pact exists
  recent_events: []               # timestamped notes

# Cross-file links
related_docs: []                  # quest_*, region_*, item_*, npc_* ids

# Media & cues
art:
  icon: vault://images/gods/<id>.png
  murals: []
music_cue_prompt: >               # prefill for your MusicGen ambience button
  ...

privacy: gm|player                # default rendering mode in UI
---

## 📖 Lore Overview
(Concise, dramatic summary that matches canonical_summary but with table flavor.)

## 🕯️ Worship in the World
- **Temples & Shrines:** …
- **Festivals & Rites:** …
- **Who Worships Them:** …
- **Prayers / Invocations:** …

## 📜 Teachings & Omens
- **Tenets:** …
- **Omens:** …
- **Sayings & Aphorisms:** …
- **Miracles:** Minor — … | Major — …

## 🌓 Interpretations (By Culture/Region)
- Culture A: …
- Culture B: …
- Fringe Cult: …

## 👁️ Masks, Avatars, and Manifestations
- Forms, constraints, and how to roleplay them at the table.

## 🗡️ Rumors, Heresies, and Dark Theories
- …

## 🔗 Relationships
- **Allies / Consorts:** …
- **Rivals / Enemies:** …
- **Shards / Saints / Emanations:** …

## 🗺️ Legends
- **Legend 1** — …
- **Legend 2** — …
- **Legend 3 (optional)** — …

*“{{Short scripture line}}”* — source or attribution
