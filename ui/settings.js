import { setTheme, getTheme } from './theme.js';

(function() {
  function $(id) { return document.getElementById(id); }

  async function init() {
    const outInput = $('default_outdir');
    if (outInput) outInput.value = localStorage.getItem('default_outdir') || '';

    const themeToggle = $('theme_toggle');
    if (themeToggle) {
      const current = (await getTheme()) || 'dark';
      themeToggle.checked = current === 'dark';
      themeToggle.addEventListener('change', () => {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        setTheme(newTheme);
      });
    }

    const saveBtn = $('save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const outInput = $('default_outdir');
      if (outInput) localStorage.setItem('default_outdir', outInput.value);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
