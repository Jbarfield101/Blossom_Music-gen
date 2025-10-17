import { invoke } from "@tauri-apps/api/core";

import { npcCollectionSchema, npcSchema } from "../lib/dndSchemas.js";
import { resolveRelationshipIds } from "../lib/dndIds.js";

export const listNpcs = async () => {
  const response = await invoke("npc_list");
  let normalized = response;
  if (Array.isArray(response)) {
    try {
      normalized = await Promise.all(response.map((npc) => resolveRelationshipIds(npc)));
    } catch (err) {
      const error = new Error("Failed to normalize NPC relationships");
      error.cause = err;
      throw error;
    }
  }
  const parsed = npcCollectionSchema.safeParse(normalized);
  if (!parsed.success) {
    const error = new Error("Invalid NPC payload received from backend");
    error.cause = parsed.error;
    throw error;
  }
  return parsed.data;
};

export const saveNpc = async (npc) => {
  let normalized = npc;
  try {
    normalized = await resolveRelationshipIds(npc);
  } catch (err) {
    const error = new Error("Failed to normalize NPC relationships before save");
    error.cause = err;
    throw error;
  }
  const parsed = npcSchema.safeParse(normalized);
  if (!parsed.success) {
    const error = new Error("Invalid NPC payload supplied to saveNpc");
    error.cause = parsed.error;
    throw error;
  }
  return invoke("npc_save", { npc: parsed.data });
};
export const deleteNpc = (id) => invoke("npc_delete", { id });
export const createNpc = (
  id,
  name,
  region,
  purpose,
  template,
  randomName,
  establishmentPath,
  establishmentName,
) => {
  const parsedId = npcSchema.shape.id.safeParse(id);
  if (!parsedId.success) {
    const error = new Error("Invalid NPC id supplied to createNpc");
    error.cause = parsedId.error;
    throw error;
  }
  return invoke("npc_create", {
    id: parsedId.data,
    name,
    region,
    purpose,
    template,
    random_name: !!randomName,
    establishment_path: establishmentPath ?? null,
    establishment_name: establishmentName ?? null,
  });
};

