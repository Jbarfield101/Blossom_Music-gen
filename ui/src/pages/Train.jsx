import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export default function Train() {
  const [dataset, setDataset] = useState("");
  const [epochs, setEpochs] = useState(1);
  const [learningRate, setLearningRate] = useState(0.001);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [jobId, setJobId] = useState(null);
  const unlistenRef = useRef(null);

  const chooseFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Dataset", extensions: ["mid", "jsonl"] }],
    });
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      setDataset(path);
    }
  };

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const startTraining = async (e) => {
    e.preventDefault();
    if (!dataset) return;
    try {
      const id = await invoke("train_phrase", {
        dataset,
        epochs: Number(epochs),
        lr: Number(learningRate),
      });
      setJobId(id);
      setProgress(0);
      setStatus("Starting...");
      const unlisten = await listen(`progress::${id}`, (event) => {
        const { percent, message } = event.payload;
        if (typeof percent === "number") setProgress(percent);
        if (message) setStatus(message);
      });
      unlistenRef.current = unlisten;
    } catch (err) {
      setStatus(String(err));
    }
  };

  return (
    <div className="m-md">
      <h1>Train Model</h1>
      <form onSubmit={startTraining}>
        <div>
          <button type="button" onClick={chooseFile}>
            Select Dataset
          </button>
          <span style={{ marginLeft: "0.5rem" }}>{dataset}</span>
        </div>
        <label>
          Epochs
          <input
            type="number"
            min="1"
            value={epochs}
            onChange={(e) => setEpochs(e.target.value)}
          />
        </label>
        <label>
          Learning Rate
          <input
            type="number"
            step="0.0001"
            value={learningRate}
            onChange={(e) => setLearningRate(e.target.value)}
          />
        </label>
        <button type="submit" disabled={!dataset || jobId !== null}>
          Start Training
        </button>
      </form>
      {jobId && (
        <div style={{ marginTop: "1rem" }}>
          <progress value={progress} max={100}></progress>
          <div>{status}</div>
        </div>
      )}
    </div>
  );
}


