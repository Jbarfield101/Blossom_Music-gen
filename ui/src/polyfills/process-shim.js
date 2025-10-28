/**
 * Minimal browser-safe shim for the `process` global that some third-party
 * packages (e.g. @excalidraw/excalidraw) expect when running in a Node
 * environment. The library only reads from `process.env` to detect the current
 * mode, so we expose a lightweight object rather than pulling in the full node
 * polyfill bundle.
 */
const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;
const existingProcess = typeof globalScope.process === 'object' && globalScope.process
  ? globalScope.process
  : {};
const env = (typeof existingProcess.env === 'object' && existingProcess.env) || {};

if (typeof env.NODE_ENV !== 'string') {
  env.NODE_ENV = import.meta.env?.MODE ?? 'development';
}

// Many libs use this flag to guard browser-specific branches.
env.BROWSER = true;

const shimmedProcess = {
  ...existingProcess,
  env,
  browser: true,
};

globalScope.process = shimmedProcess;
