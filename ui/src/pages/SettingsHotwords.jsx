import { useEffect, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { listHotwords, setHotword as apiSetHotword } from '../api/hotwords';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import './Settings.css';

export default function SettingsHotwords() {
  const [hotwords, setHotwordsState] = useState({});

  useEffect(() => {
    let active = true;
    listHotwords().then((hw) => { if (active) setHotwordsState(hw); });
    return () => { active = false; };
  }, []);

  const toggleHotword = async (name, enabled) => {
    await apiSetHotword({ name, enabled });
    setHotwordsState(await listHotwords());
  };

  const addHotword = async () => {
    const filePath = await openDialog({ multiple: false });
    if (typeof filePath === 'string') {
      const parts = filePath.split(/[\\/]/);
      const file = parts[parts.length - 1];
      const name = file.replace(/\.[^.]+$/, '');
      await apiSetHotword({ name, enabled: true, file: filePath });
      setHotwordsState(await listHotwords());
    }
  };

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Hotwords</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Wake Words</legend>
          <ul>
            {Object.entries(hotwords).map(([name, enabled]) => {
              const id = `hotword-${name}`;
              return (
                <li key={name}>
                  <input id={id} type="checkbox" checked={enabled} onChange={(e) => toggleHotword(name, e.target.checked)} />
                  <label htmlFor={id}>{name}</label>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={addHotword}>Upload Hotword Model</button>
        </fieldset>
      </section>
    </main>
  );
}

