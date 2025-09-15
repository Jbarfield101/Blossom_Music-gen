import { Command } from "@tauri-apps/plugin-shell";
import { join, appDataDir } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";

interface PiperSynthOptions {
  outDir?: string;
  outPath?: string;
}

function getDirectoryFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");

  if (lastSlashIndex === -1) {
    return null;
  }

  if (lastSlashIndex === 0) {
    return filePath.slice(0, 1);
  }

  return filePath.slice(0, lastSlashIndex);
}

/**
 * Synthesize speech using the `piper` CLI.
 *
 * @param text     Text to synthesize.
 * @param model    Path to the piper model (.onnx).
 * @param config   Path to the model configuration (.json).
 * @param options  Optional overrides for output directory or path.
 * @returns The path to the generated WAV file.
 */
export async function synthWithPiper(
  text: string,
  model: string,
  config: string,
  options: PiperSynthOptions = {},
): Promise<string> {
  // Write under the app data directory to ensure an absolute, writable path.
  const dataRoot = await appDataDir();
  const defaultDir = await join(dataRoot, "piper_tests");

  let outPath: string;

  if (options.outPath) {
    outPath = options.outPath;
    const derivedDir = getDirectoryFromPath(options.outPath);
    if (derivedDir) {
      await mkdir(derivedDir, { recursive: true });
    }
  } else {
    const dir = options.outDir ?? defaultDir;
    await mkdir(dir, { recursive: true });
    outPath = await join(dir, `${Date.now()}.wav`);
  }

  const args = [
    "--model",
    model,
    "--config",
    config,
    "--output_file",
    outPath,
    text,
  ];

  // Try system `piper` first.
  let res = await Command.create("piper", args).execute();
  // Fallback to venv `piper` if the system one fails to launch or returns an error.
  if (res.code !== 0) {
    const maybeNotFound = /not recognized|not found|No such file|ENOENT/i.test(res.stderr || "");
    if (maybeNotFound || res.code === 9009) {
      res = await Command.create("piper-venv", args).execute();
    }
  }
  if (res.code !== 0) {
    const message = res.stderr?.trim() || `Piper command failed with code ${res.code}`;
    throw new Error(message);
  }

  return outPath;
}
