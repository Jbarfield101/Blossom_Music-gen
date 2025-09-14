import { useState } from "react";

export default function Train() {
  const [midis, setMidis] = useState([]);
  const [limit, setLimit] = useState("");
  const [jobId, setJobId] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [log, setLog] = useState("");

  const start = async () => {
    const fd = new FormData();
    midis.forEach((f) => fd.append("midis", f));
    if (limit) fd.append("limit", limit);
    const resp = await fetch("/train", { method: "POST", body: fd });
    const data = await resp.json();
    setJobId(data.job_id);
    setRunning(true);
    setProgress(0);
    setStage("");
    setLog("");
    poll(data.job_id);
  };

  const cancel = async () => {
    if (!jobId) return;
    await fetch(`/jobs/${jobId}/cancel`, { method: "POST" });
  };

  const poll = async (id) => {
    if (!id) return;
    try {
      const resp = await fetch(`/jobs/${id}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (typeof data.progress === "number") setProgress(data.progress);
      if (data.stage) setStage(data.stage);
      if (data.log) setLog(data.log.join("\n"));
      if (data.status === "running") {
        setTimeout(() => poll(id), 1000);
      } else {
        setRunning(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="m-md">
      <h1>Train Model</h1>
      <div id="inputs">
        <label>
          MIDI files
          <input
            type="file"
            multiple
            accept=".mid,.midi"
            onChange={(e) => setMidis(Array.from(e.target.files))}
          />
        </label>
        <label>
          Limit
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      </div>
      <div id="controls" className="mt-md">
        <button type="button" onClick={start} disabled={running}>
          Start
        </button>
        <button type="button" onClick={cancel} disabled={!running}>
          Cancel
        </button>
        <progress value={progress} max="100" />
        <span id="stage">{stage}</span>
      </div>
      <pre id="log">{log}</pre>
    </div>
  );
}

