import { useEffect, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { listDevices, setDevices as apiSetDevices } from '../api/devices';
import './Settings.css';

export default function SettingsDevices() {
  const [input, setInput] = useState({ options: [], selected: '' });
  const [output, setOutput] = useState({ options: [], selected: '' });

  useEffect(() => {
    let active = true;
    listDevices().then((devices) => {
      if (!active) return;
      setInput(devices.input);
      setOutput(devices.output);
    });
    return () => { active = false; };
  }, []);

  return (
    <main className="settings">
      <BackButton />
      <h1>Settings · Audio Devices</h1>
      <section className="settings-section">
        <fieldset>
          <legend>Input</legend>
          <select
            value={input.selected || ''}
            onChange={async (e) => {
              const value = e.target.value;
              const currentOutput = output.selected || (output.options[0]?.id || '');
              setInput((prev) => ({ ...prev, selected: value }));
              if (!output.options.some((o) => o.id === currentOutput) && output.options[0]) {
                setOutput((prev) => ({ ...prev, selected: output.options[0].id }));
              }
              await apiSetDevices({ input: value, output: currentOutput });
            }}
          >
            {input.options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </fieldset>
      </section>
      <section className="settings-section">
        <fieldset>
          <legend>Output</legend>
          <select
            value={output.selected || ''}
            onChange={async (e) => {
              const value = e.target.value;
              const currentInput = input.selected || (input.options[0]?.id || '');
              setOutput((prev) => ({ ...prev, selected: value }));
              if (!input.options.some((o) => o.id === currentInput) && input.options[0]) {
                setInput((prev) => ({ ...prev, selected: input.options[0].id }));
              }
              await apiSetDevices({ input: currentInput, output: value });
            }}
          >
            {output.options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </fieldset>
      </section>
    </main>
  );
}

