import { setTheme } from './theme.js';

function $(id) { return document.getElementById(id); }

function load() {
  const outdir = localStorage.getItem('default_outdir') || '';
  const theme = localStorage.getItem('theme') || 'dark';
  const outInput = $('default_outdir');
  const themeSel = $('theme');
  if (outInput) outInput.value = outdir;
  if (themeSel) {
    themeSel.value = theme;
    themeSel.addEventListener('change', () => setTheme(themeSel.value));
  }
}

function save() {
  const outInput = $('default_outdir');
  const themeSel = $('theme');
  if (outInput) localStorage.setItem('default_outdir', outInput.value);
  if (themeSel) setTheme(themeSel.value);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  const saveBtn = $('save');
  if (saveBtn) saveBtn.addEventListener('click', save);
  const darkBtn = $('set_dark');
  if (darkBtn) darkBtn.addEventListener('click', () => {
    setTheme('dark');
    const themeSel = $('theme');
    if (themeSel) themeSel.value = 'dark';
  });
});

