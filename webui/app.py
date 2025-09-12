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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

REPO_ROOT = Path(__file__).resolve().parent.parent
MAIN_RENDER = REPO_ROOT / "main_render.py"
ASSETS_DIR = REPO_ROOT / "assets"

app = FastAPI()
app.mount("/static", StaticFiles(directory=REPO_ROOT / "ui" / "static"), name="static")


jobs: dict[str, dict] = {}

RECENT_FILE = REPO_ROOT / "ui" / "recent_renders.json"
MAX_RECENT = 10


def _options(kind: str) -> list[str]:
    base = ASSETS_DIR / kind
    return [p.stem for p in base.glob("*.json")]


def _load_recent() -> list[dict]:
    if RECENT_FILE.exists():
        try:
            return json.loads(RECENT_FILE.read_text())
        except Exception:
            return []
    return []


def _save_recent(entries: list[dict]) -> None:
    RECENT_FILE.write_text(json.dumps(entries[-MAX_RECENT:], indent=2))


def zip_bundle(job_id: str) -> Path:
    """Create a zip archive for a rendered job and return its path.

    Parameters
    ----------
    job_id: str
        Identifier of the job whose output should be bundled.

    Returns
    -------
    Path
        Path to the generated ``bundle.zip`` file.
    """
    job = jobs.get(job_id)
    if not job:
        raise KeyError(f"job {job_id} not found")
    tmpdir: Path = job["tmpdir"]
    archive = shutil.make_archive(str(tmpdir / "bundle"), "zip", str(tmpdir))
    return Path(archive)


def _watch(job_id: str) -> None:
    job = jobs[job_id]
    proc: subprocess.Popen[str] = job["proc"]
    stage_re = re.compile(r"^\s*([\w-]+):")
    for line in proc.stdout:  # type: ignore[attr-defined]
        job["log"].append(line)
        m = re.search(r"(\d+)%", line)
        if m:
            job["progress"] = int(m.group(1))
        m = re.search(r"ETA[:\s]+([0-9:]+)", line)
        if m:
            job["eta"] = m.group(1)
        m = stage_re.match(line)
        if m:
            job["stage"] = m.group(1)
    proc.wait()
    job["returncode"] = proc.returncode
    job["progress"] = 100
    if proc.returncode == 0:
        try:
            bundle_path = zip_bundle(job_id)
            metrics = job["tmpdir"] / "metrics.json"
            if metrics.exists():
                job["metrics"] = json.loads(metrics.read_text())
            outdir = job.get("outdir")
            if outdir:
                dest = Path(outdir)
                dest.mkdir(parents=True, exist_ok=True)
                for name in ["mix.wav", "stems.mid", bundle_path.name]:
                    src = job["tmpdir"] / name
                    if src.exists():
                        dst = dest / f"{job.get('name', 'output')}{Path(name).suffix}"
                        shutil.copy2(src, dst)
        except Exception:
            pass

    status = "cancelled" if job.get("cancelled") else (
        "completed" if proc.returncode == 0 else "error"
    )
    seed = job.get("seed")
    rhash = None
    progress_file = job["tmpdir"] / "progress.jsonl"
    if progress_file.exists():
        try:
            for line in progress_file.read_text().splitlines():
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if seed is None and "seed" in entry:
                    seed = entry.get("seed")
                if entry.get("stage") == "hash":
                    rhash = entry.get("hash")
        except Exception:
            pass
    record = {
        "id": job_id,
        "preset": job.get("preset"),
        "style": job.get("style"),
        "minutes": job.get("minutes"),
        "sections": job.get("sections"),
        "seed": seed,
        "name": job.get("name"),
        "phrase": job.get("phrase"),
        "preview": job.get("preview"),
        "outdir": job.get("outdir"),
        "status": status,
        "hash": rhash,
    }
    recent = _load_recent()
    recent.append(record)
    _save_recent(recent)


@app.get("/health")
async def health() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def home() -> HTMLResponse:
    return HTMLResponse((REPO_ROOT / "ui" / "index.html").read_text())


@app.get("/generate", response_class=HTMLResponse)
async def generate() -> HTMLResponse:
    return HTMLResponse((REPO_ROOT / "ui" / "generate.html").read_text())


@app.get("/options/{kind}")
async def options(kind: str) -> list[str]:
    if kind not in {"presets", "styles"}:
        raise HTTPException(404, "not found")
    return _options(kind)


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
    outdir: str | None = Form(None),
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
        "stage": None,
        "name": name,
        "outdir": outdir,
        "preset": preset,
        "style": style,
        "seed": seed,
        "minutes": minutes,
        "sections": sections,
        "phrase": phrase,
        "preview": preview,
    }
    threading.Thread(target=_watch, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    status = "running"
    if job.get("cancelled"):
        status = "cancelled"
    elif job.get("returncode") is not None:
        status = "completed" if job["returncode"] == 0 else "error"
    return {
        "status": status,
        "progress": job.get("progress", 0),
        "eta": job.get("eta"),
        "stage": job.get("stage"),
        "log": job.get("log", []),
        "metrics": job.get("metrics"),
    }


@app.get("/recent")
async def recent() -> list[dict]:
    return list(reversed(_load_recent()))


@app.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    proc = job["proc"]
    if proc.poll() is None:
        proc.terminate()
    job["returncode"] = -1
    job["cancelled"] = True
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
