import { invoke } from "@tauri-apps/api/core";

export const getProfile = (guild_id, channel_id) =>
  invoke("discord_profile_get", { guild_id, channel_id });

export const setProfile = (guild_id, channel_id, profile) =>
  invoke("discord_profile_set", { guild_id, channel_id, profile });

