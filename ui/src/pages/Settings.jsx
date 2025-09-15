import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  listWhisper,
  setWhisper as apiSetWhisper,
  listPiper,
  setPiper as apiSetPiper,
  listLlm,
  setLlm as apiSetLlm,
} from "../api/models";
import { listDevices, setDevices as apiSetDevices } from "../api/devices";
import { listHotwords, setHotword as apiSetHotword } from "../api/hotwords";
import {
  getConfig,
  setConfig,
  exportSettings as apiExportSettings,
  importSettings as apiImportSettings,
} from "../api/config";
import LogPanel from "../components/LogPanel";
import BackButton from "../components/BackButton.jsx";
import {
  setTheme,
  getTheme,
  setAccent,
  getAccent,
  setBaseFontSize,
  getBaseFontSize,
} from "../../theme.js";

export default function Settings() {
  const VAULT_KEY = "vaultPath";
  const [whisper, setWhisper] = useState({ options: [], selected: "" });
  const [piper, setPiper] = useState({ options: [], selected: "" });
  const [llm, setLlm] = useState({ options: [], selected: "" });
  const [input, setInput] = useState({ options: [], selected: "" });
  const [output, setOutput] = useState({ options: [], selected: "" });
  const [vault, setVault] = useState("");
  const [hotwords, setHotwords] = useState({});
  const [theme, setThemeState] = useState("dark");
  const [accent, setAccentState] = useState("#ff4d6d");
  const [baseFontSize, setBaseFontSizeState] = useState("16px");

  useEffect(() => {
    getTheme().then((savedTheme) => setThemeState(savedTheme || "dark"));
    getAccent().then((savedAccent) => {
      if (savedAccent) {
        setAccentState(savedAccent);
      } else {
        const defaultAccent = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim();
        setAccentState(defaultAccent || "#ff4d6d");
      }
    });
    getBaseFontSize().then((savedSize) => {
      const size = savedSize || "16px";
      setBaseFontSizeState(size);
      setBaseFontSize(size);
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      setPiper(await listPiper());
      setLlm(await listLlm());
      const devices = await listDevices();
      setInput(devices.input);
      setOutput(devices.output);
      const hw = await listHotwords();
      setHotwords(hw);
      const path = await getConfig(VAULT_KEY);
      setVault(path || "");
    };
    load();
    const unlistenModels = listen("settings::models", () => load());
    const unlistenDevices = listen("settings::devices", () => load());
    const unlistenHotwords = listen("settings::hotwords", () => load());
    return () => {
      unlistenModels.then((f) => f());
      unlistenDevices.then((f) => f());
      unlistenHotwords.then((f) => f());
    };
  }, []);

  const chooseVault = async () => {
    const selected = await openDialog({ directory: true });
    if (typeof selected === "string") {
      await invoke("select_vault", { path: selected });
      await setConfig(VAULT_KEY, selected);
      setVault(selected);
    }
  };

  const exportSettings = async () => {
    const filePath = await saveDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (filePath) {
      await apiExportSettings(filePath);
    }
  };

  const importSettings = async () => {
    const filePath = await openDialog({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (typeof filePath === "string") {
      await apiImportSettings(filePath);
      const path = await getConfig(VAULT_KEY);
      setVault(path || "");
    }
  };

  const toggleHotword = async (name, enabled) => {
    await apiSetHotword({ name, enabled });
    setHotwords(await listHotwords());
  };

  const addHotword = async () => {
    const filePath = await openDialog({ multiple: false });
    if (typeof filePath === "string") {
      const parts = filePath.split(/[\\/]/);
      const file = parts[parts.length - 1];
      const name = file.replace(/\.[^.]+$/, "");
      await apiSetHotword({ name, enabled: true, file: filePath });
      setHotwords(await listHotwords());
    }
  };

  return (
    <main>
      <BackButton />
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
      <section>
        <fieldset>
          <legend>Models</legend>
          <div>
            <label htmlFor="whisper-select">Whisper size</label>
            <select
              id="whisper-select"
              value={whisper.selected || ""}
              onChange={(e) => apiSetWhisper(e.target.value)}
            >
              {whisper.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="piper-select">Piper voice</label>
            <select
              id="piper-select"
              value={piper.selected || ""}
              onChange={(e) => apiSetPiper(e.target.value)}
            >
              {piper.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="llm-select">LLM model</label>
            <select
              id="llm-select"
              value={llm.selected || ""}
              onChange={(e) => apiSetLlm(e.target.value)}
            >
              {llm.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      </section>
      <section>
        <fieldset>
          <legend>Devices</legend>
          <div>
            <label htmlFor="input-device">Input device</label>
            <select
              id="input-device"
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
          </div>
          <div>
            <label htmlFor="output-device">Output device</label>
            <select
              id="output-device"
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
          </div>
        </fieldset>
      </section>
      <section>
        <fieldset>
          <legend>Appearance</legend>
          <div>
            <label htmlFor="theme-select">Theme</label>
            <select
              id="theme-select"
              value={theme}
              onChange={async (e) => {
                const newTheme = e.target.value;
                await setTheme(newTheme);
                setThemeState(newTheme);
              }}
              aria-describedby="theme-desc"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <p id="theme-desc">
              Dark mode reduces eye strain in low-light environments, while light
              mode provides better readability in bright settings.
            </p>
          </div>
          <div>
            <label htmlFor="accent-color">Accent color</label>
            <input
              id="accent-color"
              type="color"
              value={accent}
              onChange={async (e) => {
                const color = e.target.value;
                await setAccent(color);
                setAccentState(color);
              }}
            />
          </div>
          <div>
            <label htmlFor="font-size">Font Size</label>
            <select
              id="font-size"
              value={baseFontSize}
              onChange={async (e) => {
                const size = e.target.value;
                await setBaseFontSize(size);
                setBaseFontSizeState(size);
              }}
              aria-describedby="font-desc"
            >
              <option value="16px">Default</option>
              <option value="18px">Large</option>
            </select>
            <p id="font-desc">
              Larger fonts improve readability for visually impaired users.
            </p>
          </div>
        </fieldset>
      </section>
      <section>
        <fieldset>
          <legend>Hotwords</legend>
          <ul>
            {Object.entries(hotwords).map(([name, enabled]) => {
              const id = `hotword-${name}`.replace(/\s+/g, "-");
              return (
                <li key={name}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleHotword(name, e.target.checked)}
                  />
                  <label htmlFor={id}>{name}</label>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={addHotword}>
            Upload Hotword Model
          </button>
        </fieldset>
      </section>
      <LogPanel />
    </main>
  );
}

