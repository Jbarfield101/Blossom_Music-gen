# ========================
# core/theory.py — Phase 1 Theory Core
# ========================
from __future__ import annotations
from typing import List, Tuple
from .song_spec import SongSpec
import math

# ------------------------------------
# Chord parsing + basic dictionary
# ------------------------------------

CHORD_FORMULAS = {
    "":      [0,4,7],        # maj triad
    "m":     [0,3,7],
    "dim":   [0,3,6],
    "aug":   [0,4,8],
    "7":     [0,4,7,10],
    "maj7":  [0,4,7,11],
    "m7":    [0,3,7,10],
    "m7b5":  [0,3,6,10],
    "dim7":  [0,3,6,9],
}

TENSION_OFFSETS = {"9":14, "11":17, "13":21}

NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
NOTE_INDEX = {n:i for i,n in enumerate(NOTE_NAMES)}


def parse_chord_symbol(symbol: str) -> Tuple[int, List[int]]:
    """Return (root_pc, intervals) ignoring slash bass for now."""
    s = symbol.strip()
    root = s[0].upper()
    rest = s[1:]
    root_pc = NOTE_INDEX[root]
    if rest.startswith('#'):
        root_pc = (root_pc+1)%12
        rest = rest[1:]
    elif rest.lower().startswith('b'):
        root_pc = (root_pc-1)%12
        rest = rest[1:]
    quality = ""
    for q in sorted(CHORD_FORMULAS.keys(), key=len, reverse=True):
        if rest.startswith(q):
            quality = q
            rest = rest[len(q):]
            break
    intervals = CHORD_FORMULAS.get(quality,[0,4,7]).copy()
    if "9" in rest: intervals.append(TENSION_OFFSETS["9"])
    if "11" in rest: intervals.append(TENSION_OFFSETS["11"])
    if "13" in rest: intervals.append(TENSION_OFFSETS["13"])
    return root_pc, intervals


# ------------------------------------
# Registers & helpers
# ------------------------------------

class Register:
    def __init__(self, low:int, high:int):
        self.low=low; self.high=high
    def clamp(self, note:int) -> int:
        n=note
        while n<self.low: n+=12
        while n>self.high: n-=12
        if n<self.low: return self.low
        if n>self.high: return self.high
        return n

DEFAULT_REGISTERS = {
    "bass": Register(28,48),     # E1..C3
    "tenor": Register(40,55),
    "alto": Register(48,65),
    "soprano": Register(55,79)
}

def midi_note(pc:int, octave:int)->int:
    return 12*(octave+1)+(pc%12)


def interval_cost(n1:int,n2:int)->int:
    return abs(n1-n2)


# ------------------------------------
# Voice-leading engine
# ------------------------------------

def realise_chord(root_pc:int, intervals:List[int], octave:int=4)->List[int]:
    base=midi_note(root_pc,octave)
    return [base+iv for iv in intervals]


def choose_voicing(prev:List[int],cands:List[List[int]])->List[int]:
    def cost(v):
        size=min(len(prev),len(v))
        return sum(interval_cost(prev[i],v[i]) for i in range(size))
    return min(cands,key=cost)


def generate_satb(chords:List[str], registers:dict=DEFAULT_REGISTERS)->Tuple[List[int],List[int],List[int],List[int]]:
    bass,tenor,alto,sop=[],[],[],[]
    prev=[50,55,60] # dummy starting point
    for sym in chords:
        r_pc, ivs=parse_chord_symbol(sym)
        b=registers["bass"].clamp(midi_note(r_pc,2))
        bass.append(b)
        triad=realise_chord(r_pc,[i for i in ivs if i<=12],4)
        cands=[]
        for o_t in (-12,0,12):
            for o_a in (-12,0,12):
                for o_s in (-12,0,12):
                    t=registers["tenor"].clamp(triad[0]+o_t)
                    a=registers["alto"].clamp(triad[min(1,len(triad)-1)]+o_a)
                    s=registers["soprano"].clamp(triad[min(2,len(triad)-1)]+o_s)
                    if not(t<a<s): continue
                    cands.append([t,a,s])
        tas=choose_voicing(prev,cands) if cands else prev
        tenor.append(tas[0]); alto.append(tas[1]); sop.append(tas[2])
        prev=tas
    return bass,tenor,alto,sop


# ------------------------------------
# Demo using SongSpec
# ------------------------------------
if __name__=="__main__":
    demo=SongSpec.from_dict({
        "title":"Theory Demo","key":"C","mode":"ionian","tempo":96,"meter":"4/4",
        "sections":[{"name":"intro","length":4}],
        "harmony_grid":[{"section":"intro","chords":["Cmaj7","Fmaj7","G7","Cmaj7"]}]
    })
    demo.validate()
    chords=demo.all_chords()
    b,t,a,s=generate_satb(chords)
    print("Chords:",chords)
    print("Bass:",b) 
    print("Tenor:",t)
    print("Alto:",a)
    print("Soprano:",s)
