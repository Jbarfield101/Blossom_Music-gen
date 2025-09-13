const isTauri = typeof window !== 'undefined' && window.__TAURI__;
const path = isTauri ? require("path") : null;

async function tauriOnnxMain(){
  const { invoke, event, shell } = window.__TAURI__;
  const modelSelect = document.getElementById('model-select');
  const downloadBtn = document.getElementById('download');
  const songSpecInput = document.getElementById('song_spec');
  const midiInput = document.getElementById('midi');
  const stepsInput = document.getElementById('steps');
  const topKInput = document.getElementById('top_k');
  const topPInput = document.getElementById('top_p');
  const tempInput = document.getElementById('temperature');
  const startBtn = document.getElementById('start');
  const cancelBtn = document.getElementById('cancel');
  const prog = document.getElementById('progress');
  const log = document.getElementById('log');
  log.hidden = false;
  log.style.userSelect = 'text';
  const results = document.getElementById('results');
  const midiLink = document.getElementById('midi_link');
  const telemetryPre = document.getElementById('telemetry');
  let jobId = null;
  let unlisten = null;
  let modelInstalled = false;
  let inputsValid = false;

  function numberParser(input, { min = 0, max = Infinity, required = false } = {}) {
    const errId = `${input.id}_error`;
    let err = document.getElementById(errId);
    if (!err) {
      err = document.createElement('span');
      err.id = errId;
      err.style.color = 'red';
      err.style.marginLeft = '0.5em';
      input.insertAdjacentElement('afterend', err);
    }
    const raw = input.value.trim();
    if (!raw) {
      if (required) {
        err.textContent = 'required';
        return { valid: false };
      }
      err.textContent = '';
      return { valid: true, value: undefined };
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < min || num > max) {
      err.textContent = 'invalid';
      return { valid: false };
    }
    err.textContent = '';
    return { valid: true, value: num };
  }

  function refreshStartDisabled(){
    startBtn.disabled = !(modelInstalled && inputsValid);
  }

  function validateInputs(){
    const steps = numberParser(stepsInput, { required: true });
    const topK = numberParser(topKInput);
    const topP = numberParser(topPInput, { max: 1 });
    const temp = numberParser(tempInput, { max: 1 });
    inputsValid = steps.valid && topK.valid && topP.valid && temp.valid;
    refreshStartDisabled();
    if (!inputsValid) return null;
    return { steps: steps.value, top_k: topK.value, top_p: topP.value, temperature: temp.value };
  }

  async function convertMidiFileToDataUri(file){
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return `data:audio/midi;base64,${base64}`;
  }

  async function refreshModels(){
    try {
      const installed = await invoke('list_models');
      const selected = modelSelect.value.split(/[\\/]/).pop();
      modelInstalled = installed.includes(selected);
      refreshStartDisabled();
    } catch (e) {
      console.error(e);
    }
  }

  async function populateModels(){
    try {
      const models = await invoke('list_musiclang_models');
      models.forEach(info => {
        const opt = document.createElement('option');
        opt.value = info.id;
        let label = info.id;
        if (info.description) label += ` - ${info.description}`;
        if (info.size) {
          const mb = (info.size / (1024 * 1024)).toFixed(1);
          label += ` (${mb} MB)`;
        }
        opt.textContent = label;
        modelSelect.appendChild(opt);
      });
      await refreshModels();
    } catch (e) {
      log.textContent = `Error fetching models: ${e}`;
      log.scrollTop = log.scrollHeight;
      if (typeof alert === 'function') alert(`Error fetching models: ${e}`);
    }
  }

  await populateModels();

  validateInputs();

  modelSelect.addEventListener('change', refreshModels);

  stepsInput.addEventListener('input', validateInputs);
  topKInput.addEventListener('input', validateInputs);
  topPInput.addEventListener('input', validateInputs);
  tempInput.addEventListener('input', validateInputs);

  downloadBtn.addEventListener('click', async e => {
    const name = modelSelect.value;
    prog.value = 0;
    log.textContent = '';
    const unlistenDownload = await event.listen(`download::progress::${name}`, e => {
      const data = e.payload;
      const msg = data.message || '';
      if (msg) {
        log.textContent += msg + '\n';
        log.scrollTop = log.scrollHeight;
      }
      if (typeof data.percent === 'number') {
        prog.value = data.percent;
      }
    });
    try {
      await invoke('download_model', { name, force: e.shiftKey });
    } catch (e) {
      log.textContent += `Error downloading model: ${e}\n`;
      log.scrollTop = log.scrollHeight;
      if (typeof alert === 'function') alert(`Error downloading model: ${e}`);
    }
    unlistenDownload();
    await refreshModels();
  });

    startBtn.addEventListener('click', async () => {
      const parsed = validateInputs();
      if (!parsed) return;
      const modelName = modelSelect.value.split(/[\\/]/).pop();
      const modelPath = path.join("models", `${modelName}.onnx`);
      let installed;
      try {
        installed = await invoke('list_models');
      } catch (e) {
        const msg = `Error listing models: ${e}`;
        log.textContent = msg;
        log.scrollTop = log.scrollHeight;
        if (typeof alert === 'function') alert(msg);
        return;
      }
      if (!installed.includes(modelName)) {
        const msg = `Model not found: ${modelName}`;
        log.textContent = msg;
        log.scrollTop = log.scrollHeight;
        if (typeof alert === 'function') alert(msg);
        return;
      }
      const cfg = {
        model: modelPath,
        steps: parsed.steps,
        sampling: {}
      };
    if (parsed.top_k !== undefined) cfg.sampling.top_k = parsed.top_k;
    if (parsed.top_p !== undefined) cfg.sampling.top_p = parsed.top_p;
    if (parsed.temperature !== undefined) cfg.sampling.temperature = parsed.temperature;
    if (songSpecInput.value.trim()) {
      try {
        cfg.song_spec = JSON.parse(songSpecInput.value);
      } catch {
        cfg.song_spec = songSpecInput.value.trim().split(/\s+/);
      }
    }
    const midiFile = midiInput.files[0];
    if (!songSpecInput.value.trim() && !midiFile) {
      const msg = 'Please provide a song spec or a MIDI file.';
      log.textContent = msg;
      log.scrollTop = log.scrollHeight;
      startBtn.disabled = false;
      return;
    }
    if (midiFile) {
      cfg.midi = await convertMidiFileToDataUri(midiFile);
    }

    const args = [JSON.stringify(cfg)];
    try {
      jobId = await invoke('onnx_generate', { args });
    } catch (e) {
      log.textContent = `Error: ${e}`;
      log.scrollTop = log.scrollHeight;
      return;
    }
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    prog.value = 0;
    log.textContent = '';
    results.hidden = true;
    if (unlisten) unlisten();
    unlisten = await event.listen(`onnx::progress::${jobId}`, e => {
      const data = e.payload;
      if (data.stage === 'error') {
        log.textContent += `Error: ${data.message}\n`;
        log.scrollTop = log.scrollHeight;
        cancelBtn.disabled = true;
        startBtn.disabled = false;
        return;
      }
      const msg = data.message || '';
      if (msg) {
        log.textContent += msg + '\n';
        log.scrollTop = log.scrollHeight;
        if (msg.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(msg);
            if (typeof parsed.step === 'number' && typeof parsed.total === 'number') {
              const pct = (parsed.step / parsed.total) * 100;
              prog.value = pct;
            }
            if (parsed.midi) {
              midiLink.textContent = parsed.midi;
              midiLink.onclick = () => shell.open(parsed.midi);
              telemetryPre.textContent = JSON.stringify(parsed.telemetry, null, 2);
              results.hidden = false;
            }
            if (parsed.error) {
              log.textContent += `Error: ${parsed.error}\n`;
              log.scrollTop = log.scrollHeight;
            }
          } catch {
            // ignore
          }
        }
      }
      if (typeof data.percent === 'number') {
        prog.value = data.percent;
      }
    });
    poll();
  });

  cancelBtn.addEventListener('click', async () => {
    if (jobId !== null) {
      await invoke('cancel_render', { jobId });
      cancelBtn.disabled = true;
      startBtn.disabled = false;
    }
  });

  async function poll(){
    if (jobId === null) return;
    try {
      const data = await invoke('job_status', { jobId });
      if (data.status === 'running') {
        setTimeout(poll, 1000);
      } else if (data.status === 'error') {
        cancelBtn.disabled = true;
        startBtn.disabled = false;
        if (data.message) {
          log.textContent += `\nError: ${data.message}\n`;
          log.scrollTop = log.scrollHeight;
        }
      } else {
        cancelBtn.disabled = true;
        startBtn.disabled = false;
      }
    } catch (e) {
      console.error(e);
    }
  }
}

if (isTauri) {
  tauriOnnxMain();
}
