from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

REPO_ROOT = Path(__file__).resolve().parent.parent
MAIN_RENDER = REPO_ROOT / "main_render.py"
ASSETS_DIR = REPO_ROOT / "assets"

app = FastAPI()
app.mount("/static", StaticFiles(directory=REPO_ROOT / "webui" / "static"), name="static")

templates = Jinja2Templates(directory=REPO_ROOT / "webui" / "templates")


jobs: dict[str, dict] = {}


def _options(kind: str) -> list[str]:
    base = ASSETS_DIR / kind
    return [p.stem for p in base.glob("*.json")]


def _watch(job_id: str) -> None:
    job = jobs[job_id]
    proc: subprocess.Popen[str] = job["proc"]
    for line in proc.stdout:  # type: ignore[attr-defined]
        job["log"].append(line)
        m = re.search(r"(\d+)%", line)
        if m:
            job["progress"] = int(m.group(1))
        m = re.search(r"ETA[:\s]+([0-9:]+)", line)
        if m:
            job["eta"] = m.group(1)
    proc.wait()
    job["returncode"] = proc.returncode
    job["progress"] = 100
    if proc.returncode == 0:
        try:
            shutil.make_archive(job["tmpdir"] / "bundle", "zip", job["tmpdir"])
            metrics = job["tmpdir"] / "metrics.json"
            if metrics.exists():
                job["metrics"] = json.loads(metrics.read_text())
        except Exception:
            pass


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    presets = _options("presets")
    styles = _options("styles")
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "presets": presets, "styles": styles},
    )


@app.post("/render")
async def render(
    preset: str = Form(...),
    style: str = Form(""),
    seed: int = Form(42),
    minutes: float | None = Form(None),
    sections: int | None = Form(None),
    name: str = Form("output"),
    mix_config: UploadFile | None = File(None),
    arrange_config: UploadFile | None = File(None),
    phrase: bool = Form(False),
    preview: int | None = Form(None),
) -> dict:
    tmpdir = Path(tempfile.mkdtemp())
    mix_path = tmpdir / "mix.wav"
    stems_dir = tmpdir / "stems"
    cmd: list[str] = [
        sys.executable,
        str(MAIN_RENDER),
        "--preset",
        preset,
        "--seed",
        str(seed),
        "--bundle",
        str(tmpdir),
        "--mix",
        str(mix_path),
        "--stems",
        str(stems_dir),
    ]
    if style:
        cmd += ["--style", style]
    if minutes is not None:
        cmd += ["--minutes", str(minutes)]
    if sections is not None:
        cmd += ["--sections", str(sections)]
    if phrase:
        cmd += ["--use-phrase-model", "yes"]
    if preview is not None:
        cmd += ["--preview", str(preview)]
    if mix_config is not None:
        mix_path = tmpdir / "mix_config.json"
        mix_path.write_bytes(await mix_config.read())
        cmd += ["--mix-config", str(mix_path)]
    if arrange_config is not None:
        arr_path = tmpdir / "arrange_config.json"
        arr_path.write_bytes(await arrange_config.read())
        cmd += ["--arrange-config", str(arr_path)]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    job_id = uuid.uuid4().hex
    jobs[job_id] = {
        "proc": proc,
        "tmpdir": tmpdir,
        "log": [],
        "progress": 0,
        "eta": None,
        "name": name,
    }
    threading.Thread(target=_watch, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    status = "running"
    if job.get("returncode") is not None:
        status = "completed" if job["returncode"] == 0 else "error"
    return {
        "status": status,
        "progress": job.get("progress", 0),
        "eta": job.get("eta"),
        "log": job.get("log", []),
        "metrics": job.get("metrics"),
    }


@app.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    proc = job["proc"]
    if proc.poll() is None:
        proc.terminate()
    job["returncode"] = -1
    return {"status": "cancelled"}


@app.get("/jobs/{job_id}/artifact/{name}")
async def artifact(job_id: str, name: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    path = job["tmpdir"] / name
    if not path.exists():
        raise HTTPException(404, "not found")
    suffix = Path(name).suffix
    filename = f"{job.get('name', 'output')}{suffix}"
    return FileResponse(path, filename=filename)
