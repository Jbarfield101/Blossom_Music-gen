import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import { open as openDialog, save as saveDialog } from "@tauri-apps/api/dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/api/fs";
import { Store } from "@tauri-apps/plugin-store";
import {
  listWhisper,
  setWhisper as apiSetWhisper,
  listPiper,
  setPiper as apiSetPiper,
  listLlm,
  setLlm as apiSetLlm,
} from "../api/models";
import { listDevices, setDevices as apiSetDevices } from "../api/devices";

export default function Settings() {
  const store = new Store("settings.dat");
  const VAULT_KEY = "vaultPath";
  const [whisper, setWhisper] = useState({ options: [], selected: "" });
  const [piper, setPiper] = useState({ options: [], selected: "" });
  const [llm, setLlm] = useState({ options: [], selected: "" });
  const [input, setInput] = useState({ options: [], selected: "" });
  const [output, setOutput] = useState({ options: [], selected: "" });
  const [vault, setVault] = useState("");

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      setPiper(await listPiper());
      setLlm(await listLlm());
      const devices = await listDevices();
      setInput(devices.input);
      setOutput(devices.output);
      const path = await store.get(VAULT_KEY);
      setVault(path || "");
    };
    load();
    const unlistenModels = listen("settings::models", () => load());
    const unlistenDevices = listen("settings::devices", () => load());
    return () => {
      unlistenModels.then((f) => f());
      unlistenDevices.then((f) => f());
    };
  }, []);

  const chooseVault = async () => {
    const selected = await openDialog({ directory: true });
    if (typeof selected === "string") {
      await invoke("select_vault", { path: selected });
      await store.set(VAULT_KEY, selected);
      await store.save();
      setVault(selected);
    }
  };

  const exportSettings = async () => {
    const entries = await store.entries();
    const data = Object.fromEntries(entries);
    const filePath = await saveDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (filePath) {
      await writeTextFile(filePath, JSON.stringify(data, null, 2));
    }
  };

  const importSettings = async () => {
    const filePath = await openDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (typeof filePath === "string") {
      const contents = await readTextFile(filePath);
      const data = JSON.parse(contents);
      for (const [key, value] of Object.entries(data)) {
        await store.set(key, value);
      }
      await store.save();
      if (data[VAULT_KEY]) {
        setVault(data[VAULT_KEY]);
      }
    }
  };

  return (
    <div>
      <h1>Settings</h1>
      <div>
        <p>Vault path: {vault || "(none)"}</p>
        <button type="button" onClick={chooseVault}>
          Choose Vault
        </button>
        <button type="button" onClick={exportSettings}>
          Export Settings
        </button>
        <button type="button" onClick={importSettings}>
          Import Settings
        </button>
      </div>
      <div>
        <label>
          Whisper size
          <select
            value={whisper.selected || ""}
            onChange={(e) => apiSetWhisper(e.target.value)}
          >
            {whisper.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Piper voice
          <select
            value={piper.selected || ""}
            onChange={(e) => apiSetPiper(e.target.value)}
          >
            {piper.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          LLM model
          <select
            value={llm.selected || ""}
            onChange={(e) => apiSetLlm(e.target.value)}
          >
            {llm.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Input device
          <select
            value={input.selected || ""}
            onChange={(e) =>
              apiSetDevices({
                input: Number(e.target.value),
                output: output.selected,
              })
            }
          >
            {input.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Output device
          <select
            value={output.selected || ""}
            onChange={(e) =>
              apiSetDevices({
                input: input.selected,
                output: Number(e.target.value),
              })
            }
          >
            {output.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
