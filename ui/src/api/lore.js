import { invoke } from "@tauri-apps/api/core";

export const listLore = () => invoke("lore_list");

