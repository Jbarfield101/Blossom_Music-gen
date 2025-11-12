# Qwen-Agent Prompt Engineering Guide

## Introduction
Qwen-Image is a text-to-image model that interprets full sentences, understanding natural language context, relationships, and layout cues. This allows you to describe what you want in plain language rather than relying on keyword lists. The best results come from well-structured prompts combined with proper parameter settings.

---

## Positive Prompt Engineering

### Key Principles
- **Use natural language**: Write full sentences or descriptive phrases instead of keyword chains. Qwen’s language backbone understands grammar and meaning.
- **Structure your prompt**: Begin with the *main subject*, then add the *setting/environment*, *style/medium*, *lighting/effects*, and any *exact text* in quotes.
- **Concise but detailed**: 1–3 sentences are ideal. Include important details (e.g., age, ethnicity, expression, clothing) and describe scenes as subject + background + secondary objects.
- **Quote exact text**: Surround specific words you want rendered with quotation marks, and specify font or color if needed.
- **Use style and mood descriptors**: Include terms like *photorealistic*, *watercolor*, *anime*, *dramatic*, *dreamy*, etc. Add technical cues like camera angles, lenses, or lighting.
- **Weighted elements**: Emphasize parts of a scene with weights — e.g., `(mountains:1.5)`, `(lake:1.2)`.

### Parameter Tuning
- **Steps**: 20–30 for previews, ~50 for finals.
- **CFG Scale**: Around 4–5 for a balance between creativity and prompt adherence.
- **Seed**: Fixing it ensures reproducible results.

---

## Negative Prompt Engineering
Negative prompts define what *not* to include. They are optional but useful for avoiding unwanted elements.

### Guidelines
- **Exclude specific objects**: If unwanted items appear (e.g., *scarf*, *necktie*), list them in the negative prompt.
- **Remove artifacts or styles**: Add `no watermarks`, `no text`, or `no blur` for cleaner images.
- **Avoid generic negatives**: Unlike other models, Qwen doesn’t need lists like `ugly`, `deformed`, or `disfigured`.
- **Use sparingly**: Apply negatives only when you see recurring issues.

---

## Prompt Template
A clear formula helps structure your thoughts:

```
[Main subject], [visual style/medium], [environment & background], [lighting/effects], [extra effects], ["exact text if any"]
```

### Example
> “A futuristic sports car, photorealistic style, parked under neon city lights, reflections on wet streets, cinematic lighting, \"Night Racer\" in metallic chrome text on the hood.”

| Component | Description / Examples |
|------------|------------------------|
| **Subject** | Main focus (e.g., *fluffy orange cat*, *woman in a space suit*) |
| **Setting/Background** | Environment (e.g., *in a foggy forest*, *on a sunlit balcony*) |
| **Style/Medium** | Artistic style (*photorealistic*, *oil painting*, *anime*) |
| **Mood/Lighting** | Atmosphere cues (*warm light*, *dramatic shadows*) |
| **Technical Details** | Camera/lens info (*close-up shot*, *85mm lens*) |
| **Exact Text** | Words rendered in quotes (*"AI Summit 2024"*) |
| **Negative Prompt** | Elements to exclude (*no blur*, *no watermark*) |

---

## Tips and Best Practices
- **Plan your concept**: Know your vision and gather reference images before prompting.
- **Be explicit**: Specify positions, relationships, or color contrasts if crucial.
- **Iterate**: Start with lower steps, then refine CFG scale or negatives as needed.
- **Document successes**: Keep a prompt log with parameters and results.
- **Leverage Qwen’s strengths**: Qwen excels at rendering *multilingual text*, *complex layouts*, and *natural composition*.

---

### Summary
By applying these techniques, you can:
- Craft detailed and coherent prompts.
- Guide Qwen’s natural-language understanding toward precise visual outcomes.
- Use negative prompts intelligently to prevent unwanted artifacts.

This structure ensures more consistent, controllable, and professional-quality image generation using Qwen-Image.

