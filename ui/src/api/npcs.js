import { invoke } from "@tauri-apps/api/core";

export const listNpcs = () => invoke("npc_list");
export const saveNpc = (npc) => invoke("npc_save", { npc });
export const deleteNpc = (name) => invoke("npc_delete", { name });

