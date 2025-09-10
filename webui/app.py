from __future__ import annotations

import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, Response

REPO_ROOT = Path(__file__).resolve().parent.parent
MAIN_RENDER = REPO_ROOT / "main_render.py"
ASSETS_DIR = REPO_ROOT / "assets"

app = FastAPI()


def _options(kind: str) -> list[str]:
    base = ASSETS_DIR / kind
    return [p.stem for p in base.glob("*.json")]


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    """Render a small HTML form to trigger rendering."""
    presets = "".join(f'<option value="{p}">{p}</option>' for p in _options("presets"))
    styles = "".join(f'<option value="{s}">{s}</option>' for s in _options("styles"))
    html = f"""
    <html><body>
    <form action="/render" method="post">
        <label>Preset <select name="preset">{presets}</select></label><br>
        <label>Style <select name="style"><option value="">(default)</option>{styles}</select></label><br>
        <label>Seed <input type="number" name="seed" value="42"/></label><br>
        <label>Minutes <input type="number" step="0.1" name="minutes"/></label><br>
        <button type="submit">Render</button>
    </form>
    </body></html>
    """
    return HTMLResponse(html)


@app.post("/render")
async def render(
    preset: str = Form(...),
    style: str = Form(""),
    seed: int = Form(42),
    minutes: float | None = Form(None),
) -> Response:
    """Run the main renderer and return a zip bundle."""
    tmpdir = Path(tempfile.mkdtemp())
    try:
        cmd = [
            sys.executable,
            str(MAIN_RENDER),
            "--preset",
            preset,
            "--seed",
            str(seed),
            "--bundle",
            str(tmpdir),
        ]
        if style:
            cmd += ["--style", style]
        if minutes is not None:
            cmd += ["--minutes", str(minutes)]
        subprocess.run(cmd, check=True)
        archive = shutil.make_archive(tmpdir / "bundle", "zip", tmpdir)
        data = Path(archive).read_bytes()
        headers = {"Content-Disposition": "attachment; filename=bundle.zip"}
        return Response(content=data, media_type="application/zip", headers=headers)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
