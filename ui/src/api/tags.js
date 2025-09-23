import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const TAG_UPDATE_EVENT = "tag-update::progress";

export const updateSectionTags = (section) =>
  invoke("update_section_tags", { section });

export const listenToTagUpdates = (handler) => listen(TAG_UPDATE_EVENT, handler);

export default {
  updateSectionTags,
  listenToTagUpdates,
};
