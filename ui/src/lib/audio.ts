import { readFile } from "@tauri-apps/plugin-fs";
import { fileSrc } from "./paths.js";

const audioBlobMap = new WeakMap<HTMLAudioElement, string>();

function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI_METADATA__);
}

function inferAudioMime(path: string | null | undefined): string {
  if (typeof path !== "string") {
    return "audio/wav";
  }
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (normalized.endsWith(".ogg")) {
    return "audio/ogg";
  }
  if (normalized.endsWith(".flac")) {
    return "audio/flac";
  }
  return "audio/wav";
}

async function createBlobUrlFromPath(path: string, mime: string): Promise<string | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  try {
    const data = await readFile(path);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn("Failed to create blob URL from path", error);
    return null;
  }
}

export async function createAudioElementFromPath(path: string): Promise<HTMLAudioElement> {
  if (!path) {
    throw new Error("Missing audio path.");
  }

  const mime = inferAudioMime(path);
  let resolvedSrc = await createBlobUrlFromPath(path, mime);

  if (!resolvedSrc) {
    resolvedSrc = fileSrc(path);
  }

  if (!resolvedSrc) {
    throw new Error("Unable to resolve audio source.");
  }

  const audio = new Audio(resolvedSrc);
  if (resolvedSrc.startsWith("blob:")) {
    audioBlobMap.set(audio, resolvedSrc);
  }
  return audio;
}

export function disposeAudioElement(audio: HTMLAudioElement | null | undefined): void {
  if (!audio) {
    return;
  }
  try {
    audio.pause();
  } catch {
    // ignore pause errors
  }
  const blobUrl = audioBlobMap.get(audio);
  if (blobUrl) {
    try {
      if (typeof URL !== "undefined") {
        URL.revokeObjectURL(blobUrl);
      }
    } catch {
      // best-effort cleanup
    } finally {
      audioBlobMap.delete(audio);
    }
  }
}
