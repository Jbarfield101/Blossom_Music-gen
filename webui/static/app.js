let jobId = null;
let outputDir = '';

function $(id){ return document.getElementById(id); }

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
    span.textContent = `${job.preset} (seed ${job.seed}) - ${job.status}`;
    const btn = document.createElement('button');
    btn.textContent = 'Duplicate';
    btn.onclick = () => fillForm(job);
    li.appendChild(span);
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
}

$('choose_outdir').onclick = () => {
  $('outdir_picker').click();
};

$('outdir_picker').onchange = () => {
  const file = $('outdir_picker').files[0];
  if (file) {
    outputDir = file.path || file.webkitRelativePath.split('/')[0];
    $('outdir').value = outputDir;
  }
};

$('dice').onclick = () => {
  $('seed').value = Math.floor(Math.random()*1e9);
};

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

loadRecent();
