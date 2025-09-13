import { invoke } from "@tauri-apps/api/tauri";

export async function getConfig(key) {
  return invoke("get_config", { key });
}

export async function setConfig(key, value) {
  return invoke("set_config", { key, value });
}

export async function exportConfig() {
  return invoke("export_config");
}
