import { useEffect, useState } from "react";
import { listNpcs, saveNpc, deleteNpc } from "../api/npcs";
import { listPiper, testPiper } from "../api/models";
import BackButton from "../components/BackButton.jsx";

export default function Dnd() {
  const emptyNpc = { name: "", description: "", prompt: "", voice: "" };
  const [npcs, setNpcs] = useState([]);
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(emptyNpc);
  const [section, setSection] = useState("Lore");
  const [piperVoice, setPiperVoice] = useState("");
  const [piperText, setPiperText] = useState("");
  const [piperAudio, setPiperAudio] = useState("");

  const refresh = async () => {
    setNpcs(await listNpcs());
  };

  useEffect(() => {
    refresh();
    listPiper().then((v) => {
      setVoices(v.options || []);
      if (v.selected) {
        setPiperVoice(v.selected);
      }
    });
  }, []);

  const edit = (npc) => setCurrent(npc);
  const newNpc = () => setCurrent(emptyNpc);
  const save = async () => {
    await saveNpc(current);
    setCurrent(emptyNpc);
    refresh();
  };
  const remove = async (name) => {
    await deleteNpc(name);
    refresh();
  };

  return (
    <div>
      <BackButton />
      <h1>Dungeons & Dragons</h1>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {["Lore", "Piper", "Discord", "Chat"].map((name) => (
          <button key={name} type="button" onClick={() => setSection(name)}>
            {name}
          </button>
        ))}
      </div>
      {section === "Lore" && (
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
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <select
            value={piperVoice}
            onChange={(e) => setPiperVoice(e.target.value)}
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
            onChange={(e) => setPiperText(e.target.value)}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await testPiper(piperText, piperVoice);
                if (res) {
                  const url = res.url || res.path || res;
                  setPiperAudio(url);
                }
              } catch (err) {
                console.error(err);
              }
            }}
          >
            Test
          </button>
          {piperAudio && (
            <div>
              <audio controls src={piperAudio} />
              <div>
                <a href={piperAudio} download="piper.mp3">
                  Download
                </a>
              </div>
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

