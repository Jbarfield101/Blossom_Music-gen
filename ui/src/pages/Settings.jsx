import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Store } from '@tauri-apps/plugin-store';

const store = new Store('settings.dat');
const INPUT_KEY = 'input_device_id';
const OUTPUT_KEY = 'output_device_id';

export default function Settings() {
  const [devices, setDevices] = useState([]);
  const [inputId, setInputId] = useState(null);
  const [outputId, setOutputId] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        setDevices(await invoke('list_devices'));
        setInputId(await store.get(INPUT_KEY));
        setOutputId(await store.get(OUTPUT_KEY));
      } catch (_) {
        setDevices([]);
      }
    }
    load();
  }, []);

  const updateDevices = async (input, output) => {
    setInputId(input);
    setOutputId(output);
    try {
      await invoke('set_devices', { input, output });
    } catch (_) {}
  };

  const inputOptions = devices.filter((d) => d.max_input_channels > 0);
  const outputOptions = devices.filter((d) => d.max_output_channels > 0);

  return (
    <div>
      <h1>Settings</h1>
      <div>
        <label>
          Input Device
          <select
            value={inputId ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              updateDevices(val, outputId);
            }}
          >
            <option value="">Default</option>
            {inputOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Output Device
          <select
            value={outputId ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              updateDevices(inputId, val);
            }}
          >
            <option value="">Default</option>
            {outputOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
