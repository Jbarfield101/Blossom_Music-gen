const isTauri = typeof window.__TAURI__ !== 'undefined';
let jobId = null;
let outputDir = '';
let bundlePath = null;
let progressUnlisten = null;
let pollTimeout = null;
const MAX_RECENT = 10;

const presetSel = document.getElementById('preset');
const styleSel = document.getElementById('style');
const minInput = document.getElementById('minutes');
const sectionsInput = document.getElementById('sections');
const seedInput = document.getElementById('seed');
const nameInput = document.getElementById('name');
const outdirInput = document.getElementById('outdir');
const chooseOutdirBtn = document.getElementById('choose_outdir');
const outdirPicker = document.getElementById('outdir_picker');
const mixConfigInput = document.getElementById('mix_config');
const arrangeConfigInput = document.getElementById('arrange_config');
const phraseInput = document.getElementById('phrase');
const previewInput = document.getElementById('preview');
const startBtn = document.getElementById('start-btn');
const cancelBtn = document.getElementById('cancel-btn');
const downloadBtn = document.getElementById('download-btn');
const prog = document.getElementById('progress');
const stage = document.getElementById('stage');
const eta = document.getElementById('eta');
const logs = document.getElementById('logs');
const links = document.getElementById('links');
const summary = document.getElementById('summary');
const recentList = document.getElementById('recent_list');

function appendOptions(sel, opts){
  sel.innerHTML = '';
  opts.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  });
}

async function loadOptions(){
  try {
    if (isTauri) {
      const presets = await window.__TAURI__.invoke('list_presets');
      const styles = await window.__TAURI__.invoke('list_styles');
      appendOptions(presetSel, presets);
      if (presets.length) presetSel.value = presets[0];
      appendOptions(styleSel, [''].concat(styles));
    } else {
      const presets = await fetch('/options/presets').then(r=>r.json());
      const styles = await fetch('/options/styles').then(r=>r.json());
      appendOptions(presetSel, presets);
      appendOptions(styleSel, [''].concat(styles));
    }
  } catch (e) {
    logs.textContent += 'Error loading options\n';
  }
}

async function loadRecent(){
  if (isTauri){
    try {
      const { readTextFile, BaseDirectory } = window.__TAURI__.fs;
      const text = await readTextFile('recent_renders.json', {dir: BaseDirectory.App});
      const data = JSON.parse(text);
      recentList.innerHTML='';
      data.slice().reverse().forEach(job => {
        const li = document.createElement('li');
        li.textContent = `${job.preset} (seed ${job.seed}) - ${job.status}`;
        recentList.appendChild(li);
      });
    } catch {}
  } else {
    const resp = await fetch('/recent');
    if (!resp.ok) return;
    const data = await resp.json();
    recentList.innerHTML='';
    data.forEach(job => {
      const li = document.createElement('li');
      li.textContent = `${job.preset} (seed ${job.seed}) - ${job.status}`;
      recentList.appendChild(li);
    });
  }
}

chooseOutdirBtn.addEventListener('click', async () => {
  if (isTauri){
    const sel = await window.__TAURI__.dialog.open({directory:true, multiple:false});
    if (sel) {
      outputDir = Array.isArray(sel) ? sel[0] : sel;
      outdirInput.value = outputDir;
    }
  } else {
    outdirPicker.click();
  }
});

outdirPicker.addEventListener('change', () => {
  const file = outdirPicker.files[0];
  if (file) {
    outputDir = file.path || file.webkitRelativePath.split('/')[0];
    outdirInput.value = outputDir;
  }
});

cancelBtn.addEventListener('click', async () => {
  if (!jobId) return;
  if (isTauri){
    await window.__TAURI__.invoke('cancel_render', {jobId});
  } else {
    await fetch(`/jobs/${jobId}/cancel`, {method:'POST'});
  }
});

