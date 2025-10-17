import { invoke } from "@tauri-apps/api/core";

export const listNpcs = () => invoke("npc_list");
export const saveNpc = (npc) => invoke("npc_save", { npc });
export const deleteNpc = (id) => invoke("npc_delete", { id });
export const createNpc = (
  name,
  region,
  purpose,
  template,
  randomName,
  establishmentPath,
  establishmentName,
) => invoke("npc_create", {
  name,
  region,
  purpose,
  template,
  random_name: !!randomName,
  establishment_path: establishmentPath ?? null,
  establishment_name: establishmentName ?? null,
});

