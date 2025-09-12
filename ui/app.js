let jobId = null;
let outputDir = '';

function $(id){ return document.getElementById(id); }

const isTauri = typeof window !== 'undefined' && window.__TAURI__;

// Browser implementation ---------------------------------------------------
async function browserMain(){
  async function loadOptions(){
    try {
      const [presets, styles] = await Promise.all([
        fetch('/presets').then(r=>r.json()),
        fetch('/styles').then(r=>r.json()),
      ]);
      const presetSel = $('preset');
      presets.forEach(p=>{ const opt=document.createElement('option'); opt.value=p; opt.textContent=p; presetSel.appendChild(opt); });
      const styleSel = $('style');
      styles.forEach(s=>{ const opt=document.createElement('option'); opt.value=s; opt.textContent=s; styleSel.appendChild(opt); });
    } catch(err) {
      console.error('failed to load options', err);
    }
  }

  async function loadRecent(){
    const resp = await fetch('/recent');
    if (!resp.ok) return;
    const data = await resp.json();
    const list = $('recent_list');
    if (!list) return;
    list.innerHTML = '';
    for (const job of data){
      const li = document.createElement('li');
      const span = document.createElement('span');
      let text = `${job.preset} (seed ${job.seed}) - ${job.status}`;
      if (job.hash) text += ` [${job.hash}]`;
      span.textContent = text;
      li.appendChild(span);
      if (job.bundle) {
        const link = document.createElement('a');
        link.textContent = 'bundle.zip';
        link.href = `/bundles/${job.id}`;
        link.style.marginLeft = '8px';
        li.appendChild(link);
      }
      const btn = document.createElement('button');
      btn.textContent = 'Duplicate';
      btn.onclick = () => fillForm(job);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function fillForm(job){
    $('preset').value = job.preset;
    $('style').value = job.style || '';
    $('minutes').value = job.minutes ?? '';
    $('sections').value = job.sections ?? '';
    $('seed').value = job.seed ?? 42;
    $('name').value = job.name || 'output';
    $('phrase').checked = !!job.phrase;
    $('preview').value = job.preview ?? '';
    outputDir = job.outdir || '';
    $('outdir').value = outputDir;
    if (job.mix_config && job.mix_config.text) {
      const blob = new Blob([job.mix_config.text], {type: 'application/json'});
      const file = new File([blob], job.mix_config.name || 'mix_config.json', {type:'application/json'});
      const dt = new DataTransfer();
      dt.items.add(file);
      $('mix_config').files = dt.files;
    } else {
      $('mix_config').value = '';
    }
    if (job.arrange_config && job.arrange_config.text) {
      const blob = new Blob([job.arrange_config.text], {type: 'application/json'});
      const file = new File([blob], job.arrange_config.name || 'arrange_config.json', {type:'application/json'});
      const dt = new DataTransfer();
      dt.items.add(file);
      $('arrange_config').files = dt.files;
    } else {
      $('arrange_config').value = '';
    }
  }

  $('choose_outdir').onclick = () => { $('outdir_picker').click(); };
  $('outdir_picker').onchange = () => {
    const file = $('outdir_picker').files[0];
    if (file) {
      outputDir = file.path || file.webkitRelativePath.split('/')[0];
      $('outdir').value = outputDir;
    }
  };

  $('dice').onclick = () => { $('seed').value = Math.floor(Math.random()*1e9); };

  $('start').onclick = async () => {
    const fd = new FormData();
    fd.append('preset', $('preset').value);
    fd.append('style', $('style').value);
    if ($('minutes').value) fd.append('minutes', $('minutes').value);
    if ($('sections').value) fd.append('sections', $('sections').value);
    fd.append('seed', $('seed').value);
    fd.append('name', $('name').value);
    const mix = $('mix_config').files[0];
    if (mix) fd.append('mix_config', mix);
    const arr = $('arrange_config').files[0];
    if (arr) fd.append('arrange_config', arr);
    if ($('phrase').checked) fd.append('phrase', 'true');
    if ($('preview').value) fd.append('preview', $('preview').value);
    if (outputDir) fd.append('outdir', outputDir);
    const resp = await fetch('/render', {method:'POST', body: fd});
    const data = await resp.json();
    jobId = data.job_id;
    $('start').disabled = true;
    $('cancel').disabled = false;
    $('log').textContent = '';
    $('results').hidden = true;
    poll();
  };

  $('cancel').onclick = async () => {
    if (!jobId) return;
    await fetch(`/jobs/${jobId}/cancel`, {method:'POST'});
  };

  async function poll(){
    if (!jobId) return;
    const resp = await fetch(`/jobs/${jobId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    $('progress').value = data.progress || 0;
    $('eta').textContent = data.eta ? `ETA: ${data.eta}` : '';
    $('stage').textContent = data.stage || '';
    $('log').textContent = data.log.join('');
    if (data.status === 'running'){
      setTimeout(poll, 1000);
    } else {
      $('cancel').disabled = true;
      $('start').disabled = false;
      if (data.status === 'completed'){
        $('results').hidden = false;
        const links = $('links');
        links.innerHTML = '';
        for (const n of ['mix.wav','stems.mid','bundle.zip']){
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/jobs/${jobId}/artifact/${n}`;
          a.textContent = n;
          li.appendChild(a);
          links.appendChild(li);
        }
        const summary = $('summary');
        summary.innerHTML = '';
        const m = data.metrics || {};
        if (m.hash) {
          const li = document.createElement('li');
          li.textContent = `Hash: ${m.hash}`;
          summary.appendChild(li);
        }
        if (typeof m.duration === 'number') {
          const li = document.createElement('li');
          li.textContent = `Duration: ${m.duration.toFixed(2)}s`;
          summary.appendChild(li);
        }
        if (m.section_counts) {
          const li = document.createElement('li');
          li.textContent = 'Sections: ' + Object.entries(m.section_counts).map(([k,v])=>`${k}: ${v}`).join(', ');
          summary.appendChild(li);
        }
        $('metrics').textContent = JSON.stringify(m, null, 2);
      }
      loadRecent();
    }
  }

  loadOptions();
  loadRecent();
}

