# 📜 NPC

---
id: npc_<slug>_<hash>            # e.g., npc_brakka_shortchange_voss_3f9a
type: npc
name: 
aliases: []
titles: []
importance: 3                     # 1 minor – 5 major
region: 
location:                         # city/settlement
faction: 
role:                             # bartender, fence, priest, etc.
tags: []                          # searchable chips (orc, gambler, witch-lord, etc.)
keywords: []                      # extra retrieval terms

# Canon anchors (the LLM should not drift from these)
canonical_summary: >              # 1–3 sentences: who they are + core truth
  ...
embedding_summary: >              # 1 paragraph used for search/embeddings
  ...

# Public vs private
player_facing:                    # safe to reveal at table (short bullets)
  - ...
knowledge_scope:                  # what THIS NPC actually knows (not omniscient)
  true_facts:
    - ...
  rumors_believed:
    - ...
  blindspots:
    - ...
gm_secrets:                       # hidden truths; NEVER reveal unless DM okays
  - ...

# Relationships & leverage
relationship_ledger:
  allies: []                      # list npc_ids with notes
  rivals: []
  debts_owed_to_npc: []           # who owes THEM, why, for how much
  debts_owed_by_npc: []           # what THEY owe, to whom
bargaining_chips:                 # concrete things they can trade or threaten
  - ...

# Performance & behavior (LLM actor rails)
voice:
  engine: piper                   # or elevenlabs
  preset: ""                      # exact preset name you use
  pitch: 0
  rate: 1.0
speech_style:
  timbre: ""                      # e.g., gravelly baritone
  pacing: ""                      # clipped / languid / singsong
  dialect: ""                     # coastal, nordic, etc.
acting_notes:
  demeanor: []                    # calm, sly, theatrical...
  body_language: []               # leans in, taps ring, avoids eye contact
  catchphrases: []                # short lines the model can reuse
scene_behavior:
  default_goal: ""                # what they try to achieve in most scenes
  stall_tactics: []               # how they buy time or avoid answers
  negotiation_tactics: []         # trade, test, intimidate, guilt...
  reveal_ladder:                  # escalating disclosures; advance only with leverage
    tier_1_safe: []
    tier_2_costly: []
    tier_3_dangerous: []
refusal_rules:                    # hard guardrails for the LLM
  - Never reveal gm_secrets unless the DM explicitly says "reveal <item>".
  - If asked OOR/meta rules, defer: "Ask the DM."
  - If asked for unknown facts, answer with plausible ignorance, not invention.

# State that can change during play
session_state:
  mood: neutral                   # neutral / irritated / amused / fearful
  hp_status: healthy              # healthy / wounded / critical
  conditions: []                  # poisoned, charmed, etc.
  last_seen: 2025-10-16
  recent_events: []               # timestamped short notes
hooks:
  social: []                      # how to earn trust (oath/gift/favor)
  exploration: []                 # places or clues tied to them
  combat: []                      # tactics, terrain they abuse, how they flee

# Crunch reference (optional minimal)
stat_ref:
  cr_or_level: 
  ac: 
  hp: 
  notable_abilities: []

# Media & cues
portrait: vault://images/npc/<id>.png
audio:
  theme: vault://audio/npc/<id>/theme.mp3
  sfx: []                         # e.g., coin clink, crowd murmur
music_cue_prompt: >               # prefill for your MusicGen "ambience" button
  ...

privacy: gm|player                # default rendering mode in UI
---

## 👁️ Appearance
- ...

## 🧠 Personality
- **Traits:** ...
- **Ideals:** ...
- **Bonds:** ...
- **Flaws:** ...
- **Quirks:** ...

## 🗣️ Roleplay One-Liners (ready to speak)
- "..."
- "..."
- "..."

## 🧭 Scene Beats
- **If PCs are strangers:** ...
- **If PCs offer payment:** ...
- **If threatened:** ...
- **If shown proof/secret:** ...

## 🕳️ GM Secrets (expanded)
- ...

## 🗺️ History (short)
- Origins:
- Notable Deeds:
- Current Agenda:

## 🎯 If Dice Say…
- **Social success (DC …):** they reveal: …
- **Social failure:** they demand: …
- **Intimidation success:** …
- **Perception success near them:** …

