import { useState, useEffect, useRef } from "react";

export default function PhraseModel() {
  const [preset, setPreset] = useState("");
  const [presets, setPresets] = useState([]);
  const [style, setStyle] = useState("");
  const [styles, setStyles] = useState([]);
  const [minutes, setMinutes] = useState("");
  const [sections, setSections] = useState("");
  const [seed, setSeed] = useState(42);
  const [samplerSeed, setSamplerSeed] = useState("");
  const [mixPreset, setMixPreset] = useState("");
  const [name, setName] = useState("output");
  const [outdir, setOutdir] = useState("");
  const [mixConfig, setMixConfig] = useState(null);
  const [arrangeConfig, setArrangeConfig] = useState(null);
  const [drumsModel, setDrumsModel] = useState("");
  const [bassModel, setBassModel] = useState("");
  const [keysModel, setKeysModel] = useState("");
  const [preview, setPreview] = useState("");
  const [bundleStems, setBundleStems] = useState(false);
  const [evalOnly, setEvalOnly] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [keysSfz, setKeysSfz] = useState(null);
  const [padsSfz, setPadsSfz] = useState(null);
  const [bassSfz, setBassSfz] = useState(null);
  const [drumsSfz, setDrumsSfz] = useState(null);
  const [melodyMidi, setMelodyMidi] = useState(null);
  const [arrange, setArrange] = useState("");
  const [outro, setOutro] = useState("");
  const outdirPicker = useRef(null);

  const [drumsOptions, setDrumsOptions] = useState([]);
  const [bassOptions, setBassOptions] = useState([]);
  const [keysOptions, setKeysOptions] = useState([]);

  const [jobId, setJobId] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [eta, setEta] = useState("");
  const [log, setLog] = useState("");
  const [links, setLinks] = useState([]);
  const [summary, setSummary] = useState([]);
  const [metrics, setMetrics] = useState("");
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    async function loadOptions() {
      try {
        const [p, s, m] = await Promise.all([
          fetch("/presets").then((r) => r.json()),
          fetch("/styles").then((r) => r.json()),
          fetch("/models").then((r) => r.json()),
        ]);
        setPresets(p);
        setStyles(s);
        setDrumsOptions(m.filter((x) => x.startsWith("drums")));
        setBassOptions(m.filter((x) => x.startsWith("bass")));
        setKeysOptions(m.filter((x) => x.startsWith("keys")));
      } catch (e) {
        console.error("failed to load options", e);
      }
    }
    loadOptions();
  }, []);

  const chooseOutdir = () => {
    if (outdirPicker.current) outdirPicker.current.click();
  };
  const outdirChanged = (e) => {
    const file = e.target.files[0];
    if (file) {
      const path = file.webkitRelativePath
        ? file.webkitRelativePath.split("/")[0]
        : file.path;
      setOutdir(path);
    }
  };

  const start = async () => {
    const fd = new FormData();
    fd.append("preset", preset);
    fd.append("style", style);
    if (minutes) fd.append("minutes", minutes);
    if (sections) fd.append("sections", sections);
    fd.append("seed", seed);
    if (samplerSeed) fd.append("sampler_seed", samplerSeed);
    if (mixPreset) fd.append("mix_preset", mixPreset);
    fd.append("name", name);
    if (mixConfig) fd.append("mix_config", mixConfig);
    if (arrangeConfig) fd.append("arrange_config", arrangeConfig);
    if (bundleStems) fd.append("bundle_stems", "true");
    if (evalOnly) fd.append("eval_only", "true");
    if (dryRun) fd.append("dry_run", "true");
    if (keysSfz) fd.append("keys_sfz", keysSfz);
    if (padsSfz) fd.append("pads_sfz", padsSfz);
    if (bassSfz) fd.append("bass_sfz", bassSfz);
    if (drumsSfz) fd.append("drums_sfz", drumsSfz);
    if (melodyMidi) fd.append("melody_midi", melodyMidi);
    fd.append("phrase", "true");
    if (drumsModel) fd.append("drums_model", drumsModel);
    if (bassModel) fd.append("bass_model", bassModel);
    if (keysModel) fd.append("keys_model", keysModel);
    if (arrange) fd.append("arrange", arrange);
    if (outro) fd.append("outro", outro);
    if (preview) fd.append("preview", preview);
    if (outdir) fd.append("outdir", outdir);

    setRunning(true);
    setLog("");
    setShowResults(false);
    const resp = await fetch("/render", { method: "POST", body: fd });
    const data = await resp.json();
    setJobId(data.job_id);
    poll(data.job_id);
  };

  const cancel = async () => {
    if (!jobId) return;
    await fetch(`/jobs/${jobId}/cancel`, { method: "POST" });
  };

  const poll = async (id) => {
    if (!id) return;
    const resp = await fetch(`/jobs/${id}`);
    if (!resp.ok) return;
    const data = await resp.json();
    setProgress(data.progress || 0);
    setEta(data.eta || "");
    setStage(data.stage || "");
    setLog(data.log.join(""));
    if (data.status === "running") {
      setTimeout(() => poll(id), 1000);
    } else {
      setRunning(false);
      if (data.status === "completed") {
        const names = ["mix.wav", "stems.mid", "bundle.zip"];
        setLinks(names.map((n) => ({ name: n, href: `/jobs/${id}/artifact/${n}` })));
        const m = data.metrics || {};
        const sum = [];
        if (m.hash) sum.push(`Hash: ${m.hash}`);
        if (typeof m.duration === "number")
          sum.push(`Duration: ${m.duration.toFixed(2)}s`);
        if (m.section_counts)
          sum.push(
            "Sections: " +
              Object.entries(m.section_counts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ")
          );
        setSummary(sum);
        setMetrics(JSON.stringify(m, null, 2));
        setShowResults(true);
      }
    }
  };

  return (
    <div>
      <h1>Phrase Model</h1>
      <div>
        <label>
          Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="">Select</option>
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Style
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">(default)</option>
            {styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Minutes
          <input
            type="number"
            step="0.1"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label>
          Sections
          <input
            type="number"
            value={sections}
            onChange={(e) => setSections(e.target.value)}
          />
        </label>
        <label>
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />
        </label>
        <label>
          Sampler seed
          <input
            type="number"
            value={samplerSeed}
            onChange={(e) => setSamplerSeed(e.target.value)}
          />
        </label>
        <label>
          Mix preset
          <input
            type="text"
            value={mixPreset}
            onChange={(e) => setMixPreset(e.target.value)}
          />
        </label>
        <label>
          Output name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Output folder
          <input type="text" value={outdir} readOnly />
          <input
            type="file"
            ref={outdirPicker}
            style={{ display: "none" }}
            webkitdirectory=""
            directory=""
            onChange={outdirChanged}
          />
          <button type="button" onClick={chooseOutdir} aria-label="Choose output folder">
            📁
          </button>
        </label>
      </div>

      <details>
        <summary>Advanced</summary>
        <label>
          Mix config
          <input type="file" onChange={(e) => setMixConfig(e.target.files[0] || null)} />
        </label>
        <label>
          Arrange config
          <input
            type="file"
            onChange={(e) => setArrangeConfig(e.target.files[0] || null)}
          />
        </label>
        <label>
          Drums model
          <select
            value={drumsModel}
            onChange={(e) => setDrumsModel(e.target.value)}
          >
            <option value="">(default)</option>
            {drumsOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bass model
          <select
            value={bassModel}
            onChange={(e) => setBassModel(e.target.value)}
          >
            <option value="">(default)</option>
            {bassOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Keys model
          <select
            value={keysModel}
            onChange={(e) => setKeysModel(e.target.value)}
          >
            <option value="">(default)</option>
            {keysOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preview bars
          <input
            type="number"
            value={preview}
            onChange={(e) => setPreview(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={bundleStems}
            onChange={(e) => setBundleStems(e.target.checked)}
          />
          Bundle stems
        </label>
        <label>
          <input
            type="checkbox"
            checked={evalOnly}
            onChange={(e) => setEvalOnly(e.target.checked)}
          />
          Eval only
        </label>
        <label>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Dry run
        </label>
        <label>
          Keys SFZ
          <input type="file" onChange={(e) => setKeysSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Pads SFZ
          <input type="file" onChange={(e) => setPadsSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Bass SFZ
          <input type="file" onChange={(e) => setBassSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Drums SFZ
          <input type="file" onChange={(e) => setDrumsSfz(e.target.files[0] || null)} />
        </label>
        <label>
          Melody MIDI
          <input type="file" onChange={(e) => setMelodyMidi(e.target.files[0] || null)} />
        </label>
        <label>
          Arrange
          <select value={arrange} onChange={(e) => setArrange(e.target.value)}>
            <option value="">(default)</option>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </label>
        <label>
          Outro
          <select value={outro} onChange={(e) => setOutro(e.target.value)}>
            <option value="">(default)</option>
            <option value="hit">hit</option>
            <option value="ritard">ritard</option>
          </select>
        </label>
      </details>

      <div style={{ marginTop: "1rem" }}>
        <button type="button" onClick={start} disabled={running}>
          Start
        </button>
        <button type="button" onClick={cancel} disabled={!running}>
          Cancel
        </button>
        <progress value={progress} max="100" />
        <span>{stage}</span>
        <span>{eta ? `ETA: ${eta}` : ""}</span>
      </div>

      <pre
        style={{
          background: "var(--log-bg)",
          color: "var(--log-fg)",
          padding: "var(--space-sm)",
          height: "200px",
          overflowY: "scroll",
        }}
      >
        {log}
      </pre>

      {showResults && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Results</h3>
          <ul>
            {links.map((l) => (
              <li key={l.name}>
                <a href={l.href}>{l.name}</a>
              </li>
            ))}
          </ul>
          <ul>
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <pre>{metrics}</pre>
        </div>
      )}
    </div>
  );
}

