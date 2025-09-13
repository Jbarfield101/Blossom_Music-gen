import { setTheme, getTheme, setAccent, getAccent } from './theme.js';

(function() {
  function $(id) { return document.getElementById(id); }

  async function init() {
    const outInput = $('default_outdir');
    if (outInput) outInput.value = localStorage.getItem('default_outdir') || '';

    const themeSelect = $('theme_select');
    const themeHelp = $('theme_help');
    const accentInput = $('accent_color');
    function updateThemeHelp(theme) {
      if (themeHelp) {
        themeHelp.textContent = theme === 'dark'
          ? 'Dark mode reduces eye strain.'
          : 'Light mode improves readability in bright environments.';
      }
    }

    if (themeSelect) {
      const current = (await getTheme()) || 'dark';
      themeSelect.value = current;
      updateThemeHelp(current);
      themeSelect.addEventListener('change', () => {
        const newTheme = themeSelect.value;
        setTheme(newTheme);
        updateThemeHelp(newTheme);
      });
    }

    if (accentInput) {
      const saved = (await getAccent()) || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      if (saved) accentInput.value = saved;
      accentInput.addEventListener('input', () => {
        setAccent(accentInput.value);
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
