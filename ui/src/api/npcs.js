import { invoke } from "@tauri-apps/api/core";

import { npcCollectionSchema, npcSchema } from "../lib/dndSchemas.js";

export const listNpcs = async () => {
  const response = await invoke("npc_list");
  const parsed = npcCollectionSchema.safeParse(response);
  if (!parsed.success) {
    const error = new Error("Invalid NPC payload received from backend");
    error.cause = parsed.error;
    throw error;
  }
  return parsed.data;
};

export const saveNpc = async (npc) => {
  const parsed = npcSchema.safeParse(npc);
  if (!parsed.success) {
    const error = new Error("Invalid NPC payload supplied to saveNpc");
    error.cause = parsed.error;
    throw error;
  }
  return invoke("npc_save", { npc: parsed.data });
};
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

