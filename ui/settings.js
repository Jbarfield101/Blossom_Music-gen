import { setTheme } from './theme.js';

(function() {
  function $(id) { return document.getElementById(id); }

  function load() {
    const outdir = localStorage.getItem('default_outdir') || '';
    const theme = localStorage.getItem('theme') || 'dark';
    const outInput = $('default_outdir');
    const themeToggle = $('theme_toggle');
    if (outInput) outInput.value = outdir;
    if (themeToggle) {
      themeToggle.checked = theme === 'dark';
      themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        setTheme(newTheme);
      });
    }
  }

  function save() {
    const outInput = $('default_outdir');
    if (outInput) localStorage.setItem('default_outdir', outInput.value);
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    const saveBtn = $('save');
    if (saveBtn) saveBtn.addEventListener('click', save);
  });
})();
