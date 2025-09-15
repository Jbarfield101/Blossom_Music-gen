import { BaseDirectory, readDir, readTextFile, join } from "@tauri-apps/plugin-fs";

export interface PiperVoice {
  id: string;
  modelPath: string;
  configPath: string;
  lang?: string;
  speaker?: string;
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
    const configPath = await join(root, id, `${id}.onnx.json`);
    const modelPath = await join(root, id, `${id}.onnx`);

    let lang: string | undefined;
    let speaker: string | undefined;

    try {
      const cfgRaw = await readTextFile(configPath, {
        baseDir: BaseDirectory.Resource,
      });
      const cfg = JSON.parse(cfgRaw);
      const espeak = cfg?.espeak;
      if (espeak && typeof espeak === "object") {
        const voice = (espeak as { voice?: unknown }).voice;
        if (typeof voice === "string") {
          lang = voice;
        }
      }
      if (!lang && typeof cfg?.language === "string") {
        lang = cfg.language;
      }
      if (typeof cfg?.default_speaker === "string") {
        speaker = cfg.default_speaker;
      }
    } catch {
      // Ignore errors reading or parsing config files.
    }

    voices.push({ id, modelPath, configPath, lang, speaker });
  }

  voices.sort((a, b) => a.id.localeCompare(b.id));

  return voices;
}
