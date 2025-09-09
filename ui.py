import json
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox

from core.song_spec import SongSpec
from core.stems import build_stems_for_song
from core.render import render_song
from core.mixer import mix
from main_render import _write_wav, _maybe_export_mp3


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
    except Exception as exc:
        messagebox.showerror("Error", str(exc))


root = tk.Tk()
root.title("Blossom Renderer")

spec_var = tk.StringVar(value="song.json")
keys_var = tk.StringVar()
pads_var = tk.StringVar()
bass_var = tk.StringVar()
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

row += 1
tk.Label(root, text="Pads SFZ").grid(row=row, column=0, sticky="e")
E2 = tk.Entry(root, textvariable=pads_var, width=40)
E2.grid(row=row, column=1)
tk.Button(root, text="Browse", command=lambda: _browse_file(pads_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)

row += 1
tk.Label(root, text="Bass SFZ").grid(row=row, column=0, sticky="e")
E3 = tk.Entry(root, textvariable=bass_var, width=40)
E3.grid(row=row, column=1)
tk.Button(root, text="Browse", command=lambda: _browse_file(bass_var, [("SFZ", "*.sfz")])).grid(row=row, column=2)

row += 1
tk.Label(root, text="Seed").grid(row=row, column=0, sticky="e")
E4 = tk.Entry(root, textvariable=seed_var, width=10)
E4.grid(row=row, column=1, sticky="w")

row += 1
tk.Label(root, text="Mix Path").grid(row=row, column=0, sticky="e")
E5 = tk.Entry(root, textvariable=mix_var, width=40)
E5.grid(row=row, column=1)
tk.Button(root, text="Browse", command=lambda: _browse_save(mix_var)).grid(row=row, column=2)

row += 1
tk.Label(root, text="Stems Dir").grid(row=row, column=0, sticky="e")
E6 = tk.Entry(root, textvariable=stems_var, width=40)
E6.grid(row=row, column=1)
tk.Button(root, text="Browse", command=lambda: _browse_dir(stems_var)).grid(row=row, column=2)

row += 1
R = tk.Button(root, text="Render", command=render)
R.grid(row=row, column=1, pady=10)

root.mainloop()
