import { useEffect, useState } from "react";
import { listNpcs, saveNpc, deleteNpc } from "../api/npcs";
import {
  addPiperVoice,
  listPiperProfiles,
  updatePiperProfile,
  removePiperProfile,
} from "../api/piper";
import { listPiperVoices } from "../lib/piperVoices";
import { synthWithPiper } from "../lib/piperSynth";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import BackButton from "../components/BackButton.jsx";
import Icon from "../components/Icon.jsx";
import "./Dnd.css";

export default function Dnd() {
  const emptyNpc = { name: "", description: "", prompt: "", voice: "" };
  const [npcs, setNpcs] = useState([]);
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(emptyNpc);
  const [section, setSection] = useState("Lore");
  const [piperVoice, setPiperVoice] = useState("");
  const [piperText, setPiperText] = useState("");
  const [piperAudio, setPiperAudio] = useState("");
  const [piperPath, setPiperPath] = useState("");
  const [piperSection, setPiperSection] = useState("");
  const [piperAvailableVoices, setPiperAvailableVoices] = useState([]);
  const [addingVoice, setAddingVoice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [voiceTags, setVoiceTags] = useState("");
  const [piperProfiles, setPiperProfiles] = useState([]);
  const [piperBinaryAvailable, setPiperBinaryAvailable] = useState(true);
  const [piperError, setPiperError] = useState("");

  const refresh = async () => {
    setNpcs(await listNpcs());
  };

  const fetchProfiles = async () => {
    try {
      const list = await listPiperProfiles();
      setPiperProfiles(
        (list || []).map((p) => ({
          ...p,
          tags: (p.tags || []).join(", "),
          original: p.name,
        }))
      );
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
    listPiperVoices().then((list) => {
      const opts = list.map((v) => v.id);
      if (opts.length === 0) {
        // Fallback: hardcode a local model path when no packaged voices are found.
        // This enables testing without requiring the discovery flow.
        const fallback = "en-us-amy-medium";
        setVoices([fallback]);
        setPiperVoice(fallback);
        setPiperError("");
      } else {
        setVoices(opts);
        setPiperVoice((prev) => (prev && opts.includes(prev) ? prev : opts[0] || ""));
        setPiperError("");
      }
    });
  }, []);

  useEffect(() => {
    if (piperSection === "Manage Voices") {
      fetchProfiles();
    }
  }, [piperSection]);

  const edit = (npc) => setCurrent(npc);
  const newNpc = () => setCurrent(emptyNpc);
  const save = async () => {
    try {
      await saveNpc(current);
      setCurrent(emptyNpc);
    } catch (err) {
      console.error(err);
      alert("Failed to save NPC: " + String(err));
    } finally {
      refresh();
    }
  };
  const remove = async (name) => {
    try {
      await deleteNpc(name);
    } catch (err) {
      console.error(err);
      alert("Failed to delete NPC: " + String(err));
    } finally {
      refresh();
    }
  };

  const handleProfileChange = (idx, field, value) => {
    const updated = [...piperProfiles];
    updated[idx][field] = value;
    setPiperProfiles(updated);
  };

  const saveProfile = async (idx) => {
    const p = piperProfiles[idx];
    try {
      await updatePiperProfile(p.original, p.name, p.tags);
      await fetchProfiles();
      listPiperVoices().then((list) => {
        const opts = list.map((v) => v.id);
        setVoices(opts);
        if (opts.length === 0) {
          setPiperError(
            "No Piper voices installed. Run `piper --download <voice_id>` to fetch a model."
          );
        } else {
          setPiperError("");
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const removeProfile = async (name) => {
    try {
      await removePiperProfile(name);
      await fetchProfiles();
      listPiperVoices().then((list) => {
        const opts = list.map((v) => v.id);
        setVoices(opts);
        if (opts.length === 0) {
          setPiperError(
            "No Piper voices installed. Run `piper --download <voice_id>` to fetch a model."
          );
        } else {
          setPiperError("");
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const sections = [
    { name: "Lore", icon: "BookOpen" },
    { name: "NPCs", icon: "Users" },
    { name: "Piper", icon: "Mic2" },
    { name: "Discord", icon: "MessageCircle" },
    { name: "Chat", icon: "MessageSquare" },
  ];

  return (
    <div>
      <BackButton />
      <h1>Dungeons & Dragons</h1>
      <div className="dnd-section-nav">
        {sections.map(({ name, icon }) => (
          <button
            key={name}
            type="button"
            className="dnd-section-btn"
            onClick={() => setSection(name)}
          >
            <Icon name={icon} size={48} />
            <span>{name}</span>
          </button>
        ))}
      </div>
      {section === "Lore" && (
        <div>
          <p>Lore coming soon.</p>
        </div>
      )}
      {section === "NPCs" && (
        <div>
          <button type="button" onClick={newNpc}>
            New NPC
          </button>
          <div style={{ display: "flex", gap: "1rem" }}>
            <ul>
              {npcs.map((npc) => (
                <li key={npc.name}>
                  <span
                    style={{ cursor: "pointer" }}
                    onClick={() => edit(npc)}
                  >
                    {npc.name}
                  </span>
                  <button type="button" onClick={() => remove(npc.name)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              <input
                placeholder="Name"
                value={current.name}
                onChange={(e) =>
                  setCurrent({ ...current, name: e.target.value })
                }
              />
              <textarea
                placeholder="Description"
                value={current.description}
                onChange={(e) =>
                  setCurrent({ ...current, description: e.target.value })
                }
              />
              <textarea
                placeholder="Prompt"
                value={current.prompt}
                onChange={(e) =>
                  setCurrent({ ...current, prompt: e.target.value })
                }
              />
              <select
                value={current.voice}
                onChange={(e) =>
                  setCurrent({ ...current, voice: e.target.value })
                }
              >
                <option value="">Select voice</option>
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button type="button" onClick={save}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {section === "Piper" && (
        <div>
          {piperError && <div className="warning">{piperError}</div>}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              className={`piper-section-btn${
                piperSection === "Find Voices" ? " active" : ""
              }`}
              onClick={() =>
                setPiperSection(
                  piperSection === "Find Voices" ? "" : "Find Voices"
                )
              }
            >
              <Icon name="Search" className="piper-section-icon" size={48} />
              <span>Find Voices</span>
            </button>
            <button
              type="button"
              className={`piper-section-btn${
                piperSection === "Manage Voices" ? " active" : ""
              }`}
              onClick={() =>
                setPiperSection(
                  piperSection === "Manage Voices" ? "" : "Manage Voices"
                )
              }
            >
              <Icon
                name="Settings2"
                className="piper-section-icon"
                size={48}
              />
              <span>Manage Voices</span>
            </button>
          </div>
          {piperSection === "" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              <select
                value={piperVoice}
                onChange={(e) => {
                  setPiperVoice(e.target.value);
                  if (piperError) setPiperError("");
                }}
              >
                <option value="">Select voice</option>
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Enter text"
                value={piperText}
                onChange={(e) => {
                  setPiperText(e.target.value);
                  if (piperError) setPiperError("");
                }}
              />
              <button
                type="button"
                disabled={!piperVoice || !piperText}
                onClick={async () => {
                  if (!piperVoice || !piperText) {
                    setPiperError("Please select a voice and enter text.");
                    return;
                  }
                  try {
                    // If we are using the fallback entry, point to the absolute model/config paths.
                    const isFallback = voices.length === 0 || piperVoice === "en-us-amy-medium";
                    const model = isFallback
                      ? "D:\\Blossom\\Blossom_Music\\assets\\voice_models\\en-us-amy-medium\\en_US-amy-medium.onnx"
                      : `assets/voice_models/${piperVoice}/${piperVoice}.onnx`;
                    const config = isFallback
                      ? "D:\\Blossom\\Blossom_Music\\assets\\voice_models\\en-us-amy-medium\\en_US-amy-medium.onnx.json"
                      : `assets/voice_models/${piperVoice}/${piperVoice}.onnx.json`;
                    const path = await synthWithPiper(piperText, model, config);
                    setPiperPath(path);

                    // Prefer a Blob URL to avoid asset:// resolution issues in dev.
                    let blobUrl = "";
                    try {
                      // First try reading the absolute path directly.
                      const data = await readFile(path);
                      const blob = new Blob([data], { type: "audio/wav" });
                      blobUrl = URL.createObjectURL(blob);
                    } catch (e1) {
                      try {
                        const base = await appDataDir();
                        const norm = (s) => s.replace(/\\\\/g, "/");
                        const nBase = norm(base);
                        const nPath = norm(path);
                        if (nPath.startsWith(nBase)) {
                          const rel = nPath.substring(nBase.length);
                          const data = await readFile(rel, { baseDir: BaseDirectory.AppData });
                          const blob = new Blob([data], { type: "audio/wav" });
                          blobUrl = URL.createObjectURL(blob);
                        }
                    } catch {
                        try {
                          const bytes = await invoke("read_file_bytes", { path });
                          const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
                          blobUrl = URL.createObjectURL(blob);
                        } catch {
                          // Final fallback to asset protocol if all direct reads fail.
                          blobUrl = convertFileSrc(path);
                        }
                      }
                    }
                    setPiperAudio(blobUrl);
                    setPiperError("");
                  } catch (err) {
                    console.error(err);
                    setPiperError(err?.message || String(err) || "Failed to generate audio.");
                  }
                }}
              >
                Test
              </button>
              {piperAudio && (
                <div>
                  <audio controls src={piperAudio} />
                  <div>
                    <a
                      href={
                        piperAudio || (piperPath ? convertFileSrc(piperPath) : "")
                      }
                      download="piper.wav"
                    >
                      Download
                    </a>
                  </div>
                  </div>
              )}
            </div>
          )}
          {piperSection === "Find Voices" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              <button
                type="button"
                onClick={async () => {
                  const list = await listPiperVoices();
                  const opts = list.map((v) => v.id);
                  setPiperAvailableVoices(opts);
                  if (opts.length === 0) {
                    setPiperError(
                      "No Piper voices installed. Run `piper --download <voice_id>` to fetch a model."
                    );
                  } else {
                    setPiperError("");
                  }
                }}
                disabled={!piperBinaryAvailable}
                title=
                  {!piperBinaryAvailable
                    ? "Install the piper CLI to enable voice discovery"
                    : undefined}
              >
                Find Voices
              </button>
              <ul>
                {piperAvailableVoices.map((v) => (
                  <li key={v}>
                    {v}
                    <button
                      type="button"
                      onClick={() => {
                        setAddingVoice(v);
                        setDisplayName(v);
                        setVoiceTags("");
                      }}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
              {addingVoice && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <input
                    placeholder="Display Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <input
                    placeholder="Tags"
                    value={voiceTags}
                    onChange={(e) => setVoiceTags(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await addPiperVoice(
                            addingVoice,
                            displayName,
                            voiceTags
                          );
                          setAddingVoice("");
                          setDisplayName("");
                          setVoiceTags("");
                          listPiperVoices().then((list) => {
                            const opts = list.map((v) => v.id);
                            setVoices(opts);
                            if (opts.length === 0) {
                              setPiperError(
                                "No Piper voices installed. Run `piper --download <voice_id>` to fetch a model."
                              );
                            } else {
                              setPiperError("");
                            }
                          });
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingVoice("")}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {piperSection === "Manage Voices" && (
            <div>
              {piperProfiles.length === 0 ? (
                <p>No voices added.</p>
              ) : (
                <ul>
                  {piperProfiles.map((p, idx) => (
                    <li
                      key={p.original}
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <input
                        value={p.name}
                        onChange={(e) =>
                          handleProfileChange(idx, "name", e.target.value)
                        }
                      />
                      <input
                        value={p.tags}
                        onChange={(e) =>
                          handleProfileChange(idx, "tags", e.target.value)
                        }
                      />
                      <button type="button" onClick={() => saveProfile(idx)}>
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => removeProfile(p.original)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {section === "Discord" && (
        <div>
          <p>Discord integration coming soon.</p>
        </div>
      )}
      {section === "Chat" && (
        <div>
          <p>Chat coming soon.</p>
        </div>
      )}
    </div>
  );
}

