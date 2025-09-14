import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import BackButton from "../components/BackButton.jsx";

export default function Train() {
  const [dataset, setDataset] = useState(null);
  const [epochs, setEpochs] = useState(1);
  const [lr, setLr] = useState(0.001);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");

  const startTraining = async () => {
    if (!dataset) return;
    setProgress(0);
    setStatus("Starting...");
    const id = await invoke("train_model", {
      dataset: dataset.path || dataset.name,
      epochs: Number(epochs),
      lr: Number(lr),
    });
    await listen(`progress::${id}`, (event) => {
      const { percent, stage, message } = event.payload;
      if (typeof percent === "number") setProgress(percent);
      if (stage) setStatus(stage);
      else if (message) setStatus(message);
    });
  };

  return (
    <div className="m-md">
      <BackButton />
      <h1>Train Model</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTraining();
        }}
      >
        <label>
          Dataset File
          <input
            type="file"
            accept=".mid,.midi,.npz,.json"
            onChange={(e) => setDataset(e.target.files[0])}
          />
        </label>
        <label>
          Epochs
          <input
            type="number"
            value={epochs}
            onChange={(e) => setEpochs(e.target.value)}
            min="1"
          />
        </label>
        <label>
          Learning Rate
          <input
            type="number"
            step="0.0001"
            value={lr}
            onChange={(e) => setLr(e.target.value)}
            min="0"
          />
        </label>
        <button type="submit">Start Training</button>
      </form>
      <progress value={progress} max="100" />
      <div>{status}</div>
    </div>
  );
}
