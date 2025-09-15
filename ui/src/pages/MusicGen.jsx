import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import BackButton from "../components/BackButton.jsx";

export default function MusicGen() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(10);
  const [temperature, setTemperature] = useState(1);
  const [topK, setTopK] = useState(250);
  const [audioUrl, setAudioUrl] = useState(null);
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    setAudioUrl(null);
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
      const blob = await resp.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("music generation failed", err);
    } finally {
      setGenerating(false);
    }
  };

  const runTest = async () => {
    setGenerating(true);
    setAudioUrl(null);
    try {
      if (window.__TAURI__) {
        const bytes = await invoke("musicgen_test");
        const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
        setAudioUrl(URL.createObjectURL(blob));
      } else {
        const resp = await fetch("/musicgen/test");
        const blob = await resp.blob();
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error("music test failed", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <BackButton />
      <h1>MusicGen</h1>
      <div className="musicgen-controls">
        <label>
          Prompt
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label>
          Duration (s)
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
        <button type="button" onClick={generate} disabled={generating}>
          {generating ? "Generating..." : "Generate"}
        </button>
        <button type="button" onClick={runTest} disabled={generating}>
          {generating ? "Testing..." : "Run Test"}
        </button>
      </div>
      {audioUrl && (
        <div style={{ marginTop: "1rem" }}>
          <audio controls src={audioUrl} />
        </div>
      )}
    </>
  );
}

