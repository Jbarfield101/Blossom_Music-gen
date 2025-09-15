import { invoke } from "@tauri-apps/api/core";

export const getVersion = () => invoke("app_version");
