import { invoke } from "@tauri-apps/api/core";

export const listWhisper = () => invoke("list_whisper");
export const setWhisper = (model) => invoke("set_whisper", { model });

export const setPiper = (voice) => invoke("set_piper", { voice });
export const listPiper = () => invoke("list_piper");

export const listLlm = () => invoke("list_llm");
export const setLlm = (model) => invoke("set_llm", { model });

