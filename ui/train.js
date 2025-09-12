(function(){
  function $(id){ return document.getElementById(id); }
  const startBtn = $('start');
  if (!startBtn) return;
  let jobId = null;
  startBtn.onclick = async () => {
    const fd = new FormData();
    const files = $('midi_files').files;
    const limit = parseInt($('limit').value, 10);
    const n = isNaN(limit) ? files.length : Math.min(limit, files.length);
    for (let i = 0; i < n; i++) fd.append('midis', files[i]);
    const resp = await fetch('/train', {method:'POST', body: fd});
    const data = await resp.json();
    jobId = data.job_id;
    startBtn.disabled = true;
    $('cancel').disabled = false;
    $('log').textContent = '';
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
    $('stage').textContent = data.stage || '';
    $('log').textContent = data.log.join('');
    if (data.status === 'running'){
      setTimeout(poll, 1000);
    } else {
      $('cancel').disabled = true;
      $('start').disabled = false;
    }
  }
})();
