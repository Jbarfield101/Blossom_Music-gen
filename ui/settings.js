(function() {
  function $(id) { return document.getElementById(id); }

  function applyTheme(theme) {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(theme);
  }

  function load() {
    const outdir = localStorage.getItem('default_outdir') || '';
    const theme = localStorage.getItem('theme') || 'dark';
    const outInput = $('default_outdir');
    const themeSel = $('theme');
    if (outInput) outInput.value = outdir;
    if (themeSel) themeSel.value = theme;
    applyTheme(theme);
  }

  function save() {
    const outInput = $('default_outdir');
    const themeSel = $('theme');
    if (outInput) localStorage.setItem('default_outdir', outInput.value);
    if (themeSel) {
      localStorage.setItem('theme', themeSel.value);
      applyTheme(themeSel.value);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    const saveBtn = $('save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const themeSel = $('theme');
    if (themeSel) themeSel.addEventListener('change', () => applyTheme(themeSel.value));
  });
})();
