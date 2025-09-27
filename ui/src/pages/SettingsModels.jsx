import { useEffect, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { listWhisper, setWhisper as apiSetWhisper, listLlm, setLlm as apiSetLlm, listPiper as apiListPiper } from '../api/models';
import { listPiperVoices } from '../lib/piperVoices';
import { setPiper as apiSetPiper } from '../api/models';
import './Settings.css';

export default function SettingsModels() {
  const [whisper, setWhisper] = useState({ options: [], selected: '' });
  const [llm, setLlm] = useState({ options: [], selected: '' });
  const [piper, setPiper] = useState({ options: [], selected: '' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [w, l, voices, piperPersist] = await Promise.all([
        listWhisper(),
        listLlm(),
        listPiperVoices(),
        apiListPiper().catch(() => ({ options: [], selected: '' })),
      ]);
      if (!active) return;
      setWhisper(w);
      setLlm(l);
      const options = (voices || []).map((v) => ({ id: v.id, label: v.label || v.id }));
      const persisted = (piperPersist && typeof piperPersist.selected === 'string') ? piperPersist.selected : '';
      const ids = options.map((o) => o.id);
      const sel = ids.includes(persisted) ? persisted : (ids[0] || '');
      setPiper({ options, selected: sel });
    };
    load();
    return () => { active = false; };
  }, []);

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Models & Voices</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Whisper</legend>
          <select value={whisper.selected || ''} onChange={async (e) => { const v = e.target.value; setWhisper((p) => ({ ...p, selected: v })); await apiSetWhisper(v); }}>
            {whisper.options.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>Default Blossom Voice</legend>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={piper.selected || ''} onChange={async (e) => { const v = e.target.value; setPiper((p) => ({ ...p, selected: v })); await apiSetPiper(v); }}>
              {piper.options?.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
            </select>
            <button type="button" onClick={async () => {
              const [voices, piperPersist] = await Promise.all([
                listPiperVoices(),
                apiListPiper().catch(() => ({ options: [], selected: '' })),
              ]);
              const options = (voices || []).map((v) => ({ id: v.id, label: v.label || v.id }));
              const persisted = (piperPersist && typeof piperPersist.selected === 'string') ? piperPersist.selected : '';
              const ids = options.map((o) => o.id);
              const sel = ids.includes(persisted) ? persisted : (ids[0] || '');
              setPiper({ options, selected: sel });
            }}>Refresh</button>
          </div>
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>LLM</legend>
          <select value={llm.selected || ''} onChange={async (e) => { const v = e.target.value; setLlm((p) => ({ ...p, selected: v })); await apiSetLlm(v); }}>
            {llm.options.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </fieldset>
      </section>
    </main>
  );
}
