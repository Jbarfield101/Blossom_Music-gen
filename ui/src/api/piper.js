import { invoke } from "@tauri-apps/api/core";
export const testPiper = (voice, text) =>
    invoke("piper_test", { voice, text });

export const discoverPiperVoices = () =>
    invoke("discover_piper_voices");

export const addPiperVoice = (voice, name, tags) =>
    invoke("add_piper_voice", { voice, name, tags });

export const listPiperProfiles = () =>
    invoke("list_piper_profiles");

export const updatePiperProfile = (original, name, tags) =>
    invoke("update_piper_profile", { original, name, tags });

export const removePiperProfile = (name) =>
    invoke("remove_piper_profile", { name });

