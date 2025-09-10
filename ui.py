"""Tkinter interface for rendering music.

The UI is typically launched via ``start.py`` which sets up a temporary
virtual environment and installs dependencies automatically.  Direct execution
is still supported when the required packages are already available.
"""

import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

import json
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox

from core.song_spec import SongSpec
from core.stems import build_stems_for_song
from core.arranger import arrange_song
from core.render import render_song
from core.mixer import mix
from main_render import _write_wav, _maybe_export_mp3


# load default sample paths from config if present
_CFG_SAMPLE_PATHS: dict[str, str] = {}
_cfg_path = Path("render_config.json")
if _cfg_path.exists():
    with _cfg_path.open("r", encoding="utf-8") as fh:
        _CFG_SAMPLE_PATHS = json.load(fh).get("sample_paths", {})


ASSET_DIRS = {
    "keys": Path("assets/sfz/Piano"),
    "pads": Path("assets/sfz/Pads"),
    "bass": Path("assets/sfz/Bass"),
    "drums": Path("assets/sfz/Drums"),
}

_CHOICES: dict[str, tk.StringVar] = {}


def _initial_sfz_path(name: str) -> str:
    cfg_path = _CFG_SAMPLE_PATHS.get(name)
    if cfg_path:
        p = Path(cfg_path)
        if p.is_file():
            return p.as_posix()
        if p.is_dir():
            files = sorted(p.glob("*/*.sfz"))
            if files:
                return files[0].as_posix()
    files = sorted(ASSET_DIRS[name].glob("*/*.sfz"))
    if files:
        return files[0].as_posix()
    return ""


def _make_option_menu(var: tk.StringVar, name: str, row: int):
    options = sorted([p.name for p in ASSET_DIRS[name].iterdir() if p.is_dir()])
    choice = tk.StringVar()
    _CHOICES[name] = choice

    def _update(*_):
        sel = choice.get()
        path = ASSET_DIRS[name] / sel / f"{sel}.sfz"
        var.set(path.as_posix())

    if options:
        default = Path(var.get()).parent.name if var.get() else options[0]
        choice.set(default if default in options else options[0])
        _update()
    choice.trace_add("write", _update)
    tk.OptionMenu(root, choice, *options).grid(row=row, column=3)


def _browse_file(var: tk.StringVar, filetypes: list[tuple[str, str]]):
    path = filedialog.askopenfilename(filetypes=filetypes)
    if path:
        var.set(path)


def _browse_save(var: tk.StringVar):
    path = filedialog.asksaveasfilename(defaultextension=".wav")
    if path:
        var.set(path)


def _browse_dir(var: tk.StringVar):
    path = filedialog.askdirectory()
    if path:
        var.set(path)


def render():
    try:
        spec_path = Path(spec_var.get())
        seed = int(seed_var.get() or 42)
        mix_path = Path(mix_var.get() or "out/mix.wav")
        stems_dir = Path(stems_var.get() or "out/stems")

        spec = SongSpec.from_json(str(spec_path))
        spec.validate()

        cfg = {}
        cfg_path = Path("render_config.json")
        if cfg_path.exists():
            with cfg_path.open("r", encoding="utf-8") as fh:
                cfg = json.load(fh)

        stems = build_stems_for_song(spec, seed=seed)
        stems = arrange_song(spec, stems, style=cfg.get("style", {}), seed=seed)

        sfz_map = {}
        if keys_var.get():
            p = Path(keys_var.get())
            if p.exists():
                sfz_map["keys"] = p
        if pads_var.get():
            p = Path(pads_var.get())
            if p.exists():
                sfz_map["pads"] = p
        if bass_var.get():
            p = Path(bass_var.get())
            if p.exists():
                sfz_map["bass"] = p
        if drums_var.get():
            p = Path(drums_var.get())
            if p.exists():
                sfz_map["drums"] = p

        rendered = render_song(stems, sr=44100, sfz_paths=sfz_map)
        mix_audio = mix(rendered, 44100, cfg)

        mix_path.parent.mkdir(parents=True, exist_ok=True)
        _write_wav(mix_path, mix_audio, 44100)
        _maybe_export_mp3(mix_path)

        stems_dir.mkdir(parents=True, exist_ok=True)
        for name, audio in rendered.items():
            path = stems_dir / f"{name}.wav"
            _write_wav(path, audio, 44100)
            _maybe_export_mp3(path)

        messagebox.showinfo("Done", f"Wrote mix to {mix_path}")
    except Exception:
        trace = traceback.format_exc()
        dialog = tk.Toplevel(root)
        dialog.title("Error")
        text = tk.Text(dialog, wrap="word")
        text.insert("1.0", trace)
        text.configure(state="disabled")
        text.pack(expand=True, fill="both", padx=10, pady=10)

        def copy() -> None:
            dialog.clipboard_clear()
            dialog.clipboard_append(trace)

        btn_frame = tk.Frame(dialog)
        btn_frame.pack(pady=(0, 10))
        tk.Button(btn_frame, text="Copy to Clipboard", command=copy).pack(side="left", padx=5)
        tk.Button(btn_frame, text="Close", command=dialog.destroy).pack(side="left", padx=5)

        dialog.grab_set()
        dialog.focus_force()



