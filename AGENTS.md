# Repository Guidelines

## Project Structure & Module Organization
Core arrangement, rendering, and evaluation code lives in `core/` (arranger, stems, mixer, phrase models). Reusable audio utilities sit under `blossom/audio/`. Runtime services are grouped by role: `brain/` for orchestration logic, `ears/` for ingestion and bots, and `mouth/` for synthesis outputs. Scripts for analysis and CLI helpers live in `scripts/` and the top-level `main_*.py` entry points. The desktop front end resides in `ui/` (React + Vite) with the native shell in `src-tauri/`. Shared assets and configs are in `assets/`, `config/`, and `data/`, while regression tests live in `tests/`.

## Build, Test, and Development Commands
Activate Python 3.10 via `.venv` (`python -m venv .venv; .\.venv\Scripts\activate` on Windows). Install dependencies with `pip install -r requirements.txt`; optional extras live in the `requirements-*.txt` files. Bootstrap the desktop app with `npm install`, `npm install --prefix ui`, then `npm run tauri dev` for the live shell or `npm run tauri build` for distributables. `python start.py` automates the full bootstrap and launches the CLI.

## Coding Style & Naming Conventions
Follow PEP 8: four-space indentation, snake_case modules and functions, CapWords classes, explicit type hints on new code, and docstrings on public APIs. Keep module boundaries aligned with the existing domains (e.g., phrase logic stays in `core/phrase_model.py`). Front-end components use PascalCase filenames and live under `ui/src/components/` or `ui/src/pages/`. Prefer descriptive stem IDs (`kick_low`, `pads_soft`) that mirror assets under `assets/`.

## Testing Guidelines
Run the canonical suite with `python -m pytest -vv` (or `python tester.py`). GPU- and asset-dependent cases mark themselves with `pytest.importorskip`; install optional dependencies before enabling them. Use `BLOSSOM_PERF_BUDGET=5 pytest tests/test_performance.py` to gate latency-sensitive changes, `pytest tests/test_exported_models.py` after touching ONNX exports, and `npm --prefix ui run test` for the React surface. Clean artefacts in `out/` before committing.

## Commit & Pull Request Guidelines
Write concise, imperative commit titles (`Handle MusicGen cache misses`). Reference scope or issue IDs when available and let merge tooling add `Merge pull request #...` lines. For pull requests, provide: a summary of the change, affected subsystems, reproduction steps or CLI commands, updated screenshots of modified UI, and confirmation that `pytest` plus relevant UI tests succeeded.

## Security & Configuration Tips
Keep API tokens in `secrets.json` or the Tauri store; never commit real keys. Update `render_config.json` and `arrange_config.json` via PRs so defaults stay reproducible. Place large audio assets in `assets/` and reference them through the config files rather than hard-coding paths.

