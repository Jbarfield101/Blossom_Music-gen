import { invoke } from "@tauri-apps/api/tauri";

export const listDevices = () => invoke("list_devices");
export const setDevices = ({ input, output }) =>
  invoke("set_devices", { input, output });
