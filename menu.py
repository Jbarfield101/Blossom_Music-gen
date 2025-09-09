import sys
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Blossom requires Python 3.10")

from pathlib import Path
import tkinter as tk
import subprocess

ROOT = Path(__file__).resolve().parent
ICON_PATH = ROOT / "assets" / "images" / "icon.png"


def _open_renderer() -> None:
    subprocess.Popen([sys.executable, str(ROOT / "ui.py")])
    root.destroy()


root = tk.Tk()
root.title("Music Generator")

_img = tk.PhotoImage(file=str(ICON_PATH))
btn = tk.Label(root, image=_img, cursor="hand2")
btn.image = _img  # keep a reference so image persists
btn.pack(padx=20, pady=10)
btn.bind("<Button-1>", lambda _e: _open_renderer())

tk.Label(root, text="Music Generator", font=("Helvetica", 16)).pack(pady=(0, 20))

root.mainloop()
