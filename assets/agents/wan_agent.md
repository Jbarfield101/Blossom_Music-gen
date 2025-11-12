# WAN-Agent Video Prompt Engineering Guide

## Introduction
Wan AI (Tongyi Wanxiang) is Alibaba’s diffusion-based video generation system capable of creating text-to-video (T2V) and image-to-video (I2V) clips. The core formula is **Subject + Scene + Motion**, which defines the essence of every clip. Later versions—Wan 2.2 and Wan 2.5—add support for **camera control, atmosphere, styling, and even native audio generation**. Mastering these components allows creators to generate cinematic, coherent, and emotionally rich videos.

---

## Overview of Wan Models
| Version | Key Features | Prompt Highlights |
|----------|----------------|------------------|
| **Wan 2.1** | Baseline model (480–720p, ~5 s). | Use **Subject + Scene + Motion**. Add **Camera language**, **Atmosphere**, **Style**. |
| **Wan 2.2** | Mixture‑of‑Experts model; better motion and camera control. | Prompts 80–120 words. Include **camera moves**, **motion modifiers**, **aesthetic tags**, and **negative prompts**. |
| **Wan 2.5** | Adds **audio generation** and higher fidelity (1080p/24 fps). | Specify **setting, subject, camera, audio, mood**. Dialogue and ambient audio can be described directly. |

---

## Basic Prompt Formulas

### 1. Simple Formula (Wan 2.1)
```
Subject + Scene + Motion
```
Example: “A samurai stands beneath cherry blossoms, petals falling slowly in the wind.”

### 2. Advanced Formula
```
Subject + Scene + Motion + Camera Language + Atmosphere + Style
```
Example: “A lone knight in silver armor (subject) stands on a misty battlefield (scene) as fog swirls (motion), the camera tilts upward (camera language), creating a melancholic tone (atmosphere) in painterly realism (style).”

### 3. Camera-Movement Formula
```
Camera movement + Subject + Scene + Motion + Atmosphere + Style
```
Useful for cinematic intros or dynamic reveals.

### 4. Transformation Formula
```
Subject A + Transformation process + Subject B + Scene + Motion + Camera + Style
```
Ideal for morphing sequences or magical transitions.

---

## Prompt Components and Dictionaries

### Shot Types & Camera Angles
- **Extreme close-up**, **medium shot**, **long shot**, **bird’s-eye view** — control framing.
- **Low angle** for power; **overhead** for detachment.
- **Camera moves**: *dolly in/out*, *pan*, *orbit*, *crane*, *zoom*.

### Atmosphere & Style Categories
Atmosphere sets emotional tone: *dreamlike, lonely, vibrant, tense, majestic.*  
Styling controls visuals: *cyberpunk, watercolor, pixel art, Chinese anime, classic masterpiece.*

### Additional Techniques
- **Layered prompts** — combine multiple story elements (e.g., dawn transitions, crowds reacting).
- **Emotional dynamics** — describe feelings to direct tone.
- **Narrative arcs** — structure beginning, middle, and end.
- **Mixed textures** — combine realism with stylization for artistic results.

---

## Best Practices for Wan 2.1
1. Start simple with the **Subject + Scene + Motion** structure.  
2. Gradually add **camera language** and **mood descriptors**.  
3. Use **prompt banks** for shot types or artistic references.  
4. Test different movements: dolly, pan, or FPV to add cinematic feel.  
5. Apply **style tags** like *cyberpunk cityscape*, *painterly tone*, or *golden-hour light*.

---

## Wan 2.2 Prompting Guidelines
- **Prompt length**: 80–120 words for consistent results.  
- **Shot order**: Describe opening, then motion, then payoff.  
- **Camera terms**: *pan, tilt, dolly, crane, orbit.*  
- **Motion modifiers**: *slow motion, time-lapse, whip pan.*  
- **Aesthetic tags**: lighting (“neon rim light”), color grade (“teal‑and‑orange”), lens type (“16 mm film grain”).  
- **Temporal parameters**: ≤ 5 s, 16–24 fps, up to 1280×720 px.  
- **Negative prompts**: “no subtitles, no blur, no artefacts.”

### Example Prompts
- **Neon Drift** — “A hooded courier runs through a rain‑soaked cyberpunk market; camera tracks behind amid pink and blue light flares.”
- **Alpine Reveal** — “Close‑up on an ice axe; camera dollies back to reveal sunrise on a snowy ridge.”

---

## Character & Emotion Control
Describe physical and emotional details:
- **Movement**: “sprinter’s muscles tighten as legs drive forward.”
- **Emotion**: “widow weeps beside a rain‑streaked window.”
- **Lighting**: “moonlight and low‑contrast edge glow.”

Camera cues like **push/pull** or **tracking** enhance cinematic flow. Iterate for fidelity and shorten duration if motion is ignored.

---

## Wan 2.5 Prompting Framework
### Dialogue & Audio
- Use quotes for dialogue: *“Let’s move.” – Captain, tense whisper.*  
- Add ambient sound cues: *wind, thunder, crowd noise, distant piano.*  
- State explicitly: *no dialogue*, *music only*, or *ambient audio only.*

### Five‑Element Framework
1. **Setting & Lighting** – environment, time of day, light tone.  
2. **Subject & Action** – who and what.  
3. **Camera Direction** – movement or framing (*orbit around hero, pull‑back reveal*).  
4. **Audio Elements** – dialogue, ambience, soundtrack.  
5. **Mood & Style** – cinematic tone, color, or aesthetic (e.g., *gritty urban*, *dreamy fantasy*).

### Image‑to‑Video (I2V) Prompts
An effective I2V prompt includes:
```
Entity + Environment + Shot Size + Perspective + Camera Motion + Movement + Lighting + Style + Audio + Duration + Negative Prompts
```
Example: “A teenage girl enters a misty forest; camera pans from wide shot to close‑up as sun rays pierce fog; realistic dreamy tone with forest ambience; exclude extra people or fast cuts.”

---

## Technical & Troubleshooting
| Setting | Recommendation |
|----------|----------------|
| **Guidance Scale** | 5–7; lower to reduce flicker. |
| **Diffusion Steps** | 20–30 per frame; higher = sharper, slower. |
| **Resolution** | 480p (fast) or 720p (higher quality). |
| **Negative Prompts** | “no text, no watermark, no blur, no distortion.” |

### Common Fixes
- **Off‑topic output** → strengthen specificity or raise guidance.  
- **Flicker/jitter** → lower guidance, simplify motion.  
- **Artifacts/text** → add negatives.  
- **Identity drift** → use I2V or reinforce subject details.  
- **Slow generation** → shorten clip or reduce resolution.

---

## Conclusion
Start with the **basic formula** to explore Wan’s strengths. Then layer in **camera control**, **lighting**, and **style** for cinematic precision. For Wan 2.2 +, write 80–120 word structured prompts with motion modifiers and negatives. In Wan 2.5, combine **visual**, **audio**, and **mood** cues using the five‑element framework. Iteration and clarity are key—adjust, re‑render, and refine until results align with your creative vision.

