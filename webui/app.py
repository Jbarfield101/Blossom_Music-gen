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
    UploadFile,
)
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config.obsidian import select_vault

REPO_ROOT = Path(__file__).resolve().parent.parent
MAIN_RENDER = REPO_ROOT / "main_render.py"
ASSETS_DIR = REPO_ROOT / "assets"

app = FastAPI()
# Serve shared front-end assets from the top-level ``ui`` directory
app.mount("/ui", StaticFiles(directory=REPO_ROOT / "ui"), name="ui")


jobs: dict[str, dict] = {}

RECENT_FILE = REPO_ROOT / "webui" / "recent_renders.json"
MAX_RECENT = 10

# Directory used to persist completed bundles so they can be served
# even after the originating temporary directory has been removed.
BUNDLE_DIR = REPO_ROOT / "webui" / "bundles"
BUNDLE_DIR.mkdir(exist_ok=True)


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
            # Persist bundle to a shared directory so it can be served later
            stored_bundle = BUNDLE_DIR / f"{job_id}.zip"
            shutil.copy2(bundle_path, stored_bundle)
            job["bundle"] = str(stored_bundle)

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
        "mix_config": job.get("mix_config"),
        "arrange_config": job.get("arrange_config"),
        "bundle": job.get("bundle"),
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


@app.get("/settings", response_class=HTMLResponse)
async def settings() -> HTMLResponse:
    return HTMLResponse((REPO_ROOT / "ui" / "settings.html").read_text())


@app.get("/train", response_class=HTMLResponse)
async def train() -> HTMLResponse:
    return HTMLResponse((REPO_ROOT / "ui" / "train.html").read_text())


@app.get("/presets")
async def list_presets() -> list[str]:
    return _options("presets")


@app.get("/styles")
async def list_styles() -> list[str]:
    return _options("styles")


class VaultRequest(BaseModel):
    path: str


@app.post("/obsidian/vault")
async def set_obsidian_vault(req: VaultRequest) -> dict[str, str]:
    """Set the Obsidian vault used by the service.

    The provided path must exist and may only be set once.  Subsequent
    attempts to change the vault will raise an error.
    """

    try:
        vault = select_vault(Path(req.path))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="vault path does not exist")
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"vault": str(vault)}


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
        mix_bytes = await mix_config.read()
        mix_path = tmpdir / "mix_config.json"
        mix_path.write_bytes(mix_bytes)
        cmd += ["--mix-config", str(mix_path)]
        jobs_mix = {
            "name": mix_config.filename or "mix_config.json",
            "text": mix_bytes.decode("utf-8", "ignore"),
        }
    else:
        jobs_mix = None
    if arrange_config is not None:
        arr_bytes = await arrange_config.read()
        arr_path = tmpdir / "arrange_config.json"
        arr_path.write_bytes(arr_bytes)
        cmd += ["--arrange-config", str(arr_path)]
        jobs_arr = {
            "name": arrange_config.filename or "arrange_config.json",
            "text": arr_bytes.decode("utf-8", "ignore"),
        }
    else:
        jobs_arr = None

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
        "mix_config": jobs_mix,
        "arrange_config": jobs_arr,
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


@app.get("/bundles/{job_id}")
async def get_bundle(job_id: str):
    """Return the stored ``bundle.zip`` for a completed job.

    If the job is still in memory and its temporary directory exists the
    bundle from that directory is served. Otherwise a copy stored in the
    :data:`BUNDLE_DIR` directory is returned.
    """
    job = jobs.get(job_id)
    # First check if the bundle exists in the job's temporary directory
    if job:
        tmp_bundle = job["tmpdir"] / "bundle.zip"
        if tmp_bundle.exists():
            filename = f"{job.get('name', 'output')}.zip"
            return FileResponse(tmp_bundle, filename=filename)
        # fall back to stored bundle path recorded on the job
        bundle_path = job.get("bundle")
        if bundle_path and Path(bundle_path).exists():
            filename = f"{job.get('name', 'output')}.zip"
            return FileResponse(bundle_path, filename=filename)

    # If the job is not active (or temp dir removed), consult stored recent
    for entry in _load_recent():
        if entry.get("id") == job_id:
            bundle_path = entry.get("bundle")
            if bundle_path and Path(bundle_path).exists():
                filename = f"{entry.get('name', 'output')}.zip"
                return FileResponse(bundle_path, filename=filename)
            break

    raise HTTPException(404, "bundle not found")


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