def run_ui():
    global root, spec_var, keys_var, pads_var, bass_var, drums_var, seed_var, mix_var, stems_var

    root = tk.Tk()
    root.title("Blossom Renderer")

    spec_var = tk.StringVar(value="song.json")
    keys_var = tk.StringVar(value=_initial_sfz_path("keys"))
    pads_var = tk.StringVar(value=_initial_sfz_path("pads"))
    bass_var = tk.StringVar(value=_initial_sfz_path("bass"))
    drums_var = tk.StringVar(value=_initial_sfz_path("drums"))
    seed_var = tk.StringVar(value="42")
    mix_var = tk.StringVar(value="out/mix.wav")
    stems_var = tk.StringVar(value="out/stems")

    row = 0
    tk.Label(root, text="Song Spec").grid(row=row, column=0, sticky="e")
    E0 = tk.Entry(root, textvariable=spec_var, width=40)
    E0.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_file(spec_var, [("JSON", "*.json")])).grid(row=row, column=2)

    row += 1
    tk.Label(root, text="Keys SFZ").grid(row=row, column=0, sticky="e")
    E1 = tk.Entry(root, textvariable=keys_var, width=40)
    E1.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_file(keys_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)
    _make_option_menu(keys_var, "keys", row)

    row += 1
    tk.Label(root, text="Pads SFZ").grid(row=row, column=0, sticky="e")
    E2 = tk.Entry(root, textvariable=pads_var, width=40)
    E2.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_file(pads_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)
    _make_option_menu(pads_var, "pads", row)

    row += 1
    tk.Label(root, text="Bass SFZ").grid(row=row, column=0, sticky="e")
    E3 = tk.Entry(root, textvariable=bass_var, width=40)
    E3.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_file(bass_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)
    _make_option_menu(bass_var, "bass", row)

    row += 1
    tk.Label(root, text="Drums SFZ").grid(row=row, column=0, sticky="e")
    E4 = tk.Entry(root, textvariable=drums_var, width=40)
    E4.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_file(drums_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)
    _make_option_menu(drums_var, "drums", row)

    row += 1
    tk.Label(root, text="Seed").grid(row=row, column=0, sticky="e")
    E5 = tk.Entry(root, textvariable=seed_var, width=10)
    E5.grid(row=row, column=1, sticky="w")

    row += 1
    tk.Label(root, text="Mix Path").grid(row=row, column=0, sticky="e")
    E6 = tk.Entry(root, textvariable=mix_var, width=40)
    E6.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_save(mix_var)).grid(row=row, column=2)

    row += 1
    tk.Label(root, text="Stems Dir").grid(row=row, column=0, sticky="e")
    E7 = tk.Entry(root, textvariable=stems_var, width=40)
    E7.grid(row=row, column=1)
    tk.Button(root, text="Browse", command=lambda: _browse_dir(stems_var)).grid(row=row, column=2)

    row += 1
    R = tk.Button(root, text="Render", command=render)
    R.grid(row=row, column=1, pady=10)

    root.mainloop()


if __name__ == "__main__":
    run_ui()
