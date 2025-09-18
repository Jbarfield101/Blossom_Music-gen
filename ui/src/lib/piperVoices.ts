import { join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readDir, readTextFile } from "@tauri-apps/plugin-fs";

export interface PiperVoice {
  id: string;
  modelPath: string;
  configPath: string;
  lang?: string;
  speaker?: number | string;
  label?: string;
}

export async function listPiperVoices(): Promise<PiperVoice[]> {
  // Prefer backend enumeration which works in dev and prod
  try {
    const items = (await invoke("list_bundled_voices")) as any[];
    if (Array.isArray(items) && items.length) {
      return items.map((it) => ({
        id: String(it.id),
        modelPath: String(it.modelPath),
        configPath: String(it.configPath),
        lang: typeof it.lang === "string" ? it.lang : undefined,
        speaker: typeof it.speaker === "number" || typeof it.speaker === "string" ? it.speaker : undefined,
        label: typeof it.label === "string" ? it.label : undefined,
      }));
    }
  } catch {
    // fall back to FS-based discovery below
  }

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

    // Discover actual filenames inside the directory instead of assuming `${id}.onnx*`.
    let modelFile = "";
    let configFile = "";
    try {
      const files = await readDir(`${root}/${id}`, { baseDir: BaseDirectory.Resource });
      for (const f of files) {
        const name = f.name || "";
        if (!f.isFile || !name) continue;
        if (!modelFile && name.toLowerCase().endsWith(".onnx")) modelFile = name;
        if (!configFile && name.toLowerCase().endsWith(".onnx.json")) configFile = name;
      }
    } catch {
      // skip this voice if we cannot read its contents
      continue;
    }
    if (!modelFile || !configFile) {
      // Incomplete voice folder
      continue;
    }

    const modelPath = await join(root, id, modelFile);
    const configPath = await join(root, id, configFile);

    let lang: string | undefined;
    let speaker: number | string | undefined;

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
      const defaultSpeaker = cfg?.default_speaker;
      if (typeof defaultSpeaker === "string" || typeof defaultSpeaker === "number") {
        speaker = defaultSpeaker;
      }
    } catch {
      // Ignore errors reading or parsing config files.
    }

    voices.push({ id, modelPath, configPath, lang, speaker });
  }

  voices.sort((a, b) => a.id.localeCompare(b.id));

  return voices;
}
