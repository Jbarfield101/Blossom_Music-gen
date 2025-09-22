import { invoke } from "@tauri-apps/api/core";

export const listNpcs = () => invoke("npc_list");
export const saveNpc = (npc) => invoke("npc_save", { npc });
export const deleteNpc = (name) => invoke("npc_delete", { name });
export const createNpc = (name, region, purpose, template, randomName) =>
  invoke("npc_create", { name, region, purpose, template, random_name: !!randomName });

