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
import { Store } from "@tauri-apps/plugin-store";
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
  const [currentUser, setCurrentUser] = useState("");
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
    (async () => {
      try {
        const store = await Store.load("users.json");
        const cur = await store.get("currentUser");
        if (typeof cur === "string") setCurrentUser(cur);
      } catch (e) {
        console.warn("Failed to load current user", e);
      }
    })();
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
    let active = true;
    const cleanups = [];

    const applyPiperVoices = (voices) => {
      if (!active) {
        return;
      }
      setPiper((prev) => {
        const options = (voices || []).map((v) => ({ id: v.id, label: v.label || v.id }));
        const ids = options.map((o) => o.id);
        const prevSelected = prev.selected || "";
        const selected = ids.includes(prevSelected) ? prevSelected : ids[0] || "";
        return { options, selected };
      });
    };

    const refreshWhisper = async () => {
      const data = await listWhisper();
      if (!active) {
        return;
      }
      setWhisper(data);
    };

    const refreshPiperVoices = async () => {
      const voices = await listPiperVoices();
      if (!active) {
        return;
      }
      applyPiperVoices(voices);
    };

    const refreshLlm = async () => {
      const data = await listLlm();
      if (!active) {
        return;
      }
      setLlm(data);
    };

    const refreshModels = async () => {
      await refreshWhisper();
      await refreshPiperVoices();
      await refreshLlm();
    };

    const refreshDevices = async () => {
      const devices = await listDevices();
      if (!active) {
        return;
      }
      setInput(devices.input);
      setOutput(devices.output);
    };

    const refreshHotwords = async () => {
      const hw = await listHotwords();
      if (!active) {
        return;
      }
      setHotwords(hw);
    };

    const load = async () => {
      await refreshModels();
      await refreshDevices();
      await refreshHotwords();
      const path = await getConfig(VAULT_KEY);
      if (!active) {
        return;
      }
      const normalizedPath = path || "";
      const shouldInvoke = Boolean(path) && path !== vaultRef.current;

      if (!active) {
        return;
      }
      setVault(normalizedPath);

      if (!active) {
        return;
      }

      if (path) {
        if (shouldInvoke) {
          try {
            await invoke("select_vault", { path });
            if (!active) {
              return;
            }
            setVaultError("");
          } catch (err) {
            console.error("Failed to start vault watcher", err);
            if (!active) {
              return;
            }
            setVaultError(
              "Failed to start the vault watcher automatically. Please choose the vault again.",
            );
          }
        } else if (active) {
          setVaultError("");
        }
      } else if (active) {
        setVaultError("");
      }
    };

    const reload = () =>
      load().catch((err) => {
        console.error("Failed to refresh settings data", err);
      });

    const handleModelsEvent = (event) => {
      if (!active) {
        return;
      }
      const payload = event?.payload;
      if (!payload || typeof payload !== "object") {
        refreshModels().catch((err) => {
          console.error("Failed to refresh models", err);
        });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(payload, "whisper")) {
        const selected = typeof payload.whisper === "string" ? payload.whisper : "";
        setWhisper((prev) => ({ ...prev, selected }));
      }
      if (Object.prototype.hasOwnProperty.call(payload, "llm")) {
        const selected = typeof payload.llm === "string" ? payload.llm : "";
        setLlm((prev) => ({ ...prev, selected }));
      }
      if (Object.prototype.hasOwnProperty.call(payload, "piper")) {
        const selected = typeof payload.piper === "string" ? payload.piper : "";
        let needsVoiceRefresh = false;
        setPiper((prev) => {
          const options = Array.isArray(prev.options) ? prev.options : [];
          const hasVoice = options.some((opt) => opt.id === selected);
          if (!hasVoice && selected) {
            needsVoiceRefresh = true;
          }
          return { ...prev, selected };
        });
        if (needsVoiceRefresh) {
          refreshPiperVoices().catch((err) => {
            console.error("Failed to refresh piper voices", err);
          });
        }
      }
    };

    const registerListener = async (eventName, handler) => {
      try {
        const unlisten = await listen(eventName, handler);
        if (active) {
          cleanups.push(unlisten);
        } else {
          unlisten();
        }
      } catch (err) {
        console.error(`Failed to register listener for ${eventName}`, err);
      }
    };

    reload();

    registerListener("settings::models", handleModelsEvent);
    registerListener("settings::devices", () => {
      if (!active) {
        return;
      }
      refreshDevices().catch((err) => {
        console.error("Failed to refresh devices", err);
      });
    });
    registerListener("settings::hotwords", () => {
      if (!active) {
        return;
      }
      refreshHotwords().catch((err) => {
        console.error("Failed to refresh hotwords", err);
      });
    });

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
        <fieldset>
          <legend>Users</legend>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>Current user: <strong>{currentUser || 'None'}</strong></div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const store = await Store.load('users.json');
                  await store.delete('currentUser');
                  await store.save();
                  setCurrentUser('');
                  localStorage.removeItem('blossom.currentUser');
                  location.reload();
                } catch (e) {
                  console.error('Failed to clear current user', e);
                }
              }}
            >
              Switch User
            </button>
          </div>
        </fieldset>
      </section>
      {/* AI Voice Labs links removed per request; now accessible via Tools only */}
      <section className="settings-section">
        <p>Vault path: {vault || "(none)"}</p>
        {vaultError && <p className="error">{vaultError}</p>}
        <div className="button-row">
          <button type="button" onClick={chooseVault}>
            Choose Vault
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
              onChange={async (e) => {
                const value = e.target.value;
                setWhisper((prev) => ({ ...prev, selected: value }));
                await apiSetWhisper(value);
              }}
            >
              {whisper.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="piper-select">Default Blossom Voice</label>
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
              onChange={async (e) => {
                const value = e.target.value;
                setLlm((prev) => ({ ...prev, selected: value }));
                await apiSetLlm(value);
              }}
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
                onChange={async (e) => {
                  const value = Number(e.target.value);
                  const currentOutput = output.selected;
                  setInput((prev) => ({ ...prev, selected: value }));
                  setOutput((prev) =>
                    prev.selected === currentOutput ? prev : { ...prev, selected: currentOutput }
                  );
                  await apiSetDevices({
                    input: value,
                    output: currentOutput,
                  });
                }}
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
                onChange={async (e) => {
                  const value = Number(e.target.value);
                  const currentInput = input.selected;
                  setOutput((prev) => ({ ...prev, selected: value }));
                  setInput((prev) =>
                    prev.selected === currentInput ? prev : { ...prev, selected: currentInput }
                  );
                  await apiSetDevices({
                    input: currentInput,
                    output: value,
                  });
                }}
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
          <legend>Settings Backup</legend>
          <p>Export or import all Blossom preferences for safekeeping.</p>
          <div className="button-row">
            <button type="button" onClick={exportSettings}>
              Export Settings
            </button>
            <button type="button" onClick={importSettings}>
              Import Settings
            </button>
          </div>
        </fieldset>
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

