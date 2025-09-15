import { Command } from "@tauri-apps/plugin-shell";
import { join } from "@tauri-apps/api/path";
import { createDir } from "@tauri-apps/plugin-fs";

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
  const defaultDir = await join("data", "piper_tests");

  let outPath: string;

  if (options.outPath) {
    outPath = options.outPath;
    const derivedDir = getDirectoryFromPath(options.outPath);
    if (derivedDir) {
      await createDir(derivedDir, { recursive: true });
    }
  } else {
    const dir = options.outDir ?? defaultDir;
    await createDir(dir, { recursive: true });
    outPath = await join(dir, `${Date.now()}.wav`);
  }

  const cmd = Command.create("piper", [
    "--model",
    model,
    "--config",
    config,
    "--output_file",
    outPath,
    text,
  ]);
  const res = await cmd.execute();
  if (res.code !== 0) {
    const message = res.stderr?.trim() || `Piper command failed with code ${res.code}`;
    throw new Error(message);
  }

  return outPath;
}
