import { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton.jsx";

const MODEL_OPTIONS = [
  { value: "small", label: "MusicGen Small" },
  { value: "medium", label: "MusicGen Medium" },
  { value: "melody", label: "MusicGen Melody" },
];

export default function MusicGen() {
  const [prompt, setPrompt] = useState(
    "Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood"
  );
  const [duration, setDuration] = useState(30);
  const [temperature, setTemperature] = useState(1);
  const [modelName, setModelName] = useState("small");
  const [audioSrc, setAudioSrc] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const generate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    setAudioSrc(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setError(null);
    try {
      const path = await invoke("generate_musicgen", {
        prompt,
        duration: Number(duration),
        modelName,
        temperature: Number(temperature),
      });
      const src = convertFileSrc(path);
      setAudioSrc(src);
      const blob = await fetch(src).then((r) => r.blob());
      setDownloadUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error("music generation failed", err);
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!downloadUrl) return;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "musicgen.wav";
    link.click();
  };

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  return (
    <>
      <BackButton />
      <h1 className="mb-md">MusicGen</h1>
      <form
        onSubmit={generate}
        className="p-md"
        style={{ background: "var(--card-bg)", color: "var(--text)" }}
      >
        <label className="mb-md">
          Prompt
          <input
            type="text"
            className="mt-sm p-sm"
            placeholder="Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label className="mb-md">
          Duration: {duration}s
          <input
            type="range"
            min="15"
            max="120"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-sm"
          />
        </label>
        <label className="mb-md">
          Model
          <select
            id="model-select"
            className="mt-sm p-sm"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-md">
          Temperature: {temperature}
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            className="mt-sm"
          />
        </label>
        <button
          type="submit"
          disabled={generating}
          className="mt-md p-sm"
          style={{ background: "var(--button-bg)", color: "var(--text)" }}
        >
          Generate
        </button>
        <div id="progress-placeholder" className="mt-md mb-md">
          {generating && <progress />}
        </div>
      </form>
      <audio id="generated-audio" src={audioSrc || ""} hidden controls />
      {downloadUrl && (
        <button
          id="download-btn"
          onClick={download}
          className="mt-sm p-sm"
          style={{ background: "var(--button-bg)", color: "var(--text)" }}
        >
          Download
        </button>
      )}
      {error && (
        <div
          className="mt-md"
          role="alert"
          style={{ color: "var(--accent)", background: "var(--card-bg)", padding: "var(--space-sm)" }}
        >
          <strong>Something went wrong:</strong> {error}
        </div>
      )}
    </>
  );
}

