import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export const listDevices = () => invoke("list_devices");
export const setDevices = ({ input, output }) =>
  invoke("set_devices", { input, output });
