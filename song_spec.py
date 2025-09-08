# ========================
# core/song_spec.py — Complete SongSpec module
# ========================
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional
import json

# Supported modes and step patterns
MODE_STEPS = {
    "ionian":      [2,2,1,2,2,2,1],
    "dorian":      [2,1,2,2,2,1,2],
    "phrygian":    [1,2,2,2,1,2,2],
    "lydian":      [2,2,2,1,2,2,1],
    "mixolydian":  [2,2,1,2,2,1,2],
    "aeolian":     [2,1,2,2,1,2,2],
    "locrian":     [1,2,2,1,2,2,2],
}

@dataclass
class Section:
    name: str
    length: int  # bars

@dataclass
class SongSpec:
    title: str = "Untitled"
    seed: int = 42
    key: str = "C"             # tonic letter with accidental
    mode: str = "ionian"        # one of MODE_STEPS
    tempo: int = 100
    meter: str = "4/4"
    swing: float = 0.0
    sections: List[Section] = field(default_factory=lambda: [Section("intro",4)])
    harmony_grid: List[Dict] = field(default_factory=list)
    cadences: List[Dict] = field(default_factory=list)
    tension_policy: Dict[str, List[int]] = field(default_factory=dict)
    register_policy: Dict[str, List[int]] = field(default_factory=lambda: {
        "bass": [28,48], "keys": [48,72], "pads": [60,84], "lead": [72,96]
    })
    density_curve: Dict[str, float] = field(default_factory=dict)
    instrument_selection: Dict[str, str] = field(default_factory=dict)

    # -------------------
    # Validation helpers
    # -------------------
    def validate(self) -> None:
        # Key sanity (A–G with optional #/b)
        if not self.key or self.key[0].upper() not in "ABCDEFG":
            raise ValueError(f"Invalid key: {self.key}")
        # Mode
        if self.mode not in MODE_STEPS:
            raise ValueError(f"Unknown mode: {self.mode}")
        # Meter
        if "/" not in self.meter:
            raise ValueError("Meter must be like '4/4' or '6/8'")
        num, den = self.meter.split("/")
        try:
            num = int(num); den = int(den)
        except Exception:
            raise ValueError("Meter numbers must be integers")
        if num <= 0 or den not in (1,2,4,8,16):
            raise ValueError("Unsupported meter")
        # Sections
        if any(s.length <= 0 for s in self.sections):
            raise ValueError("Section length must be > 0")
        # Harmony grid sanity
        valid_names = {s.name for s in self.sections}
        for row in self.harmony_grid:
            if row.get("section") not in valid_names:
                raise ValueError(f"Harmony row references unknown section: {row}")
            if not isinstance(row.get("chords", []), list) or not row["chords"]:
                raise ValueError("Each harmony row must include non-empty 'chords' list")

    # -------------------
    # IO helpers
    # -------------------
    def to_dict(self) -> Dict:
        return asdict(self)

    def to_json(self, path: str):
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def from_json(cls, path: str) -> "SongSpec":
        with open(path) as f:
            data = json.load(f)
        # Convert sections from dicts to Section objects
        if "sections" in data:
            data["sections"] = [Section(**s) if isinstance(s, dict) else s for s in data["sections"]]
        return cls(**data)

    # -------------------
    # Convenience helpers
    # -------------------
    def all_chords(self) -> List[str]:
        return [ch for row in self.harmony_grid for ch in row["chords"]]

# ========================
# Example usage
# ========================
if __name__ == "__main__":
    spec = SongSpec(
        title="Demo Song",
        key="C", mode="ionian", tempo=120, meter="4/4",
        sections=[Section("intro",4), Section("verse",8)],
        harmony_grid=[
            {"section":"intro","chords":["Cmaj7","Fmaj7","G7","Cmaj7"]},
            {"section":"verse","chords":["Am7","Dm7","G7","Cmaj7"]},
        ],
        cadences=[{"bar":8, "type":"authentic"}]
    )
    spec.validate()
    print("All chords:", spec.all_chords())
    spec.to_json("song_spec_demo.json")
    loaded = SongSpec.from_json("song_spec_demo.json")
    print("Loaded back:", loaded)