// Tauri implementation ------------------------------------------------------
async function tauriMain(){
  const { invoke, event, dialog, fs, path } = window.__TAURI__;
  let progressUnlisten = null;
  const presetSel = $('preset');
  const styleSel = $('style');
  const seedInput = $('seed');
  const minInput = $('minutes');
  const sectionsInput = $('sections');
  const nameInput = $('name');
  const outdirInput = $('outdir');
  const mixConfigInput = $('mix_config');
  const arrangeConfigInput = $('arrange_config');
  const phraseInput = $('phrase');
  const previewInput = $('preview');
  const startBtn = $('start');
  const cancelBtn = $('cancel');
  const prog = $('progress');
  const stage = $('stage');
  const eta = $('eta');
  const logs = $('log');

  async function loadOptions(){
    try{
      const presets = await invoke('list_presets');
      presets.forEach(p=>{ const opt=document.createElement('option'); opt.value=p; opt.textContent=p; presetSel.appendChild(opt); });
      if (presets.length) presetSel.value = presets[0];
      const styles = await invoke('list_styles');
      styles.forEach(s=>{ const opt=document.createElement('option'); opt.value=s; opt.textContent=s; styleSel.appendChild(opt); });
    }catch(e){ console.error('loadOptions', e); }
  }

  $('choose_outdir').addEventListener('click', async () => {
    const selected = await dialog.open({ directory: true, multiple: false });
    if (selected) {
      outputDir = Array.isArray(selected) ? selected[0] : selected;
      outdirInput.value = outputDir;
    }
  });

  $('dice').onclick = () => { seedInput.value = Math.floor(Math.random()*1e9); };

  startBtn.addEventListener('click', async () => {
    logs.textContent = '';
    prog.value = 0;
    eta.textContent = '';
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    const seed = parseInt(seedInput.value);
    const args = ['main_render.py', '--preset', presetSel.value, '--seed', String(seed)];
    if (styleSel.value) args.push('--style', styleSel.value);
    if (minInput.value) args.push('--minutes', minInput.value);
    if (sectionsInput.value) args.push('--sections', sectionsInput.value);
    if (phraseInput.checked) args.push('--use-phrase-model', 'yes');
    if (previewInput.value) args.push('--preview', previewInput.value);
    const tempDir = await path.tempDir();
    const mixFile = mixConfigInput.files[0];
    if (mixFile) {
      const mixCfgPath = await path.join(tempDir, `mix-config-${Date.now()}.json`);
      await fs.writeFile({ path: mixCfgPath, contents: await mixFile.text() });
      args.push('--mix-config', mixCfgPath);
    }
    const arrFile = arrangeConfigInput.files[0];
    if (arrFile) {
      const arrCfgPath = await path.join(tempDir, `arrange-config-${Date.now()}.json`);
      await fs.writeFile({ path: arrCfgPath, contents: await arrFile.text() });
      args.push('--arrange-config', arrCfgPath);
    }
    const name = nameInput.value.trim() || 'output';
    const mixPath = outputDir ? `${outputDir}/${name}.wav` : `${name}.wav`;
    const stemsPath = outputDir ? `${outputDir}/${name}_stems` : `${name}_stems`;
    args.push('--mix', mixPath);
    args.push('--stems', stemsPath);
    if (outputDir) {
      args.push('--bundle', `${outputDir}/${name}`);
    } else {
      args.push('--bundle');
    }
    jobId = await invoke('start_job', { args });
    if (progressUnlisten) { progressUnlisten(); }
    progressUnlisten = await event.listen(`progress::${jobId}`, e => {
      const data = e.payload;
      if (data.message) { logs.textContent += data.message + '\n'; logs.scrollTop = logs.scrollHeight; }
      if (typeof data.percent === 'number') prog.value = data.percent;
      stage.textContent = data.stage || '';
      eta.textContent = data.eta ? 'ETA: ' + data.eta : '';
    });
    poll();
  });

  cancelBtn.addEventListener('click', async () => {
    if (jobId !== null) {
      await invoke('cancel_render', { jobId });
    }
  });

  async function poll(){
    if (!jobId) return;
    try {
      const data = await invoke('job_status', { jobId });
      if (data.status === 'running') {
        setTimeout(poll, 1000);
      } else {
        cancelBtn.disabled = true;
        startBtn.disabled = false;
        if (data.status === 'completed' && data.bundle) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.textContent = 'bundle.zip';
          a.href = '#';
          a.onclick = () => window.__TAURI__.shell.open(data.bundle);
          $('links').appendChild(li);
          li.appendChild(a);
          $('results').hidden = false;
        }
      }
    } catch(e) {
      console.error(e);
    }
  }

  loadOptions();
}

if (isTauri){
  tauriMain();
} else {
  browserMain();
}
