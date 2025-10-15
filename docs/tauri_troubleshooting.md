# Tauri build troubleshooting

The Tauri shell compiles Rust commands that are exposed from `src-tauri/src/commands.rs`.
If the generated shims cannot be found (e.g. errors such as `cannot find type 'ComfyUISettings'` or
`failed to resolve: could not find '__cmd__get_stable_audio_templates'`), make sure the local checkout
and build artifacts are up to date.

## 1. Refresh the repository state

Make sure the workspace is aligned with `main` before rebuilding. If you have local changes, stash
or commit them first.

```bash
# from the repository root
cd Blossom_Music-gen

git fetch origin
# optional: inspect the diff to confirm nothing conflicts
# git status
# git diff

git reset --hard origin/main
```

On Windows PowerShell, use the same commands (PowerShell forwards them to Git Bash or the native Git
CLI).

## 2. Clear build artifacts

Old Rust or Node artifacts can shadow newly added commands. Remove the cached outputs before running
another build:

```bash
# Clean the Rust side
cargo clean

# Clean the Node/Tauri bundle
rm -rf src-tauri/target
rm -rf node_modules ui/node_modules
rm -rf src-tauri/gen
```

On Windows, substitute `rm -rf` with `Remove-Item -Recurse -Force`.

## 3. Reinstall dependencies and rebuild

Reinstall dependencies for both the root workspace and the `ui/` project, then rebuild Tauri.

```bash
npm install
npm install --prefix ui
npm run tauri build
```

If you prefer to test in development mode, use `npm run tauri dev` after installing dependencies.

## 4. Verify command availability

The generated bindings live under `src-tauri/gen`. After the build completes, inspect the generated
Rust files (for example, `src-tauri/gen/commands.rs`) and confirm the `__cmd__*` functions appear for
the ComfyUI helpers. Re-run the build if anything is missing.

## 5. Additional cleanup

If TypeScript type generation or Vite caching still reference stale APIs, restart the dev server and
delete the Vite cache:

```bash
rm -rf ui/node_modules/.vite
npm run tauri dev
```

This forces Vite to rebuild the React bundle against the refreshed Tauri commands.