# ========================
# core/song_spec.py  — FULL module v1 (ready-to-run)
# ========================
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
import json
import re

# ---- Allowed modes & simple note parsing ----
ALLOWED_MODES = {"ionian","dorian","phrygian","lydian","mixolydian","aeolian","locrian"}
NOTE_LETTERS = set("A B C D E F G".split())
ACCIDENTALS = {"#", "b"}

_m_note = re.compile(r"^(?P<root>[A-Ga-g])(?P<acc>[#bB]?)$")

@dataclass
class Section:
    name: str
    length: int  # in bars (>=1)

    @classmethod
    def from_obj(cls, obj: Any) -> "Section":
        if isinstance(obj, Section):
            return obj
        return cls(name=str(obj["name"]), length=int(obj["length"]))

@dataclass
class SongSpec:
    title: str = "Untitled"
    seed: int = 42
    key: str = "C"
    mode: str = "ionian"
    tempo: int = 120
    meter: str = "4/4"  # beats per bar / beat unit
    swing: float = 0.0

    sections: List[Section] = field(default_factory=list)
    harmony_grid: List[Dict[str, Any]] = field(default_factory=list)

    cadences: List[Dict[str, Any]] = field(default_factory=list)
    tension_policy: Dict[str, List[int]] = field(default_factory=dict)
    register_policy: Dict[str, List[int]] = field(default_factory=dict)
    density_curve: Dict[str, float] = field(default_factory=dict)
    instrument_selection: Dict[str, str] = field(default_factory=dict)

    # -----------------
    # Construction
    # -----------------
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SongSpec":
        d = dict(d)  # shallow copy
        # sections
        raw_secs = d.get("sections", [])
        sections = [Section.from_obj(s) for s in raw_secs]
        d["sections"] = sections
        return cls(**d)

    @classmethod
    def from_json(cls, path: str) -> "SongSpec":
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        return cls.from_dict(d)

    # -----------------
    # Serialization
    # -----------------
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["sections"] = [asdict(s) for s in self.sections]
        return d

    def to_json(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    # -----------------
    # Validation
    # -----------------
    def validate(self) -> None:
        self._validate_key_mode()
        self._validate_meter()
        self._validate_sections()
        self._validate_harmony_grid()
        self._validate_policies()

    def _validate_key_mode(self) -> None:
        if not _m_note.match(self.key):
            raise ValueError(f"Invalid key format: {self.key!r}. Expected like 'C', 'F#', 'Bb'.")
        if self.mode not in ALLOWED_MODES:
            raise ValueError(f"Unknown mode: {self.mode!r}. Allowed: {sorted(ALLOWED_MODES)}")
        if not isinstance(self.tempo, int) or self.tempo <= 0:
            raise ValueError("Tempo must be a positive integer (BPM).")
        if not (0.0 <= float(self.swing) <= 1.0):
            raise ValueError("Swing must be between 0.0 and 1.0 (0=straight, 0.5=triplet feel).")

    def _validate_meter(self) -> None:
        if "/" not in self.meter:
            raise ValueError("Meter must be in the form 'N/D' (e.g., '4/4', '6/8').")
        num_str, den_str = self.meter.split("/", 1)
        try:
            num = int(num_str); den = int(den_str)
        except Exception as e:
            raise ValueError("Meter values must be integers.") from e
        if num <= 0:
            raise ValueError("Meter numerator must be > 0.")
        if den not in (1, 2, 4, 8, 16):
            raise ValueError("Meter denominator must be one of 1,2,4,8,16.")

    def _validate_sections(self) -> None:
        if not self.sections:
            raise ValueError("You must define at least one section.")
        names = set()
        for s in self.sections:
            if not s.name or not isinstance(s.name, str):
                raise ValueError("Each section needs a string 'name'.")
            if s.length <= 0:
                raise ValueError(f"Section '{s.name}' must have length >= 1.")
            if s.name in names:
                raise ValueError(f"Duplicate section name: {s.name!r}.")
            names.add(s.name)

    def _validate_harmony_grid(self) -> None:
        valid_names = {s.name for s in self.sections}
        if not isinstance(self.harmony_grid, list):
            raise ValueError("harmony_grid must be a list of {section, chords} objects.")
        for row in self.harmony_grid:
            if not isinstance(row, dict):
                raise ValueError("Each harmony_grid row must be a dict.")
            sec = row.get("section")
            chords = row.get("chords")
            if sec not in valid_names:
                raise ValueError(f"Harmony row references unknown section: {sec!r}")
            if not isinstance(chords, list) or not chords:
                raise ValueError(f"Section {sec!r} must have a non-empty 'chords' list.")
            # Optional strict check: number of chords equals section length (bars)
            sec_len = next(s.length for s in self.sections if s.name == sec)
            if len(chords) != sec_len:
                raise ValueError(
                    f"Section {sec!r} declares length {sec_len} bars but has {len(chords)} chords. "
                    "(1 chord per bar expected in Phase 1)"
                )

    def _validate_policies(self) -> None:
        # register_policy ranges should be valid MIDI note numbers (0..127) and low<high
        for inst, rng in (self.register_policy or {}).items():
            if not (isinstance(rng, list) and len(rng) == 2 and all(isinstance(x, int) for x in rng)):
                raise ValueError(f"register_policy[{inst!r}] must be [low, high] MIDI ints.")
            low, high = rng
            if not (0 <= low < high <= 127):
                raise ValueError(f"register_policy[{inst!r}] out of MIDI range 0..127: {rng}")
        # density_curve values 0..1
        for sec, val in (self.density_curve or {}).items():
            if not (0.0 <= float(val) <= 1.0):
                raise ValueError(f"density_curve[{sec!r}] must be between 0.0 and 1.0.")

    # -----------------
    # Helpers
    # -----------------
    def section_map(self) -> Dict[str, Section]:
        return {s.name: s for s in self.sections}

    def total_bars(self) -> int:
        return sum(s.length for s in self.sections)

    def bars_by_section(self) -> Dict[str, range]:
        """Return mapping of section name -> range of absolute bar indices (0-based)."""
        m: Dict[str, range] = {}
        cursor = 0
        for s in self.sections:
            m[s.name] = range(cursor, cursor + s.length)
            cursor += s.length
        return m

    def all_chords(self) -> List[str]:
        """Flatten harmony_grid into a single chord-per-bar timeline (Phase 1 assumption)."""
        order = [s.name for s in self.sections]
        chords: List[str] = []
        for sec in order:
            row = next((r for r in self.harmony_grid if r.get("section") == sec), None)
            if row:
                chords.extend(list(row["chords"]))
        return chords

    def cadence_bars(self) -> Dict[int, str]:
        out: Dict[int, str] = {}
        for c in self.cadences or []:
            b = int(c.get("bar", -1)); t = str(c.get("type", ""))
            if b >= 0:
                out[b] = t
        return out


# ---- Quick self-demo when run directly ----
if __name__ == "__main__":
    demo = SongSpec.from_dict({
        "title": "SongSpec Demo",
        "key": "C", "mode": "ionian", "tempo": 96, "meter": "4/4",
        "sections": [
            {"name": "intro",  "length": 4},
            {"name": "verse",  "length": 8},
            {"name": "chorus", "length": 8}
        ],
        "harmony_grid": [
            {"section": "intro",  "chords": ["Cmaj7","Fmaj7","G7","Cmaj7"]},
            {"section": "verse",  "chords": ["Am7","Dm7","G7","Cmaj7","Am7","Dm7","G7","Cmaj7"]},
            {"section": "chorus", "chords": ["Fmaj7","G7","Em7","Am7","Dm7","G7","Cmaj7","Cmaj7"]},
        ],
        "register_policy": {"bass":[28,48], "keys":[48,72], "pads":[60,84], "lead":[72,96]},
        "density_curve": {"intro":0.2, "verse":0.5, "chorus":0.9}
    })
    demo.validate()
    print("Total bars:", demo.total_bars())
    print("Bars by section:", {k:(r.start, r.stop-1) for k,r in demo.bars_by_section().items()})
    print("Timeline chords:", demo.all_chords())

