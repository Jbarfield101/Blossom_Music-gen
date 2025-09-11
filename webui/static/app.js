let jobId = null;

function $(id){ return document.getElementById(id); }

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
      $('metrics').textContent = JSON.stringify(data.metrics || {}, null, 2);
    }
  }
}
