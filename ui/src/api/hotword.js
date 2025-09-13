import { invoke } from "@tauri-apps/api/tauri";

export const listHotwords = () => invoke("hotword_get");
export const setHotword = (name, enabled) =>
  invoke("hotword_set", { name, enabled });
