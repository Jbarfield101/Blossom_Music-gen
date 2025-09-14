import { invoke } from "@tauri-apps/api/core";
export const testPiper = (voice, text) =>
    invoke("piper_test", { voice, text });

export const discoverPiperVoices = () =>
    invoke("discover_piper_voices");

