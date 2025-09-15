import { BaseDirectory, readDir, readTextFile, join } from "@tauri-apps/plugin-fs";

export interface PiperVoice {
  id: string;
  config?: unknown;
}

export async function listPiperVoices(): Promise<PiperVoice[]> {
  const root = "assets/voice_models";
  let entries;
  try {
    entries = await readDir(root, { baseDir: BaseDirectory.Resource });
  } catch {
    return [];
  }

  const voices: PiperVoice[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory || !entry.name) continue;
    const id = entry.name;
    let config: unknown;
    try {
      const configPath = await join(root, id, `${id}.onnx.json`);
      const text = await readTextFile(configPath, { baseDir: BaseDirectory.Resource });
      config = JSON.parse(text);
    } catch {
      config = undefined;
    }
    voices.push({ id, config });
  }

  return voices;
}
