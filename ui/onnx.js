const isTauri = typeof window !== 'undefined' && window.__TAURI__;

async function tauriOnnxMain(){
  const { invoke, event, fs, path, shell } = window.__TAURI__;
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
  const results = document.getElementById('results');
  const midiLink = document.getElementById('midi_link');
  const telemetryPre = document.getElementById('telemetry');
  let jobId = null;
  let unlisten = null;

  async function refreshModels(){
    try {
      const installed = await invoke('list_models');
      const selected = modelSelect.value.split(/[\\/]/).pop();
      startBtn.disabled = !installed.includes(selected);
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
      console.error(e);
    }
  }

  await populateModels();

  modelSelect.addEventListener('change', refreshModels);

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
      console.error(e);
    }
    unlistenDownload();
    await refreshModels();
  });

    startBtn.addEventListener('click', async () => {
      const cfg = {
        model: modelSelect.value.split(/[\\/]/).pop(),
        steps: parseInt(stepsInput.value) || 0,
        sampling: {}
      };
    if (topKInput.value) cfg.sampling.top_k = parseInt(topKInput.value);
    if (topPInput.value) cfg.sampling.top_p = parseFloat(topPInput.value);
    if (tempInput.value) cfg.sampling.temperature = parseFloat(tempInput.value);
    if (songSpecInput.value.trim()) {
      try {
        cfg.song_spec = JSON.parse(songSpecInput.value);
      } catch {
        cfg.song_spec = songSpecInput.value.trim().split(/\s+/);
      }
    }
    const midiFile = midiInput.files[0];
    if (midiFile) {
      const tempDir = await path.tempDir();
      const midiPath = await path.join(tempDir, `melody-${Date.now()}.mid`);
      await fs.writeFile({ path: midiPath, contents: new Uint8Array(await midiFile.arrayBuffer()) });
      cfg.midi = midiPath;
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
