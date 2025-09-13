import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/api/dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/api/fs";
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/tauri";
import {
  listWhisper,
  setWhisper as apiSetWhisper,
  listPiper,
  setPiper as apiSetPiper,
  listLlm,
  setLlm as apiSetLlm,
} from "../api/models";

export default function Settings() {
  const [whisper, setWhisper] = useState({ options: [], selected: "" });
  const [piper, setPiper] = useState({ options: [], selected: "" });
  const [llm, setLlm] = useState({ options: [], selected: "" });
  const [vault, setVault] = useState("");

  const settingsStore = new Store("settings.dat");

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      setPiper(await listPiper());
      setLlm(await listLlm());
      try {
        const v = await settingsStore.get("vault_path");
        if (v) setVault(v);
      } catch (_) {}
    };
    load();
    const unlisten = listen("settings::models", () => load());
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const chooseVault = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await invoke("select_vault", { path: selected });
      await settingsStore.set("vault_path", selected);
      await settingsStore.save();
      setVault(selected);
    }
  };

  const exportSettings = async () => {
    const file = await save({
      defaultPath: "settings.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (file) {
      const entries = await settingsStore.entries();
      const data = Object.fromEntries(entries);
      await writeTextFile(file, JSON.stringify(data, null, 2));
    }
  };

  const importSettings = async () => {
    const file = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    if (file) {
      const text = await readTextFile(file);
      const data = JSON.parse(text);
      for (const [k, v] of Object.entries(data)) {
        await settingsStore.set(k, v);
      }
      await settingsStore.save();
      if (data.vault_path) setVault(data.vault_path);
    }
  };

  return (
    <div>
      <h1>Settings</h1>
      <div>
        <p>Vault: {vault || "(none)"}</p>
        <button onClick={chooseVault}>Choose Vault</button>
        <button onClick={exportSettings}>Export Settings</button>
        <button onClick={importSettings}>Import Settings</button>
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
    </div>
  );
}
