(function(){
  function $(id){ return document.getElementById(id); }

  const midiInput = $('midis');
  const limitInput = $('limit');
  const startBtn = $('start');
  const cancelBtn = $('cancel');
  const prog = $('progress');
  const stage = $('stage');
  const log = $('log');

  let jobId = null;

  if(!startBtn) return; // script loaded on unrelated pages

  startBtn.addEventListener('click', async () => {
    const fd = new FormData();
    const files = midiInput.files;
    for(let i=0;i<files.length;i++){
      fd.append('midis', files[i]);
    }
    if(limitInput.value) fd.append('limit', limitInput.value);
    const resp = await fetch('/train', {method:'POST', body: fd});
    const data = await resp.json();
    jobId = data.job_id;
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    log.textContent = '';
    prog.value = 0;
    stage.textContent = '';
    poll();
  });

  cancelBtn.addEventListener('click', async () => {
    if(jobId){
      await fetch(`/jobs/${jobId}/cancel`, {method:'POST'});
    }
  });

  async function poll(){
    if(!jobId) return;
    try{
      const resp = await fetch(`/jobs/${jobId}`);
      if(!resp.ok) throw new Error('status');
      const data = await resp.json();
      if(typeof data.progress === 'number') prog.value = data.progress;
      if(data.log){
        log.textContent = data.log.join('\n');
        log.scrollTop = log.scrollHeight;
      }
      stage.textContent = data.stage || '';
      if(data.status === 'running'){
        setTimeout(poll, 1000);
      }else{
        startBtn.disabled = false;
        cancelBtn.disabled = true;
      }
    }catch(e){
      console.error(e);
    }
  }
})();
