import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/dialog";
import { readBinaryFile, writeBinaryFile } from "@tauri-apps/api/fs";
import { basename, join, resourceDir } from "@tauri-apps/api/path";
import {
  listWhisper,
  setWhisper as apiSetWhisper,
  listPiper,
  setPiper as apiSetPiper,
  listLlm,
  setLlm as apiSetLlm,
} from "../api/models";
import { listDevices, setDevices as apiSetDevices } from "../api/devices";
import { listHotwords, setHotword as apiSetHotword } from "../api/hotword";

export default function Settings() {
  const [whisper, setWhisper] = useState({ options: [], selected: "" });
  const [piper, setPiper] = useState({ options: [], selected: "" });
  const [llm, setLlm] = useState({ options: [], selected: "" });
  const [input, setInput] = useState({ options: [], selected: "" });
  const [output, setOutput] = useState({ options: [], selected: "" });
  const [hotwords, setHotwords] = useState({});

  useEffect(() => {
    const load = async () => {
      setWhisper(await listWhisper());
      setPiper(await listPiper());
      setLlm(await listLlm());
      const devices = await listDevices();
      setInput(devices.input);
      setOutput(devices.output);
      setHotwords(await listHotwords());
    };
    load();
    const unlistenModels = listen("settings::models", () => load());
    const unlistenDevices = listen("settings::devices", () => load());
    const unlistenHot = listen("settings::hotwords", () => load());
    return () => {
      unlistenModels.then((f) => f());
      unlistenDevices.then((f) => f());
      unlistenHot.then((f) => f());
    };
  }, []);

  return (
    <div>
      <h1>Settings</h1>
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
      <div>
        <h2>Hotwords</h2>
        {Object.entries(hotwords).map(([name, enabled]) => (
          <label key={name} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => apiSetHotword(name, !enabled)}
            />
            {name}
          </label>
        ))}
        <button
          onClick={async () => {
            const file = await open({ multiple: false });
            if (file) {
              const data = await readBinaryFile(file);
              const dir = await join(await resourceDir(), "ears", "hotwords");
              const dest = await join(dir, await basename(file));
              await writeBinaryFile({ path: dest, contents: data });
              setHotwords(await listHotwords());
            }
          }}
        >
          Upload model
        </button>
      </div>
    </div>
  );
}
