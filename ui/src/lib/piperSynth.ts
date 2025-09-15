import { Command } from "@tauri-apps/plugin-shell";
import { createDir, join } from "@tauri-apps/plugin-fs";

/**
 * Synthesize speech using the `piper` CLI.
 *
 * @param text   Text to synthesize.
 * @param model  Path to the piper model (.onnx).
 * @param config Path to the model configuration (.json).
 * @returns The path to the generated WAV file.
 */
export async function synthWithPiper(
  text: string,
  model: string,
  config: string,
): Promise<string> {
  // Ensure output directory exists
  const dir = await join("data", "piper_tests");
  await createDir(dir, { recursive: true });
  const outPath = await join(dir, `${Date.now()}.wav`);

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
