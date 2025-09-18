import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  listWhisper,
  setWhisper as apiSetWhisper,
  setPiper as apiSetPiper,
  listLlm,
  setLlm as apiSetLlm,
} from "../api/models";
import { listPiperVoices } from "../lib/piperVoices";
import { listDevices, setDevices as apiSetDevices } from "../api/devices";
import { listHotwords, setHotword as apiSetHotword } from "../api/hotwords";
import {
  getConfig,
  setConfig,
  exportSettings as apiExportSettings,
  importSettings as apiImportSettings,
} from "../api/config";
import { getVersion } from "../api/version";
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
import "./Settings.css";

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
  const [versions, setVersions] = useState({ app: "", python: "" });
  const [vaultError, setVaultError] = useState("");
  const vaultRef = useRef("");

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

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
    let active = true;

    getVersion()
      .then((fetched) => {
        if (!active) {
          return;
        }
        setVersions({
          app: fetched?.app ?? "",
          python: fetched?.python ?? "",
        });
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setVersions({ app: "", python: "" });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      const voices = await listPiperVoices();
      setPiper((prev) => {
        const options = (voices || []).map((v) => ({ id: v.id, label: v.label || v.id }));
        const ids = options.map((o) => o.id);
        const selected = ids.includes(prev.selected)
          ? prev.selected
          : (ids[0] || "");
        return { options, selected };
      });
      setLlm(await listLlm());
      const devices = await listDevices();
      setInput(devices.input);
      setOutput(devices.output);
      const hw = await listHotwords();
      setHotwords(hw);
      const path = await getConfig(VAULT_KEY);
      const normalizedPath = path || "";
      const shouldInvoke = Boolean(path) && path !== vaultRef.current;

      setVault(normalizedPath);

      if (path) {
        if (shouldInvoke) {
          try {
            await invoke("select_vault", { path });
            setVaultError("");
          } catch (err) {
            console.error("Failed to start vault watcher", err);
            setVaultError(
              "Failed to start the vault watcher automatically. Please choose the vault again.",
            );
          }
        } else {
          setVaultError("");
        }
      } else {
        setVaultError("");
      }
    };
    const reload = () =>
      load().catch((err) => {
        console.error("Failed to refresh settings data", err);
      });

    reload();
    let active = true;
    const cleanups = [];

    const registerListener = async (eventName) => {
      try {
        const unlisten = await listen(eventName, reload);
        if (active) {
          cleanups.push(unlisten);
        } else {
          unlisten();
        }
      } catch (err) {
        console.error(`Failed to register listener for ${eventName}`, err);
      }
    };

    registerListener("settings::models");
    registerListener("settings::devices");
    registerListener("settings::hotwords");
    return () => {
      active = false;
      cleanups.forEach((unlisten) => {
        try {
          unlisten();
        } catch (err) {
          console.error("Failed to unregister settings listener", err);
        }
      });
    };
  }, []);

  const chooseVault = async () => {
    try {
      const res = await openDialog({ directory: true });
      if (!res) return;
      const path =
        Array.isArray(res)
          ? typeof res[0] === "string"
            ? res[0]
            : res[0]?.path
          : typeof res === "string"
          ? res
          : res?.path;
      if (path) {
        await invoke("select_vault", { path });
        await setConfig(VAULT_KEY, path);
        setVault(path);
        setVaultError("");
      } else {
        const message = "Failed to determine vault path from selection";
        console.error(message, res);
        setVaultError("Could not determine the vault folder. Please try again.");
      }
    } catch (err) {
      console.error('Folder selection failed', err);
      setVaultError("Failed to open the vault picker. Please try again.");
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
    <main className="settings">
      <BackButton />
      <h1>Settings</h1>
      <section className="settings-section">
        <p>Vault path: {vault || "(none)"}</p>
        {vaultError && <p className="error">{vaultError}</p>}
        <div className="button-row">
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
      </section>
      <section className="settings-section">
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
            <button
              type="button"
              className="ml-sm"
              onClick={async () => {
                const voices = await listPiperVoices();
                setPiper((prev) => {
                  const options = (voices || []).map((v) => ({ id: v.id, label: v.label || v.id }));
                  const ids = options.map((o) => o.id);
                  const selected = ids.includes(prev.selected)
                    ? prev.selected
                    : (ids[0] || "");
                  return { options, selected };
                });
              }}
              style={{ marginLeft: "0.5rem" }}
            >
              Refresh
            </button>
            <select
              id="piper-select"
              value={piper.selected || ""}
              onChange={(e) => {
                const value = e.target.value;
                setPiper((prev) => ({ ...prev, selected: value }));
                apiSetPiper(value);
              }}
            >
              {piper.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label || o.id}
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
      <section className="settings-section">
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
      <section className="settings-section">
        <fieldset>
          <legend>Appearance</legend>
          <div>
            <label htmlFor="theme-select">Theme</label>
            <select
              id="theme-select"
              value={theme}
              aria-describedby="theme-desc"
              onChange={async (e) => {
                const newTheme = e.target.value;
                await setTheme(newTheme);
                setThemeState(newTheme);
              }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <p id="theme-desc">
              Dark mode reduces eye strain in low-light environments, while
              light mode provides better readability in bright settings.
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
            <label htmlFor="font-size-select">Font Size</label>
            <select
              id="font-size-select"
              value={baseFontSize}
              aria-describedby="font-size-desc"
              onChange={async (e) => {
                const size = e.target.value;
                await setBaseFontSize(size);
                setBaseFontSizeState(size);
              }}
            >
              <option value="16px">Default</option>
              <option value="18px">Large</option>
            </select>
            <p id="font-size-desc">
              Larger fonts improve readability for visually impaired users.
            </p>
          </div>
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>Hotwords</legend>
          <ul>
            {Object.entries(hotwords).map(([name, enabled]) => {
              const id = `hotword-${name}`;
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
      <section className="settings-section">
        <LogPanel />
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>About</legend>
          <p>App Version: {versions.app}</p>
          <p>Python Version: {versions.python}</p>
        </fieldset>
      </section>
    </main>
  );
}

