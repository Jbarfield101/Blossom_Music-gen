import { useCallback, useEffect, useState } from 'react';
import { listNpcs, saveNpc, deleteNpc } from '../api/npcs';
import { listPiperVoices } from '../lib/piperVoices';
import BackButton from '../components/BackButton.jsx';
import './Dnd.css';

export default function DndNpcs() {
  const emptyNpc = { name: '', description: '', prompt: '', voice: '' };
  const [npcs, setNpcs] = useState([]);
  const [voices, setVoices] = useState([]);
  const [current, setCurrent] = useState(emptyNpc);

  const loadNpcs = useCallback(async () => {
    setNpcs(await listNpcs());
  }, []);

  useEffect(() => {
    loadNpcs();
  }, [loadNpcs]);

  useEffect(() => {
    listPiperVoices().then((list) => {
      if (!Array.isArray(list) || list.length === 0) {
        const fallback = {
          id: 'en-us-amy-medium',
          label: 'Amy (Medium) [en_US]',
          modelPath: 'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx',
          configPath:
            'assets/voice_models/en-us-amy-medium/en_US-amy-medium.onnx.json',
        };
        setVoices([fallback]);
      } else {
        setVoices(list);
      }
    });
  }, []);

  const edit = (npc) => setCurrent(npc);
  const newNpc = () => setCurrent(emptyNpc);

  const save = async () => {
    try {
      await saveNpc(current);
      setCurrent(emptyNpc);
    } catch (err) {
      console.error(err);
      alert('Failed to save NPC: ' + String(err));
    } finally {
      loadNpcs();
    }
  };

  const remove = async (name) => {
    try {
      await deleteNpc(name);
    } catch (err) {
      console.error(err);
      alert('Failed to delete NPC: ' + String(err));
    } finally {
      loadNpcs();
    }
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons &amp; Dragons &middot; NPCs</h1>
      <div>
        <button type="button" onClick={newNpc}>
          New NPC
        </button>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <ul>
            {npcs.map((npc) => (
              <li key={npc.name}>
                <span style={{ cursor: 'pointer' }} onClick={() => edit(npc)}>
                  {npc.name}
                </span>
                <button type="button" onClick={() => remove(npc.name)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              placeholder="Name"
              value={current.name}
              onChange={(e) => setCurrent({ ...current, name: e.target.value })}
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
              onChange={(e) => setCurrent({ ...current, voice: e.target.value })}
            >
              <option value="">Select voice</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label || v.id}
                </option>
              ))}
            </select>
            <button type="button" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
