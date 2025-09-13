import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/api/dialog";
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
  const settingsStore = useRef(new Store("settings.json"));

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      setPiper(await listPiper());
      setLlm(await listLlm());
      setVault((await settingsStore.current.get("vault")) || "");
    };
    load();
    const unlisten = listen("settings::models", () => load());
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const chooseVault = async () => {
    const dir = await open({ directory: true });
    if (typeof dir === "string") {
      await invoke("select_vault", { path: dir });
      await settingsStore.current.set("vault", dir);
      await settingsStore.current.save();
      setVault(dir);
    }
  };

  const exportSettings = async () => {
    const file = await save({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (file) {
      await settingsStore.current.save(file);
    }
  };

  const importSettings = async () => {
    const file = await open({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof file === "string") {
      await settingsStore.current.load(file);
      setVault((await settingsStore.current.get("vault")) || "");
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
