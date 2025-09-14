import { invoke } from "@tauri-apps/api/core";

export const listHotwords = () => invoke("hotword_get");
export const setHotword = ({ name, enabled, file }) =>
  invoke("hotword_set", { name, enabled, file });

