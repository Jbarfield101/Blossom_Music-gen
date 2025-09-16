import { useState, useEffect, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { readFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
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
  const [audios, setAudios] = useState([]); // [{ url, path }]
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [device, setDevice] = useState("");
  const [forceCpu, setForceCpu] = useState(false);
  const [envInfo, setEnvInfo] = useState(null);
  const [outputDir, setOutputDir] = useState("");
  const [count, setCount] = useState(1);
  const storeRef = useRef(null);

  // Load persisted outputDir on mount
  useEffect(() => {
    (async () => {
      try {
        const store = new Store("ui-settings.json");
        storeRef.current = store;
        const saved = await store.get("musicgen.outputDir");
        if (typeof saved === "string" && saved) setOutputDir(saved);
        const savedModel = await store.get("musicgen.modelName");
        if (typeof savedModel === "string" && savedModel) setModelName(savedModel);
        const savedCount = await store.get("musicgen.count");
        if (typeof savedCount === "number" && !Number.isNaN(savedCount)) setCount(savedCount);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Persist outputDir whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        if (outputDir) {
          await storeRef.current.set("musicgen.outputDir", outputDir);
        } else {
          await storeRef.current.delete("musicgen.outputDir");
        }
        await storeRef.current.save();
      } catch {
        // ignore
      }
    })();
  }, [outputDir]);

  // Persist modelName whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        if (modelName) {
          await storeRef.current.set("musicgen.modelName", modelName);
          await storeRef.current.save();
        }
      } catch {}
    })();
  }, [modelName]);

  // Persist count whenever it changes
  useEffect(() => {
    (async () => {
      try {
        if (!storeRef.current) return;
        const n = Number(count) || 1;
        await storeRef.current.set("musicgen.count", n);
        await storeRef.current.save();
      } catch {}
    })();
  }, [count]);

  const generate = async (e) => {
    e.preventDefault();
    setGenerating(true);
    // cleanup previous blob URLs
    if (audios?.length) {
      audios.forEach((a) => URL.revokeObjectURL(a.url));
      setAudios([]);
    }
    setAudioSrc(null);
    setDevice(forceCpu ? "cpu" : "");
    setError(null);
    try {
      const result = await invoke("generate_musicgen", {
        prompt,
        duration: Number(duration),
        model_name: modelName,
        temperature: Number(temperature),
        force_cpu: !!forceCpu,
        output_dir: outputDir || undefined,
        count: Number(count) || 1,
      });

      const path = typeof result === "string" ? result : result?.path;
      const paths = Array.isArray(result?.paths)
        ? result.paths
        : (path ? [path] : []);
      // Debug info to help path handling on Windows
      try {
        const base = await appDataDir();
        // eslint-disable-next-line no-console
        console.log("MusicGen result.path:", path);
        // eslint-disable-next-line no-console
        console.log("appDataDir():", base);
      } catch {}
      const dev = typeof result === "object" && result?.device ? result.device : "";
      if (dev) setDevice(dev);

      // Prefer reading the file directly to generate a Blob URL.
      // This avoids relying on the asset protocol (asset.localhost) in dev.
      const makeBlobUrl = async (absPath) => {
        try {
          const data = await readFile(absPath);
          const blob = new Blob([data], { type: "audio/wav" });
          return URL.createObjectURL(blob);
        } catch (e1) {
          try {
            const base = await appDataDir();
            const norm = (s) => String(s || "").replace(/\\\\/g, "/").toLowerCase();
            const nBase = norm(base);
            const nPath = norm(absPath);
            if (nPath.startsWith(nBase)) {
              const rel = nPath.substring(nBase.length);
              const data = await readFile(rel, { baseDir: BaseDirectory.AppData });
              const blob = new Blob([data], { type: "audio/wav" });
              return URL.createObjectURL(blob);
            }
          } catch {
            // ignore and fall through
          }
          try {
            // Absolute path fallback via backend if plugin-fs cannot read directly
            const bytes = await invoke("read_file_bytes", { path: absPath });
            const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
            return URL.createObjectURL(blob);
          } catch {
            // ignore and fall through
          }
          return "";
        }
      };

      const blobUrls = [];
      for (const p of paths) {
        let blobUrl = await makeBlobUrl(p);
        if (!blobUrl) {
          const src = convertFileSrc(p);
          try {
            const blob = await fetch(src).then((r) => r.blob());
            blobUrl = URL.createObjectURL(blob);
          } catch {
            blobUrl = "";
          }
        }
        if (blobUrl) blobUrls.push({ url: blobUrl, path: p });
      }
      setAudios(blobUrls);
      setAudioSrc(blobUrls[0]?.url || null);
    } catch (err) {
      console.error("music generation failed", err);
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const download = (url, idx = 0) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = idx === 0 ? "musicgen.wav" : `musicgen_${idx + 1}.wav`;
    link.click();
  };

  useEffect(() => {
    return () => {
      if (audios?.length) {
        audios.forEach((a) => URL.revokeObjectURL(a.url));
      }
    };
  }, [audios]);

  return (
    <>
      <BackButton />
      <h1 className="mb-md">MusicGen</h1>
      <form
        onSubmit={generate}
        className="p-md"
        style={{ background: "var(--card-bg)", color: "var(--text)" }}
      >
        <label className="mb-md" style={{ display: "block" }}>
          Prompt
          <textarea
            rows={5}
            className="mt-sm p-sm"
            placeholder="Slow lofi beat, 60 BPM, warm Rhodes, vinyl crackle, soft snare, cozy night mood"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ width: "100%", resize: "vertical" }}
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
        <label className="mb-md">
          Count: {count}
          <input
            type="range"
            min="1"
            max="5"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="mt-sm"
          />
        </label>
        <div className="mb-md">
          <div style={{ marginBottom: "0.25rem" }}>Output Folder</div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              value={outputDir}
              readOnly
              className="p-sm"
              placeholder="Default (App Data directory)"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="p-sm"
              onClick={async () => {
                try {
                  const selected = await open({ directory: true, multiple: false });
                  if (typeof selected === "string") setOutputDir(selected);
                } catch {}
              }}
              style={{ background: "var(--button-bg)", color: "var(--text)" }}
            >
              Browse…
            </button>
            {outputDir && (
              <button
                type="button"
                className="p-sm"
                onClick={() => setOutputDir("")}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                Use Default
              </button>
            )}
          </div>
        </div>
        <label className="mb-md" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={forceCpu}
            onChange={(e) => setForceCpu(e.target.checked)}
          />
          Force CPU
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
          {generating && (
            <>
              <progress />
              <span style={{ marginLeft: "0.5rem", opacity: 0.8 }}>
                {device ? `Using ${device.toUpperCase()}` : "Detecting device..."}
              </span>
            </>
          )}
          {!generating && device && (
            <span style={{ marginLeft: "0.5rem", opacity: 0.8 }}>
              Using {device.toUpperCase()}
            </span>
          )}
        </div>
      </form>
      <div className="mt-sm" style={{ background: "var(--card-bg)", padding: "var(--space-sm)" }}>
        <button
          type="button"
          className="p-sm"
          onClick={async () => {
            try {
              const info = await invoke("musicgen_env");
              setEnvInfo(info);
              if (info?.device) setDevice(info.device);
            } catch (e) {
              setEnvInfo({ error: String(e) });
            }
          }}
          style={{ background: "var(--button-bg)", color: "var(--text)" }}
        >
          Check Environment
        </button>
        {envInfo && (
          <div className="mt-sm" style={{ fontSize: "0.9rem", opacity: 0.9 }}>
            <div>Device: {envInfo.device?.toUpperCase?.() || ""}</div>
            {envInfo.cuda_available && (
              <>
                <div>GPU: {envInfo.name || "Unknown"}</div>
                <div>
                  CUDA: {envInfo.cuda_version || "Unknown"} • Torch: {envInfo.torch || ""}
                </div>
                {(envInfo.total_mem != null) && (
                  <div>
                    VRAM: {Math.round(envInfo.total_mem / (1024 ** 3))} GB total, {Math.round(envInfo.free_mem / (1024 ** 3))} GB free
                  </div>
                )}
              </>
            )}
            {envInfo.error && (
              <div style={{ color: "var(--accent)" }}>Error: {envInfo.error}</div>
            )}
          </div>
        )}
      </div>
      {audios?.length > 0 && (
        <div className="mt-sm" style={{ display: "grid", gap: "0.5rem" }}>
          {audios.map((a, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <audio src={a.url} controls />
              <button
                type="button"
                className="p-sm"
                onClick={() => download(a.url, idx)}
                style={{ background: "var(--button-bg)", color: "var(--text)" }}
              >
                Download {idx + 1}
              </button>
            </div>
          ))}
        </div>
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

