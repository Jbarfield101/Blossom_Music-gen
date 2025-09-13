import { invoke } from "@tauri-apps/api/tauri";

export const getConfig = (key) => invoke("get_config", { key });
export const setConfig = (key, value) => invoke("set_config", { key, value });
export const exportConfig = () => invoke("export_config");
