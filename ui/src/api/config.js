import { invoke } from "@tauri-apps/api/core";

export const getConfig = (key) => invoke("get_config", { key });
export const setConfig = (key, value) => invoke("set_config", { key, value });
export const exportSettings = (path) => invoke("export_settings", { path });
export const importSettings = (path) => invoke("import_settings", { path });
export const getDreadhavenRoot = () => invoke("get_dreadhaven_root");

