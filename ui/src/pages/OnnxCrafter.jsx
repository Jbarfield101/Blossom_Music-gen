import React, { useState } from 'react';
import './OnnxCrafter.css';
import { open } from '@tauri-apps/plugin-dialog';
import BackButton from "../components/BackButton.jsx";

export default function OnnxCrafter() {
  const [log] = useState('');

  const handleSelectMidi = async (e) => {
    e.preventDefault();
    await open({ multiple: false });
  };

  return (
    <div className="m-md">
      <BackButton />
      <h1>ONNX Crafter</h1>
      <section id="instructions">
        <h2>Instructions</h2>
        <ol>
          <li>
            Download a piano phrase <code>.onnx</code> model into your local <code>models/</code> folder and
            select it below.
          </li>
          <li>
            Provide a song specification or melody seed, then tune the sampling parameters.
          </li>
          <li>
            Press <strong>Start</strong> to generate a new piano stem and watch the progress log.
          </li>
        </ol>
        <p>
          Need a model?
          <a href="../docs/phrase_models.md" target="_blank" rel="noreferrer">
            Learn how to fetch and install <code>.onnx</code> models for piano stems
          </a>.
        </p>
      </section>
      <div id="inputs">
        <label htmlFor="model-select">Model</label>
        <select id="model-select" defaultValue="">
          <option value="" disabled>
            Select a model...
          </option>
        </select>

        <label htmlFor="song_spec">Song spec (JSON or space-separated chords)</label>
        <textarea id="song_spec" rows={3}></textarea>

        <label htmlFor="midi">Melody MIDI</label>
        <input id="midi" type="file" onClick={handleSelectMidi} />

        <label htmlFor="steps">Steps</label>
        <input id="steps" type="number" defaultValue={32} />

        <label htmlFor="top_k">Top-k</label>
        <input id="top_k" type="number" />

        <label htmlFor="top_p">Top-p</label>
        <input id="top_p" type="number" step={0.01} />

        <label htmlFor="temperature">Temperature</label>
        <input id="temperature" type="number" step={0.01} defaultValue={1.0} />
      </div>
      <div id="controls">
        <button id="download" type="button">
          Download
        </button>
        <button id="start" type="button" disabled>
          Start
        </button>
        <button id="cancel" type="button" disabled>
          Cancel
        </button>
        <label htmlFor="progress">Progress</label>
        <progress id="progress" value={0} max={100}></progress>
        <span id="eta" />
      </div>
      <pre id="log">{log}</pre>
      <div id="results" hidden>
        <h3>Result</h3>
        <a id="midi_link" href="#"></a>
        <pre id="telemetry"></pre>
      </div>
      <div id="loading-overlay" hidden>
        <div className="spinner" aria-hidden="true"></div>
        <p>ONNX is loading, searching for MusicLang models…</p>
      </div>
    </div>
  );
}

