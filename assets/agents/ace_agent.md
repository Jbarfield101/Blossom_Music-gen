# ACE-Agent Audio Prompt Engineering Guide

## Overview of ACE-Step for Audio Generation
ACE-Step is an open-source foundation model for AI-generated music and audio. It uses a hybrid of diffusion synthesis, autoencoding compression, and a lightweight transformer to generate full-length songs directly from text prompts. The model can create coherent melodies, harmonies, and rhythms that align with descriptive text, producing a four-minute track in roughly **20 seconds** on a high-end GPU.

ACE-Step was trained on a wide variety of textual prompts, including tags, captions, and descriptive sentences, making it capable of understanding both **simple tag prompts** (e.g., `hiphop, boom bap`) and **natural language prompts** describing emotion, scene, or purpose.

---

## Why Prompt Writing Matters
Prompts serve as musical instructions for the model. Specificity and clarity determine how well the generated audio fits your vision. Think of your prompt as a **virtual score** guiding an invisible composer. Detailed prompts lead to emotionally and structurally aligned results, while vague prompts lead to generic or mismatched output.

---

## Ingredients of an Effective Music Prompt
Each prompt should include multiple musical and emotional dimensions:

| Element | Description |
|----------|-------------|
| **Mood & Emotion** | Define emotional tone using adjectives (*melancholic, euphoric, dreamy, ominous*). |
| **Genre & Tempo** | State primary genre and optionally include BPM (*lofi chillhop at 70 BPM*). |
| **Instrumentation & Style** | List primary instruments and textures (*soft piano, vinyl crackle, ambient synths*). |
| **Structure & Progression** | Outline form (*verse/chorus/bridge*, *loopable 16 bars*). |
| **Reference or Comparison** | Mention artist or era influences (*inspired by Daft Punk’s Homework*). |
| **Usage Context** | Indicate intended use (*YouTube ambience, video game background, cinematic trailer*). |
| **Versioning & Output Format** | Specify length, file format, or number of variations (*3 versions, 60-second loops*). |

Use evocative adjectives over generic ones. For instance, “dusty nocturnal jazz” gives ACE-Step far more direction than “cool music.”

---

## Step-by-Step Prompt Construction
1. **Start Broad** — Begin with a core concept: “ambient track with piano and strings.”  
2. **Add Specifics** — Include structure and timing: “2-minute ambient piece, 60 BPM, piano–cello duet.”  
3. **Include Usage Context** — “For a cinematic short film’s closing credits.”  
4. **Reference Examples** — “In the style of Sigur Rós with a minimal ambient texture.”  
5. **Request Alternatives** — “Generate three variations: calm, emotional, and mysterious.”  
6. **Iterate and Refine** — Adjust tone, instruments, or tempo after listening to early outputs.  

Prompt chaining—reusing and refining prior prompts—helps guide the model through more complex iterations.

---

## Prompt Techniques and Best Practices
- **Lead with Action Verbs**: Use directives like *Compose*, *Generate*, or *Create*.
- **Assign Roles**: Frame the AI as a professional (“You are an expert jazz composer…”).
- **Break Tasks into Stages**: Request melody first, then lyrics or arrangement.
- **Balance Detail with Freedom**: Provide clear vision but leave room for AI interpretation.
- **Chain Prompts**: Iteratively refine genre, rhythm, or mix tone.
- **Stay Copyright-Safe**: Avoid referencing copyrighted melodies or lyrics when generating commercial works.

---

## ACE-Step Prompt Template
Use this flexible structure for composing clear prompts:

```
A [main concept] in [genre/style] featuring [instruments], evoking a [mood/emotion]
vibe inspired by [era/influence]. [Structure/progression details]. [Sound design or mix
notes]. [Tempo and duration].
```

### Example
> “A dreamy bedroom producer lullaby for stargazing in lo-fi chillwave with downtempo influence, featuring tape-warped electric piano, brushed drums, and gentle bass guitar. Evokes a nostalgic, bittersweet vibe inspired by mid-2000s indie electronica. Loopable 16-bar progression with vinyl crackle and airy reverb. 82 BPM, 60-second render.”

Use **comma-separated tags** for compact inputs (`hiphop, trap, east coast`) or **full sentences** for nuanced results.

---

## Controlling ACE-Step Outputs
ACE-Step allows fine control of parameters:

- **Duration & Mode**: Define total length and whether vocals should be included.
- **Mood/Genre Tags**: Use either natural language or short tags.
- **Seed Values**: Fix seed for reproducibility or vary for experimentation.
- **Denoising Strength**: Adjust for clarity or introduce creative noise.
- **Lyrics vs Instrumental**: Supply lyrics text if needed; omit for instrumental outputs.

---

## Lyric-Driven Prompt Guidance
For lyric-based tracks, structure prompts like song scripts:

- Label sections with square brackets: `[Verse 1]`, `[Chorus]`, `[Bridge]`.
- Use parentheses for backing vocals or production notes: `(whispered)`, `(reverb)`.
- Specify theme and emotion explicitly.
- Define vocal type (*female voice, whisper tone, deep baritone*).
- Add metatags for production: `[drop drums]`, `[echoed vocals]`, `[vinyl crackle]`.

### Example Structure
```
[Verse 1]
soft tones of memory drift through night air  
[Chorus]
we fade like echoes, still here somewhere  
(whispered backing vocals)
```

---

## Best Practices and Next Steps
- Begin with simple prompts and expand detail incrementally.
- Keep experimenting—adjust denoising, seed, or mix cues to refine tone.
- Combine AI and human artistry: treat ACE outputs as compositional drafts.
- Verify licensing before releasing AI-generated material.

By applying strong prompt engineering, you can harness ACE-Step to create expressive, genre-specific, and high-quality music aligned with your artistic goals.

