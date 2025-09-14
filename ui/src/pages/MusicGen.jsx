import { useState } from "react";
import BackButton from "../components/BackButton.jsx";

export default function MusicGen() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(10);
  const [temperature, setTemperature] = useState(1);
  const [topK, setTopK] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setAudioUrl("");
    try {
      const resp = await fetch("/musicgen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration: Number(duration),
          temperature: Number(temperature),
          top_k: Number(topK),
        }),
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      } else {
        console.error("generation failed", resp.statusText);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <BackButton />
      <h1>MusicGen</h1>
      <div
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
      >
        <textarea
          placeholder="Enter prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        <label>
          Duration (seconds)
          <input
            type="number"
            min="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <label>
          Temperature
          <input
            type="number"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </label>
        <label>
          Top-k
          <input
            type="number"
            value={topK}
            onChange={(e) => setTopK(e.target.value)}
          />
        </label>
        <button type="button" onClick={generate} disabled={loading}>
          {loading ? "Generating..." : "Generate"}
        </button>
      </div>
      {audioUrl && (
        <div style={{ marginTop: "1rem" }}>
          <audio controls src={audioUrl} />
        </div>
      )}
    </div>
  );
}

