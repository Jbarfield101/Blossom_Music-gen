from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class Preset:
    name: str
    prompt: str
    negative: str = ""


PRESETS: Dict[str, Preset] = {
    "piano": Preset(
        name="Piano",
        prompt=(
            "solo grand piano, intimate room, warm tone, gentle dynamics, soft reverb, lo-fi character"
        ),
        negative=(
            "voice, vocals, drums, distortion, noise, glitch"
        ),
    ),
    "ambience": Preset(
        name="Ambience",
        prompt="ethereal ambient soundscape, lush pads, slow evolving textures, reverb heavy, serene",
    ),
    "rock_riff": Preset(
        name="Rock Riff",
        prompt="gritty electric guitar riff, driving drums, bass groove, energetic, studio mix",
    ),
    "lo_fi": Preset(
        name="Lo-Fi",
        prompt="lo-fi hip hop beat, dusty vinyl, mellow keys, relaxed vibe, warm tape saturation",
    ),
    "edm": Preset(
        name="EDM",
        prompt="edm groove, punchy kick, sidechained pads, catchy lead, festival mix, bright",
    ),
    "cinematic": Preset(
        name="Cinematic",
        prompt="cinematic orchestral score, strings and brass, dramatic percussion, expansive, emotive",
    ),
    # Soundscape stems
    "piano_warm": Preset(
        name="Piano Warm",
        prompt="warm felt piano, intimate, soft dynamics, gentle, cozy, mellow",
        negative="vocals, distortion, harsh noise",
    ),
    "rain_window": Preset(
        name="Rain by Window",
        prompt="steady light rain ambience, window rain, distant city hum, soothing",
        negative="thunder, vocals, sudden loud hits",
    ),
    "forest_wind": Preset(
        name="Forest Wind",
        prompt="soft forest wind, subtle leaves rustling, distant birds very sparse",
        negative="roaring wind, voices",
    ),
    "tavern_murmur": Preset(
        name="Tavern Murmur",
        prompt="low tavern murmur, indistinct chatter, wooden room ambience, cozy",
        negative="clear speech, music, shouting",
    ),
    "fire_crackle": Preset(
        name="Fire Crackle",
        prompt="gentle fireplace crackle, warm room, subtle, soft pops",
        negative="explosions, loud bangs, hiss",
    ),
    "cathedral_pad": Preset(
        name="Cathedral Pad",
        prompt="distant airy choir pad, cathedral reverb, sustained, smooth, serene",
        negative="vocals lyrics, drums, percussive hits",
    ),
}


def list_presets() -> List[Preset]:
    return list(PRESETS.values())


def get_preset(key: str) -> Preset:
    if key not in PRESETS:
        raise KeyError(f"Unknown preset: {key}")
    return PRESETS[key]


def render_prompt(key: str, extra: str | None = None) -> str:
    p = get_preset(key)
    return f"{p.prompt}, {extra}" if extra else p.prompt