async function poll(){
  if (!jobId) return;
  if (isTauri){
    const data = await window.__TAURI__.invoke('job_status', {jobId});
    if (data.status === 'running'){ pollTimeout = setTimeout(poll,1000); return; }
    cancelBtn.style.display='none'; startBtn.disabled=false;
  } else {
    const resp = await fetch(`/jobs/${jobId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    prog.value = data.progress || 0;
    eta.textContent = data.eta ? `ETA: ${data.eta}` : '';
    stage.textContent = data.stage || '';
    logs.textContent = data.log ? data.log.join('') : '';
    if (data.status === 'running'){ pollTimeout = setTimeout(poll,1000); return; }
    cancelBtn.disabled=true; startBtn.disabled=false;
    if (data.status === 'completed'){
      links.innerHTML='';
      ['mix.wav','stems.mid','bundle.zip'].forEach(n=>{
        const li=document.createElement('li');
        const a=document.createElement('a');
        a.href=`/jobs/${jobId}/artifact/${n}`; a.textContent=n;
        li.appendChild(a); links.appendChild(li);
      });
      summary.innerHTML='';
      const m=data.metrics||{};
      if (m.hash){ const li=document.createElement('li'); li.textContent=`Hash: ${m.hash}`; summary.appendChild(li); }
      if (typeof m.duration==='number'){ const li=document.createElement('li'); li.textContent=`Duration: ${m.duration.toFixed(2)}s`; summary.appendChild(li); }
      if (m.section_counts){ const li=document.createElement('li'); li.textContent='Sections: '+Object.entries(m.section_counts).map(([k,v])=>`${k}: ${v}`).join(', '); summary.appendChild(li); }
      document.getElementById('results').style.display='block';
    }
  }
  loadRecent();
}

startBtn.addEventListener('click', async () => {
  logs.textContent='';
  startBtn.disabled=true; cancelBtn.style.display='inline-block';
  if (isTauri){
    const { path, fs } = window.__TAURI__;
    const seed=parseInt(seedInput.value);
    const args=['main_render.py','--preset',presetSel.value,'--seed',String(seed)];
    if (styleSel.value) args.push('--style',styleSel.value);
    if (minInput.value) args.push('--minutes',minInput.value);
    if (sectionsInput.value) args.push('--sections',sectionsInput.value);
    if (phraseInput.checked) args.push('--use-phrase-model','yes');
    if (previewInput.value) args.push('--preview',previewInput.value);
    const tmp=await path.tempDir();
    const mixFile=mixConfigInput.files[0];
    if (mixFile){ const mixPath=await path.join(tmp,`mix-${Date.now()}.json`); await fs.writeFile({path:mixPath,contents:await mixFile.text()}); args.push('--mix-config',mixPath); }
    const arrFile=arrangeConfigInput.files[0];
    if (arrFile){ const arrPath=await path.join(tmp,`arr-${Date.now()}.json`); await fs.writeFile({path:arrPath,contents:await arrFile.text()}); args.push('--arrange-config',arrPath); }
    const name=nameInput.value.trim()||'output';
    const mixPath=outputDir?`${outputDir}/${name}.wav`:`${name}.wav`;
    const stemsPath=outputDir?`${outputDir}/${name}_stems`:`${name}_stems`;
    args.push('--mix',mixPath,'--stems',stemsPath);
    if (outputDir){ args.push('--bundle',`${outputDir}/${name}`); bundlePath=`${outputDir}/${name}.zip`; }
    else { args.push('--bundle'); }
    jobId=await window.__TAURI__.invoke('start_job',{args});
    if (progressUnlisten) progressUnlisten();
    progressUnlisten=await window.__TAURI__.event.listen(`progress::${jobId}`,e=>{
      const d=e.payload;
      if (d.message){ logs.textContent+=d.message+'\n'; logs.scrollTop=logs.scrollHeight; }
      if (typeof d.percent==='number') prog.value=d.percent;
      stage.textContent=d.stage||'';
      eta.textContent=d.eta?`ETA: ${d.eta}`:'';
    });
    poll();
  } else {
    const fd=new FormData();
    fd.append('preset',presetSel.value);
    fd.append('style',styleSel.value);
    if (minInput.value) fd.append('minutes',minInput.value);
    if (sectionsInput.value) fd.append('sections',sectionsInput.value);
    fd.append('seed',seedInput.value);
    fd.append('name',nameInput.value);
    if (mixConfigInput.files[0]) fd.append('mix_config',mixConfigInput.files[0]);
    if (arrangeConfigInput.files[0]) fd.append('arrange_config',arrangeConfigInput.files[0]);
    if (phraseInput.checked) fd.append('phrase','true');
    if (previewInput.value) fd.append('preview',previewInput.value);
    if (outputDir) fd.append('outdir',outputDir);
    const resp = await fetch('/render',{method:'POST',body:fd});
    const data = await resp.json();
    jobId = data.job_id; poll();
  }
});

loadOptions();
loadRecent();
